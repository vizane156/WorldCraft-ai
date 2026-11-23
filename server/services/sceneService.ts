import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AtmospherePreset, SceneObjectSnapshot } from './commandValidator.ts';

export interface SceneSnapshotInput {
  session_id: string;
  title?: string;
  atmosphere?: AtmospherePreset;
  objects: SceneObjectSnapshot[];
}

export interface SceneRecord {
  session_id: string;
  title: string;
  atmosphere: AtmospherePreset;
  version: number;
  objects: SceneObjectSnapshot[];
  updated_at: string;
}

export interface SceneVersion {
  version: number;
  title: string;
  atmosphere: AtmospherePreset;
  object_count: number;
  objects: SceneObjectSnapshot[];
  created_at: string;
  note?: string;
}

interface StoreFile {
  scenes: Record<string, SceneRecord>;
  versions: Record<string, SceneVersion[]>;
}

const DATA_FILE = join(process.cwd(), '.data', 'scenes.json');
const MAX_VERSIONS_PER_SCENE = 25;

let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return {
      scenes: parsed.scenes && typeof parsed.scenes === 'object' ? parsed.scenes : {},
      versions:
        parsed.versions && typeof parsed.versions === 'object' ? parsed.versions : {},
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return { scenes: {}, versions: {} };
    }
    throw err;
  }
}

async function writeStore(store: StoreFile): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tempFile, JSON.stringify(store, null, 2), 'utf-8');
  await rename(tempFile, DATA_FILE);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function getScene(sessionId: string): Promise<SceneRecord | null> {
  const store = await readStore();
  return store.scenes[sessionId] ?? null;
}

export async function saveScene(
  input: SceneSnapshotInput,
  note?: string,
): Promise<SceneRecord> {
  return enqueue(async () => {
    const store = await readStore();
    const existing = store.scenes[input.session_id];
    const nextVersion = (existing?.version ?? 0) + 1;
    const now = new Date().toISOString();

    const record: SceneRecord = {
      session_id: input.session_id,
      title: input.title?.trim() || existing?.title || 'Untitled Spatial World',
      atmosphere: input.atmosphere || existing?.atmosphere || 'daylight',
      version: nextVersion,
      objects: input.objects.map((o) => ({ ...o })),
      updated_at: now,
    };

    store.scenes[input.session_id] = record;

    const history = store.versions[input.session_id] ?? [];
    history.unshift({
      version: nextVersion,
      title: record.title,
      atmosphere: record.atmosphere,
      object_count: record.objects.length,
      objects: record.objects.map((o) => ({ ...o })),
      created_at: now,
      ...(note ? { note } : {}),
    });
    store.versions[input.session_id] = history.slice(0, MAX_VERSIONS_PER_SCENE);

    await writeStore(store);
    return record;
  });
}

export async function listVersions(sessionId: string): Promise<SceneVersion[]> {
  const store = await readStore();
  return store.versions[sessionId] ?? [];
}

export async function restoreVersion(
  sessionId: string,
  versionNumber: number,
): Promise<SceneRecord | null> {
  return enqueue(async () => {
    const store = await readStore();
    const history = store.versions[sessionId] ?? [];
    const target = history.find((v) => v.version === versionNumber);
    if (!target) {
      return null;
    }

    const existing = store.scenes[sessionId];
    const nextVersion = (existing?.version ?? 0) + 1;
    const now = new Date().toISOString();

    const restored: SceneRecord = {
      session_id: sessionId,
      title: target.title,
      atmosphere: target.atmosphere,
      version: nextVersion,
      objects: target.objects.map((o) => ({ ...o })),
      updated_at: now,
    };

    store.scenes[sessionId] = restored;
    history.unshift({
      version: nextVersion,
      title: restored.title,
      atmosphere: restored.atmosphere,
      object_count: restored.objects.length,
      objects: restored.objects.map((o) => ({ ...o })),
      created_at: now,
      note: `Restored from v${versionNumber}`,
    });
    store.versions[sessionId] = history.slice(0, MAX_VERSIONS_PER_SCENE);

    await writeStore(store);
    return restored;
  });
}

export async function deleteScene(sessionId: string): Promise<boolean> {
  return enqueue(async () => {
    const store = await readStore();
    if (!store.scenes[sessionId] && !store.versions[sessionId]) {
      return false;
    }
    delete store.scenes[sessionId];
    delete store.versions[sessionId];
    await writeStore(store);
    return true;
  });
}
