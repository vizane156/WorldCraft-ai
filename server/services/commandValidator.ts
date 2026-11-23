import Ajv from 'ajv';
import schema from '../sceneCommandSchema.json' with { type: 'json' };
import { getAsset } from '../catalog/assetCatalog.ts';

export type AtmospherePreset = 'daylight' | 'golden' | 'twilight';

export interface SceneObjectSnapshot {
  id: string;
  asset_id: string;
  label?: string;
  position: [number, number, number];
  rotation_y: number;
  scale: number;
  color?: string;
}

export interface SpawnCommand {
  action: 'spawn';
  asset_id: string;
  target_id?: string;
  label?: string;
  position: [number, number, number];
  rotation_y?: number;
  scale?: number;
  color?: string;
}

export interface MoveCommand {
  action: 'move';
  target_id: string;
  position?: [number, number, number];
  rotation_y?: number;
}

export interface ModifyCommand {
  action: 'modify';
  target_id: string;
  scale?: number;
  rotation_y?: number;
  color?: string;
  label?: string;
}

export interface DeleteCommand {
  action: 'delete';
  target_id: string;
}

export interface ClearCommand {
  action: 'clear';
}

export type SceneCommand =
  | SpawnCommand
  | MoveCommand
  | ModifyCommand
  | DeleteCommand
  | ClearCommand;

export interface SceneCommandBatch {
  version: '1.0';
  assistantMessage?: string;
  atmosphere?: AtmospherePreset;
  commands: SceneCommand[];
}

export interface ValidationResult {
  valid: boolean;
  batch: SceneCommandBatch;
  warnings: string[];
  errors: string[];
}

const ajv = new Ajv({ allErrors: true, removeAdditional: false });
const validateSchema = ajv.compile(schema);

export const SCENE_RADIUS_M = Number(process.env.SCENE_RADIUS_M || 9.0);
export const SCENE_MAX_OBJECTS = Number(process.env.SCENE_MAX_OBJECTS || 60);

function clampPositionToArena(
  pos: [number, number, number],
  assetRadius: number,
  scale: number,
): { clamped: [number, number, number]; adjusted: boolean } {
  const maxReach = Math.max(1.5, SCENE_RADIUS_M - assetRadius * scale);
  let [x, y, z] = pos;
  let adjusted = false;

  if (!Number.isFinite(x)) {
    x = 0;
    adjusted = true;
  }
  if (!Number.isFinite(y)) {
    y = 0;
    adjusted = true;
  }
  if (!Number.isFinite(z)) {
    z = 0;
    adjusted = true;
  }

  if (y < 0 || y > 4) {
    y = Math.max(0, Math.min(4, y));
    adjusted = true;
  }

  const distSq = x * x + z * z;
  if (distSq > maxReach * maxReach) {
    const dist = Math.sqrt(distSq);
    const factor = maxReach / dist;
    x = Number((x * factor).toFixed(2));
    z = Number((z * factor).toFixed(2));
    adjusted = true;
  }

  return {
    clamped: [Number(x.toFixed(2)), Number(y.toFixed(2)), Number(z.toFixed(2))],
    adjusted,
  };
}

