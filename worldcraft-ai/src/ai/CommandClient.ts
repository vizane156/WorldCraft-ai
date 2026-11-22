/**
 * CommandClient — HTTP client for POST /api/v1/commands.
 * Sends only session_id + command_text. The server is the authority on scene state.
 */

import type { SceneAction } from '../scene/SceneEngine.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

export interface CommandResponse {
  actions: SceneAction[];
  warnings: string[];
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

// Error code → user-facing message
const ERROR_MESSAGES: Record<string, string> = {
  AI_PARSE_ERROR:   "Couldn't understand that. Try rephrasing.",
  AI_SCHEMA_ERROR:  "Couldn't understand that. Try rephrasing.",
  COMMAND_EMPTY:    "No recognizable objects in that command. Try being more specific.",
  AI_UNAVAILABLE:   "AI is temporarily unavailable. Please retry.",
  INVALID_REQUEST:  "Invalid request. Please try again.",
};

export class CommandClient {
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async sendCommand(commandText: string): Promise<CommandResponse> {
    return this.fetchWithRetry(commandText, 2);
  }

  private async fetchWithRetry(
    commandText: string,
    attemptsLeft: number,
  ): Promise<CommandResponse> {
    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      try {
        response = await fetch(`${BACKEND_URL}/api/v1/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: this.sessionId,
            command_text: commandText,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (attemptsLeft > 1) return this.fetchWithRetry(commandText, attemptsLeft - 1);
      throw new CommandError('AI_UNAVAILABLE', ERROR_MESSAGES['AI_UNAVAILABLE']);
    }

    // Retry once on 5xx
    if (response.status >= 500 && attemptsLeft > 1) {
      return this.fetchWithRetry(commandText, attemptsLeft - 1);
    }

    const data = await response.json();

    if (!response.ok) {
      const detail = data.detail ?? data;
      const code: string = detail.error_code ?? 'AI_UNAVAILABLE';
      const msg = ERROR_MESSAGES[code] ?? detail.message ?? 'Unknown error.';
      throw new CommandError(code, msg);
    }

    return data as CommandResponse;
  }
}
