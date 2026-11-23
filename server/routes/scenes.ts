import { Router } from 'express';
import type { AtmospherePreset, SceneObjectSnapshot } from '../services/commandValidator.ts';
import {
  deleteScene,
  getScene,
  listVersions,
  restoreVersion,
  saveScene,
} from '../services/sceneService.ts';

export const scenesRouter = Router();

const VALID_ID = /^[a-zA-Z0-9_-]{4,80}$/;

scenesRouter.get('/:session_id', async (req, res) => {
  const sessionId = req.params.session_id;
  if (!VALID_ID.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session_id format.' });
    return;
  }

  try {
    const scene = await getScene(sessionId);
    if (!scene) {
      res.json({
        session_id: sessionId,
        title: 'Untitled Spatial World',
        atmosphere: 'daylight',
        version: 0,
        objects: [],
        updated_at: null,
      });
      return;
    }
    res.json(scene);
  } catch {
    res.status(500).json({ error: 'Failed to load scene.' });
  }
});

scenesRouter.put('/:session_id', async (req, res) => {
  const sessionId = req.params.session_id;
  if (!VALID_ID.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session_id format.' });
    return;
  }

  const body = req.body as {
    title?: unknown;
    atmosphere?: unknown;
    objects?: unknown;
    note?: unknown;
  };

  const objects: SceneObjectSnapshot[] = Array.isArray(body?.objects)
    ? (body.objects as SceneObjectSnapshot[])
    : [];

  const atmosphere: AtmospherePreset =
    body?.atmosphere === 'golden' || body?.atmosphere === 'twilight'
      ? body.atmosphere
      : 'daylight';

  try {
    const saved = await saveScene(
      {
        session_id: sessionId,
        title: typeof body?.title === 'string' ? body.title : undefined,
        atmosphere,
        objects,
      },
      typeof body?.note === 'string' ? body.note : undefined,
    );
    res.json(saved);
  } catch {
    res.status(500).json({ error: 'Failed to persist scene.' });
  }
});

scenesRouter.get('/:session_id/versions', async (req, res) => {
  const sessionId = req.params.session_id;
  if (!VALID_ID.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session_id format.' });
    return;
  }

  try {
    const versions = await listVersions(sessionId);
    res.json({ session_id: sessionId, versions });
  } catch {
    res.status(500).json({ error: 'Failed to load version history.' });
  }
});

scenesRouter.post('/:session_id/restore/:version_number', async (req, res) => {
  const sessionId = req.params.session_id;
  const versionNumber = Number.parseInt(req.params.version_number, 10);

  if (!VALID_ID.test(sessionId) || !Number.isFinite(versionNumber) || versionNumber < 1) {
    res.status(400).json({ error: 'Invalid session_id or version number.' });
    return;
  }

  try {
    const restored = await restoreVersion(sessionId, versionNumber);
    if (!restored) {
      res.status(404).json({ error: `Version v${versionNumber} not found.` });
      return;
    }
    res.json(restored);
  } catch {
    res.status(500).json({ error: 'Failed to restore version.' });
  }
});

scenesRouter.delete('/:session_id', async (req, res) => {
  const sessionId = req.params.session_id;
  if (!VALID_ID.test(sessionId)) {
    res.status(400).json({ error: 'Invalid session_id format.' });
    return;
  }

  try {
    const removed = await deleteScene(sessionId);
    res.json({ deleted: removed });
  } catch {
    res.status(500).json({ error: 'Failed to delete scene.' });
  }
});
