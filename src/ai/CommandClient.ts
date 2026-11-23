import type {
  AtmospherePreset,
  SceneCommandBatch,
  SceneObjectData,
} from '../scene/SceneState';

export interface CommandRequestOptions {
  prompt: string;
  mode?: 'chat' | 'enhance';
  sceneState: SceneObjectData[];
  atmosphere: AtmospherePreset;
  referenceImage?: {
    mimeType: string;
    data: string;
  };
}

export interface CommandResponsePayload {
  batch: SceneCommandBatch;
  warnings: string[];
  model_used: string;
}

export class CommandClient {
  async sendPrompt(options: CommandRequestOptions): Promise<CommandResponsePayload> {
    const maxAttempts = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch('/api/v1/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: options.prompt,
            mode: options.mode ?? 'chat',
            scene_state: options.sceneState.map((obj) => ({
              id: obj.id,
              asset_id: obj.asset_id,
              label: obj.label,
              position: obj.position,
              rotation_y: obj.rotation_y,
              scale: obj.scale,
              color: obj.color,
            })),
            atmosphere: options.atmosphere,
            ...(options.referenceImage
              ? { reference_image: options.referenceImage }
              : {}),
          }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          batch?: SceneCommandBatch;
          warnings?: string[];
          model_used?: string;
        };

        if (!res.ok) {
          const msg = payload.error || `Request failed (${res.status})`;
          const transient = res.status === 502 || res.status === 504;
          if (transient && attempt < maxAttempts - 1) {
            lastError = new Error(msg);
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
          throw new Error(msg);
        }

        if (!payload.batch) {
          throw new Error('Server returned an empty command batch.');
        }

        return {
          batch: payload.batch,
          warnings: payload.warnings ?? [],
          model_used: payload.model_used ?? 'gemini-4-hydrogen',
        };
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        const isNetwork = err instanceof TypeError;
        if (isNetwork && attempt < maxAttempts - 1) {
          lastError = errorObj;
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        throw errorObj;
      }
    }

    throw lastError || new Error('Failed to reach AI scene director.');
  }

  async transcribeAudio(mimeType: string, data: string): Promise<string> {
    const res = await fetch('/api/v1/commands/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType, data }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      transcript?: string;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(payload.error || `Transcription failed (${res.status})`);
    }
    return (payload.transcript || '').trim();
  }
}
