/**
 * PersistenceClient — HTTP client for scene save/load.
 * Manages session_id in localStorage.
 */

import type { SceneSnapshot } from '../scene/SceneState.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
const SESSION_KEY = 'worldcraft_session_id';

function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

export class PersistenceClient {
  readonly sessionId: string;

  constructor() {
    this.sessionId = getOrCreateSessionId();
  }

  async save(snapshot: SceneSnapshot): Promise<void> {
    try {
      await fetch(`${BACKEND_URL}/api/v1/scenes/${this.sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      });
    } catch (err) {
      // Non-fatal — scene stays live in memory
      console.warn('[PersistenceClient] Save failed:', err);
    }
  }

  async load(): Promise<SceneSnapshot | null> {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/v1/scenes/${this.sessionId}`,
        { method: 'GET' },
      );
      if (response.status === 404) return null;
      if (!response.ok) return null;
      const data = await response.json();
      return data.snapshot as SceneSnapshot;
    } catch {
      return null;
    }
  }
}
