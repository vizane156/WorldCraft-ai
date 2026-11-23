import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ContentListUnion, Part } from '@google/genai';
import { getCatalogPromptText } from '../catalog/assetCatalog.ts';
import {
  SCENE_MAX_OBJECTS,
  SCENE_RADIUS_M,
  validateCommandBatch,
} from './commandValidator.ts';
import type {
  SceneCommandBatch,
  SceneObjectSnapshot,
  ValidationResult,
} from './commandValidator.ts';

export interface ReferenceImageInput {
  mimeType: string;
  data: string;
}

export interface GenerateCommandInput {
  prompt: string;
  mode?: 'chat' | 'enhance';
  sceneState: SceneObjectSnapshot[];
  atmosphere?: string;
  referenceImage?: ReferenceImageInput;
}

export interface GenerateCommandOutput {
  batch: SceneCommandBatch;
  warnings: string[];
  modelUsed: string;
}

export class AiServiceError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 502, code = 'AI_UPSTREAM_ERROR') {
    super(message);
    this.name = 'AiServiceError';
    this.status = status;
    this.code = code;
  }
}

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_AUDIO_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
]);
const AI_REQUEST_TIMEOUT_MS = 12_000;

function createAiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
  return trimmed;
}

export function parseGeminiErrorMessage(err: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const rawMessage = err instanceof Error ? err.message : String(err);
  let extractedMsg = rawMessage;
  let numericCode = 502;

  const errAny = err as { status?: number; code?: number; name?: string } | undefined;
  if (typeof errAny?.status === 'number') {
    numericCode = errAny.status;
  } else if (typeof errAny?.code === 'number') {
    numericCode = errAny.code;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      error?: { code?: number; message?: string; status?: string };
    };
    if (parsed?.error?.message) {
      extractedMsg = parsed.error.message;
    }
    if (typeof parsed?.error?.code === 'number') {
      numericCode = parsed.error.code;
    }
  } catch {
    // Not raw JSON — check for embedded JSON payload inside SDK message
    const jsonStart = rawMessage.indexOf('{');
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
          error?: { code?: number; message?: string; status?: string };
        };
        if (parsed?.error?.message) {
          extractedMsg = parsed.error.message;
        }
        if (typeof parsed?.error?.code === 'number') {
          numericCode = parsed.error.code;
        }
      } catch {
        // Keep original message
      }
    }
  }

  if (
    errAny?.name === 'AbortError' ||
    errAny?.name === 'TimeoutError' ||
    /timed out|timeout|aborted/i.test(extractedMsg)
  ) {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      message: 'The AI director took too long to respond. Please try again.',
    };
  }

  if (numericCode === 429 || /quota|rate limit|resource exhausted/i.test(extractedMsg)) {
    return {
      status: 429,
      code: 'AI_RATE_LIMITED',
      message: 'AI rate limit reached. Wait a few seconds and retry.',
    };
  }

  if (
    numericCode === 503 ||
    /high demand|unavailable|overloaded/i.test(extractedMsg)
  ) {
    return {
      status: 503,
      code: 'AI_UNAVAILABLE',
      message: 'AI model is temporarily experiencing high demand. Please retry shortly.',
    };
  }

  if (numericCode === 401 || numericCode === 403 || /api key/i.test(extractedMsg)) {
    return {
      status: 500,
      code: 'AI_CONFIG_ERROR',
      message: 'Server AI credentials are not configured.',
    };
  }

  return {
    status: 502,
    code: 'AI_UPSTREAM_ERROR',
    message: extractedMsg || 'Failed to generate scene commands.',
  };
}

function buildSystemInstruction(): string {
  return [
    'You are the WorldCraft AI Scene Director, an expert spatial architect and level designer for 3D & Meta Quest XR dioramas.',
    `Arena constraints: circular stage with radius ${SCENE_RADIUS_M}m (safe placement inside radius 7.2m), max ${SCENE_MAX_OBJECTS} objects, Y=0 is floor level.`,
    'Right-handed Y-up coordinate system in meters. Keep spacing clean so objects do not intersect (leave >= sum of bounding radii between centers).',
    'Rotate focal objects inward toward the center or along natural walkways using rotation_y in radians (e.g. Math.PI = 3.1416).',
    '',
    'AVAILABLE 3D ASSET CATALOG (ONLY use exact asset_id values from this list):',
    getCatalogPromptText(),
    '',
    'OUTPUT CONTRACT — Return ONLY valid JSON matching this structure (no markdown, no explanation outside JSON):',
    '{',
    '  "version": "1.0",',
    '  "assistantMessage": "Concise 1-sentence summary of the spatial changes made.",',
    '  "atmosphere": "daylight" | "golden" | "twilight" (optional: set only if changing mood or building a themed scene),',
    '  "commands": [',
    '    { "action": "clear" } (use only when replacing the entire scene),',
    '    { "action": "spawn", "asset_id": "<catalog_id>", "label": "Friendly Name", "position": [x, 0, z], "rotation_y": 0, "scale": 1.0, "color": "#RRGGBB" },',
    '    { "action": "move", "target_id": "<existing_id>", "position": [x, y, z], "rotation_y": 0 },',
    '    { "action": "modify", "target_id": "<existing_id>", "scale": 1.2, "rotation_y": 1.57, "color": "#RRGGBB", "label": "New Label" },',
    '    { "action": "delete", "target_id": "<existing_id>" }',
    '  ]',
    '}',
  ].join('\n');
}

