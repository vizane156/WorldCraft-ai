/**
 * PersistenceClient — HTTP + localStorage persistence, shareable ?scene= URLs,
 * and version history / restore client.
 */

import type { SceneSnapshot } from '../scene/SceneState';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? '';
const SESSION_KEY = 'worldcraft_session_id';
const SNAPSHOT_PREFIX = 'worldcraft_snapshot_';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SceneVersionSummary {
  version: number;
  command: string | null;
  created_at: string;
  object_count: number;
  atmosphere: string;
}

function getOrCreateSessionId(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('scene');
    if (sharedId && UUID_REGEX.test(sharedId)) {
      localStorage.setItem(SESSION_KEY, sharedId);
      return sharedId;
    }
  }
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing && UUID_REGEX.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

export class PersistenceClient {
  sessionId: string;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.sessionId = getOrCreateSessionId();
  }

  getShareUrl(): string {
    const url = new URL(window.location.href);
    url.searchParams.set('scene', this.sessionId);
    return url.toString();
  }

  createNewSession(): string {
    const id = crypto.randomUUID();
    this.sessionId = id;
    localStorage.setItem(SESSION_KEY, id);
    const url = new URL(window.location.href);
    url.searchParams.set('scene', id);
    window.history.replaceState({}, '', url.toString());
    return id;
  }

  async save(snapshot: SceneSnapshot, command = 'Scene update'): Promise<void> {
    const targetSessionId = this.sessionId;
    try {
      localStorage.setItem(
        `${SNAPSHOT_PREFIX}${targetSessionId}`,
        JSON.stringify(snapshot),
      );
    } catch {
      // ignore storage quota errors
    }

    const runSave = async () => {
      try {
        await fetch(`${BACKEND_URL}/api/v1/scenes/${targetSessionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshot, command }),
        });
      } catch (err) {
        console.warn('[PersistenceClient] Save failed:', err);
      }
    };

    this.saveQueue = this.saveQueue.then(runSave, runSave);
    return this.saveQueue;
  }

  async load(): Promise<SceneSnapshot | null> {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/v1/scenes/${this.sessionId}`,
        { method: 'GET' },
      );
      if (response.ok) {
        const data = (await response.json()) as { snapshot: SceneSnapshot };
        return data.snapshot;
      }
    } catch {
      // fall through to local backup
    }

    try {
      const cached = localStorage.getItem(`${SNAPSHOT_PREFIX}${this.sessionId}`);
      if (cached) {
        return JSON.parse(cached) as SceneSnapshot;
      }
    } catch {
      // ignore parse errors
    }
    return null;
  }

  async fetchVersions(): Promise<SceneVersionSummary[]> {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/v1/scenes/${this.sessionId}/versions`,
        { method: 'GET' },
      );
      if (!response.ok) return [];
      const data = (await response.json()) as {
        versions: SceneVersionSummary[];
      };
      return data.versions ?? [];
    } catch {
      return [];
    }
  }

  async restoreVersion(version: number): Promise<SceneSnapshot | null> {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/v1/scenes/${this.sessionId}/restore/${version}`,
        { method: 'POST' },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as { snapshot: SceneSnapshot };
      return data.snapshot;
    } catch {
      return null;
    }
  }
}
