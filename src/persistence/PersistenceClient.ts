import type {
  AtmospherePreset,
  SceneObjectData,
  SceneSnapshot,
} from '../scene/SceneState';

export interface PersistedSceneVersion {
  version: number;
  title: string;
  atmosphere: AtmospherePreset;
  object_count: number;
  objects: SceneObjectData[];
  created_at: string;
  note?: string;
}

export interface PersistedSceneRecord extends SceneSnapshot {
  updated_at: string | null;
}

export class PersistenceClient {
  private saveQueue: Promise<unknown> = Promise.resolve();

  async load(sessionId: string): Promise<PersistedSceneRecord> {
    const res = await fetch(`/api/v1/scenes/${encodeURIComponent(sessionId)}`);
    if (!res.ok) {
      throw new Error(`Failed to load scene (${res.status})`);
    }
    return (await res.json()) as PersistedSceneRecord;
  }

  save(
    snapshot: SceneSnapshot,
    note?: string,
  ): Promise<PersistedSceneRecord> {
    const run = async (): Promise<PersistedSceneRecord> => {
      const res = await fetch(
        `/api/v1/scenes/${encodeURIComponent(snapshot.session_id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: snapshot.title,
            atmosphere: snapshot.atmosphere,
            objects: snapshot.objects,
            ...(note ? { note } : {}),
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to save scene (${res.status})`);
      }
      return (await res.json()) as PersistedSceneRecord;
    };

    const next = this.saveQueue.then(run, run);
    this.saveQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async listVersions(sessionId: string): Promise<PersistedSceneVersion[]> {
    const res = await fetch(
      `/api/v1/scenes/${encodeURIComponent(sessionId)}/versions`,
    );
    if (!res.ok) {
      throw new Error(`Failed to list versions (${res.status})`);
    }
    const data = (await res.json()) as { versions: PersistedSceneVersion[] };
    return data.versions ?? [];
  }

  async restoreVersion(
    sessionId: string,
    versionNumber: number,
  ): Promise<PersistedSceneRecord> {
    const res = await fetch(
      `/api/v1/scenes/${encodeURIComponent(sessionId)}/restore/${versionNumber}`,
      { method: 'POST' },
    );
    if (!res.ok) {
      throw new Error(`Failed to restore version v${versionNumber} (${res.status})`);
    }
    return (await res.json()) as PersistedSceneRecord;
  }
}