function buildUserContent(input: GenerateCommandInput): ContentListUnion {
  const parts: Part[] = [];
  const stateSummary =
    input.sceneState.length === 0
      ? 'Scene is currently empty (0 objects).'
      : `Current scene (${input.sceneState.length} objects, atmosphere=${input.atmosphere || 'daylight'}):\n${JSON.stringify(
          input.sceneState,
        )}`;

  const directive =
    input.mode === 'enhance'
      ? [
          stateSummary,
          '',
          'TASK: Enhance and enrich the current scene layout.',
          input.prompt
            ? `User guidance: ${input.prompt}`
            : 'Add complementary lighting, foliage, paths, or focal details from the catalog that harmonize with existing objects without overlapping them, and balance any crowded positions.',
        ].join('\n')
      : [
          stateSummary,
          '',
          `USER PROMPT: ${input.prompt}`,
          input.referenceImage
            ? 'Use the attached reference image for layout composition, theme, palette, and atmospheric inspiration while mapping structures onto the available 3D catalog.'
            : '',
        ]
          .filter(Boolean)
          .join('\n');

  parts.push({ text: directive });

  if (input.referenceImage) {
    if (!ALLOWED_IMAGE_MIME.has(input.referenceImage.mimeType)) {
      throw new AiServiceError(
        'Unsupported reference image format. Use PNG, JPEG, or WebP.',
        400,
        'INVALID_IMAGE_TYPE',
      );
    }
    const cleanBase64 = input.referenceImage.data.replace(/^data:[^;]+;base64,/, '');
    if (cleanBase64.length > 8_000_000) {
      throw new AiServiceError(
        'Reference image is too large (max ~5 MB).',
        400,
        'IMAGE_TOO_LARGE',
      );
    }
    parts.push({
      inlineData: {
        mimeType: input.referenceImage.mimeType,
        data: cleanBase64,
      },
    });
  }

  return parts;
}

async function callModel(
  ai: GoogleGenAI,
  model: string,
  contents: ContentListUnion,
  systemInstruction: string,
): Promise<string> {
  const isPrimary = model === PRIMARY_MODEL;
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      abortSignal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      ...(isPrimary
        ? {
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
          }
        : {
            temperature: 0.45,
          }),
    },
  });

  const text = response.text;
  if (!text) {
    throw new AiServiceError('AI returned an empty response.', 502, 'AI_EMPTY_RESPONSE');
  }
  return text;
}

export async function transcribeAudioCommand(input: {
  mimeType: string;
  data: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiServiceError(
      'GEMINI_API_KEY is missing on the server.',
      500,
      'AI_CONFIG_ERROR',
    );
  }

  const baseMime = input.mimeType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_MIME.has(baseMime)) {
    throw new AiServiceError(
      'Unsupported audio format for voice command.',
      400,
      'INVALID_AUDIO_TYPE',
    );
  }

  const cleanBase64 = input.data.replace(/^data:[^;]+;base64,/, '');
  if (!cleanBase64 || cleanBase64.length > 8_000_000) {
    throw new AiServiceError(
      'Recorded audio is empty or too large.',
      400,
      'INVALID_AUDIO_SIZE',
    );
  }

  const ai = createAiClient(apiKey);
  try {
    const response = await ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: baseMime,
              data: cleanBase64,
            },
          },
          {
            text: 'Transcribe this short spoken 3D scene voice command accurately. Return only the spoken words.',
          },
        ],
      },
      config: {
        abortSignal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      },
    });
    return (response.text || '').trim();
  } catch (err) {
    const parsed = parseGeminiErrorMessage(err);
    throw new AiServiceError(parsed.message, parsed.status, parsed.code);
  }
}

export async function generateSceneCommands(
  input: GenerateCommandInput,
): Promise<GenerateCommandOutput> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiServiceError(
      'GEMINI_API_KEY is missing on the server.',
      500,
      'AI_CONFIG_ERROR',
    );
  }

  const ai = createAiClient(apiKey);
  const systemInstruction = buildSystemInstruction();
  const contents = buildUserContent(input);

  const modelsToTry = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastParsedError: { status: number; code: string; message: string } | null = null;
  let modelUsed = PRIMARY_MODEL;
  let rawText = '';

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    try {
      rawText = await callModel(ai, model, contents, systemInstruction);
      modelUsed = model;
      lastParsedError = null;
      break;
    } catch (err) {
      if (err instanceof AiServiceError) {
        lastParsedError = { status: err.status, code: err.code, message: err.message };
      } else {
        lastParsedError = parseGeminiErrorMessage(err);
      }

      const retryable =
        lastParsedError.status === 503 ||
        lastParsedError.status === 504 ||
        lastParsedError.status === 502;
      if (!retryable || i === modelsToTry.length - 1) {
        throw new AiServiceError(
          lastParsedError.message,
          lastParsedError.status,
          lastParsedError.code,
        );
      }
    }
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonText(rawText));
  } catch {
    throw new AiServiceError(
      'AI response was not valid JSON. Please retry.',
      502,
      'AI_INVALID_JSON',
    );
  }

  const validation: ValidationResult = validateCommandBatch(
    parsedJson,
    input.sceneState,
  );
  if (!validation.valid) {
    throw new AiServiceError(
      `AI command validation failed: ${validation.errors[0] || 'schema mismatch'}`,
      502,
      'AI_SCHEMA_ERROR',
    );
  }

  return {
    batch: validation.batch,
    warnings: validation.warnings,
    modelUsed,
  };
}
