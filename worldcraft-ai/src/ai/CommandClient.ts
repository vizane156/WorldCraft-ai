/**
 * CommandClient — HTTP client for POST /api/v1/commands.
 * Supports natural-language commands, multimodal reference images, and AI auto-enhance.
 */

import type { SceneAction } from '../scene/SceneEngine';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? '';

export interface CommandRequestOptions {
  imageBase64?: string;
  imageMimeType?: string;
  mode?: 'command' | 'enhance';
}

export interface CommandResponse {
  assistant_message: string;
  actions: SceneAction[];
  warnings: string[];
  version?: number;
}

export class CommandError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  AI_PARSE_ERROR: "Couldn't understand that response. Try rephrasing.",
  AI_SCHEMA_ERROR: "Couldn't map that to valid 3D actions. Try rephrasing.",
  COMMAND_EMPTY: 'No recognizable catalog objects in that request. Try mentioning stalls, trees, fountains, lanterns, or vehicles.',
  AI_UNAVAILABLE: 'AI Scene Director is temporarily unavailable. Check your Gemini API key or retry.',
  RATE_LIMITED: 'Rate limit reached — please wait a few seconds before sending another command.',
  INVALID_REQUEST: 'Please enter a valid scene instruction (1–600 characters).',
};

export class CommandClient {
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  async sendCommand(
    commandText: string,
    options: CommandRequestOptions = {},
  ): Promise<CommandResponse> {
    return this.fetchWithRetry(commandText, options, 2);
  }

  private async fetchWithRetry(
    commandText: string,
    options: CommandRequestOptions,
    attemptsLeft: number,
  ): Promise<CommandResponse> {
    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000);
      try {
        response = await fetch(`${BACKEND_URL}/api/v1/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: this.sessionId,
            command_text: commandText,
            ...(options.mode ? { mode: options.mode } : {}),
            ...(options.imageBase64 ? { image_base64: options.imageBase64 } : {}),
            ...(options.imageMimeType ? { image_mime_type: options.imageMimeType } : {}),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      if (attemptsLeft > 1) {
        return this.fetchWithRetry(commandText, options, attemptsLeft - 1);
      }
      throw new CommandError('AI_UNAVAILABLE', ERROR_MESSAGES['AI_UNAVAILABLE']);
    }

    let data: Record<string, unknown> = {};
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      // ignore non-json error bodies
    }

    if (
      (response.status === 502 || response.status === 504) &&
      attemptsLeft > 1
    ) {
      return this.fetchWithRetry(commandText, options, attemptsLeft - 1);
    }

    if (!response.ok) {
      const detail = (data.detail ?? data) as {
        error_code?: string;
        message?: string;
      };
      const code =
        response.status === 429
          ? 'RATE_LIMITED'
          : detail.error_code ?? 'AI_UNAVAILABLE';
      const msg = detail.message || ERROR_MESSAGES[code] || 'Unexpected AI error.';
      throw new CommandError(code, msg);
    }

    return data as unknown as CommandResponse;
  }
}
