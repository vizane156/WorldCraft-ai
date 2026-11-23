import { Router } from 'express';
import { getAllAssets } from '../catalog/assetCatalog.ts';
import {
  AiServiceError,
  generateSceneCommands,
  transcribeAudioCommand,
} from '../services/aiGateway.ts';
import type { ReferenceImageInput } from '../services/aiGateway.ts';
import type { SceneObjectSnapshot } from '../services/commandValidator.ts';

export const commandsRouter = Router();

commandsRouter.get('/catalog', (_req, res) => {
  res.json({ assets: getAllAssets() });
});

commandsRouter.post('/transcribe', async (req, res) => {
  const body = req.body as { mimeType?: unknown; data?: unknown };
  if (typeof body?.mimeType !== 'string' || typeof body?.data !== 'string') {
    res.status(400).json({
      error: 'Missing recorded audio payload.',
      code: 'MISSING_AUDIO',
    });
    return;
  }

  try {
    const transcript = await transcribeAudioCommand({
      mimeType: body.mimeType,
      data: body.data,
    });
    res.json({ transcript });
  } catch (err) {
    if (err instanceof AiServiceError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({
      error: 'Unexpected error transcribing audio.',
      code: 'INTERNAL_ERROR',
    });
  }
});

commandsRouter.post('/', async (req, res) => {
  const body = req.body as {
    prompt?: unknown;
    mode?: unknown;
    scene_state?: unknown;
    atmosphere?: unknown;
    reference_image?: unknown;
  };

  const mode = body?.mode === 'enhance' ? 'enhance' : 'chat';
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

  if (mode === 'chat' && !prompt && !body?.reference_image) {
    res.status(400).json({
      error: 'Please enter a prompt or attach a reference image.',
      code: 'MISSING_PROMPT',
    });
    return;
  }

  if (prompt.length > 2000) {
    res.status(400).json({
      error: 'Prompt is too long (max 2000 characters).',
      code: 'PROMPT_TOO_LONG',
    });
    return;
  }

  const sceneState: SceneObjectSnapshot[] = Array.isArray(body?.scene_state)
    ? (body.scene_state as SceneObjectSnapshot[])
    : [];

  let referenceImage: ReferenceImageInput | undefined;
  if (body?.reference_image && typeof body.reference_image === 'object') {
    const img = body.reference_image as { mimeType?: unknown; data?: unknown };
    if (typeof img.mimeType === 'string' && typeof img.data === 'string' && img.data.length > 0) {
      referenceImage = { mimeType: img.mimeType, data: img.data };
    }
  }

  try {
    const result = await generateSceneCommands({
      prompt,
      mode,
      sceneState,
      atmosphere: typeof body?.atmosphere === 'string' ? body.atmosphere : undefined,
      referenceImage,
    });

    res.json({
      batch: result.batch,
      warnings: result.warnings,
      model_used: result.modelUsed,
    });
  } catch (err) {
    if (err instanceof AiServiceError) {
      res.status(err.status).json({
        error: err.message,
        code: err.code,
      });
      return;
    }
    res.status(500).json({
      error: 'Unexpected error generating scene commands.',
      code: 'INTERNAL_ERROR',
    });
  }
});