export function validateCommandBatch(
  rawBatch: unknown,
  currentObjects: SceneObjectSnapshot[] = [],
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!rawBatch || typeof rawBatch !== 'object') {
    return {
      valid: false,
      batch: { version: '1.0', commands: [] },
      warnings,
      errors: ['Model returned a non-object response.'],
    };
  }

  const schemaOk = validateSchema(rawBatch);
  if (!schemaOk) {
    const ajvErrors = (validateSchema.errors || []).map(
      (err) => `${err.instancePath || '/'} ${err.message || 'invalid'}`,
    );
    return {
      valid: false,
      batch: { version: '1.0', commands: [] },
      warnings,
      errors: ajvErrors,
    };
  }

  const batch = rawBatch as unknown as SceneCommandBatch;
  const knownIds = new Set(currentObjects.map((o) => o.id));
  let projectedCount = currentObjects.length;
  const sanitizedCommands: SceneCommand[] = [];

  for (const cmd of batch.commands) {
    if (cmd.action === 'clear') {
      knownIds.clear();
      projectedCount = 0;
      sanitizedCommands.push({ action: 'clear' });
      continue;
    }

    if (cmd.action === 'spawn') {
      const asset = getAsset(cmd.asset_id);
      if (!asset) {
        warnings.push(`Skipped unknown catalog asset "${cmd.asset_id}".`);
        continue;
      }
      if (projectedCount >= SCENE_MAX_OBJECTS) {
        warnings.push(`Reached object cap (${SCENE_MAX_OBJECTS}); skipped "${cmd.asset_id}".`);
        continue;
      }
      const scale = Math.max(0.25, Math.min(3.0, cmd.scale ?? asset.defaultScale));
      const { clamped, adjusted } = clampPositionToArena(
        cmd.position,
        asset.boundingRadius,
        scale,
      );
      if (adjusted) {
        warnings.push(`Clamped "${asset.name}" inside the ${SCENE_RADIUS_M}m studio boundary.`);
      }
      const targetId =
        cmd.target_id && !knownIds.has(cmd.target_id)
          ? cmd.target_id
          : `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      knownIds.add(targetId);
      projectedCount += 1;

      sanitizedCommands.push({
        action: 'spawn',
        asset_id: asset.id,
        target_id: targetId,
        label: cmd.label?.trim() || asset.name,
        position: clamped,
        rotation_y: cmd.rotation_y ?? 0,
        scale,
        color: cmd.color || asset.defaultColor,
      });
      continue;
    }

    if (cmd.action === 'move') {
      if (!knownIds.has(cmd.target_id)) {
        warnings.push(`Skipped move for missing object "${cmd.target_id}".`);
        continue;
      }
      const existing = currentObjects.find((o) => o.id === cmd.target_id);
      const asset = existing ? getAsset(existing.asset_id) : undefined;
      let nextPos = cmd.position;
      if (nextPos) {
        const { clamped, adjusted } = clampPositionToArena(
          nextPos,
          asset?.boundingRadius ?? 1.0,
          existing?.scale ?? 1.0,
        );
        if (adjusted) {
          warnings.push(`Clamped moved object "${cmd.target_id}" inside studio boundary.`);
        }
        nextPos = clamped;
      }
      sanitizedCommands.push({
        action: 'move',
        target_id: cmd.target_id,
        ...(nextPos ? { position: nextPos } : {}),
        ...(cmd.rotation_y !== undefined ? { rotation_y: cmd.rotation_y } : {}),
      });
      continue;
    }

    if (cmd.action === 'modify') {
      if (!knownIds.has(cmd.target_id)) {
        warnings.push(`Skipped modify for missing object "${cmd.target_id}".`);
        continue;
      }
      sanitizedCommands.push({
        action: 'modify',
        target_id: cmd.target_id,
        ...(cmd.scale !== undefined
          ? { scale: Math.max(0.25, Math.min(3.0, cmd.scale)) }
          : {}),
        ...(cmd.rotation_y !== undefined ? { rotation_y: cmd.rotation_y } : {}),
        ...(cmd.color ? { color: cmd.color } : {}),
        ...(cmd.label ? { label: cmd.label.trim() } : {}),
      });
      continue;
    }

    if (cmd.action === 'delete') {
      if (!knownIds.has(cmd.target_id)) {
        warnings.push(`Skipped delete for missing object "${cmd.target_id}".`);
        continue;
      }
      knownIds.delete(cmd.target_id);
      projectedCount = Math.max(0, projectedCount - 1);
      sanitizedCommands.push({ action: 'delete', target_id: cmd.target_id });
    }
  }

  return {
    valid: true,
    batch: {
      version: '1.0',
      assistantMessage: batch.assistantMessage || 'Updated your 3D world.',
      ...(batch.atmosphere ? { atmosphere: batch.atmosphere } : {}),
      commands: sanitizedCommands,
    },
    warnings,
    errors,
  };
}
