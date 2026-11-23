/**
 * SceneState — pure in-memory registry of scene objects with Undo/Redo history.
 *
 * No Three.js, no IWSDK, no networking. Plain data only.
 */

import type { Transform, Vec3, Quat } from '../interaction/InteractionAdapter';

export type { Transform, Vec3, Quat };

export type AtmospherePreset = 'daylight' | 'golden_hour' | 'twilight_lanterns';

export interface SceneObject {
  /** Stable UUID assigned at placement time. */
  id: string;
  /** Must exist in the asset catalog. */
  asset_id: string;
  /** Human-readable name used for AI target resolution (e.g. "shop_2"). */
  label: string;
  transform: Transform;
  /** Optional hex color tint override (e.g. "#38bdf8"). */
  color?: string;
}

export interface SceneSnapshot {
  version: number;
  objects: SceneObject[];
  /** Confirmed surface position/orientation in world space. */
  origin: Transform | null;
  atmosphere?: AtmospherePreset;
}

const MAX_HISTORY = 30;

function cloneSnapshot(snap: SceneSnapshot): SceneSnapshot {
  return {
    version: snap.version,
    objects: snap.objects.map((o) => ({
      ...o,
      transform: {
        position: [...o.transform.position] as Vec3,
        rotation: [...o.transform.rotation] as Quat,
        scale: [...o.transform.scale] as Vec3,
      },
    })),
    origin: snap.origin
      ? {
          position: [...snap.origin.position] as Vec3,
          rotation: [...snap.origin.rotation] as Quat,
          scale: [...snap.origin.scale] as Vec3,
        }
      : null,
    atmosphere: snap.atmosphere ?? 'daylight',
  };
}

export class SceneState {
  private objects = new Map<string, SceneObject>();
  private origin: Transform | null = null;
  private atmosphere: AtmospherePreset = 'daylight';
  private version = 0;

  private undoStack: SceneSnapshot[] = [];
  private redoStack: SceneSnapshot[] = [];

  // ── Origin & Atmosphere ─────────────────────────────────────────────────

  setOrigin(t: Transform): void {
    this.origin = t;
  }

  getOrigin(): Transform | null {
    return this.origin;
  }

  setAtmosphere(preset: AtmospherePreset): void {
    this.atmosphere = preset;
  }

  getAtmosphere(): AtmospherePreset {
    return this.atmosphere;
  }

  getVersion(): number {
    return this.version;
  }

  // ── History (Undo / Redo) ───────────────────────────────────────────────

  pushUndoSnapshot(): void {
    this.undoStack.push(cloneSnapshot(this.serialize()));
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  popUndo(): SceneSnapshot | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(cloneSnapshot(this.serialize()));
    return prev;
  }

  popRedo(): SceneSnapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneSnapshot(this.serialize()));
    return next;
  }

  // ── Objects ──────────────────────────────────────────────────────────────

  add(obj: SceneObject): void {
    this.objects.set(obj.id, {
      ...obj,
      transform: {
        position: [...obj.transform.position] as Vec3,
        rotation: [...obj.transform.rotation] as Quat,
        scale: [...obj.transform.scale] as Vec3,
      },
    });
  }

  remove(id: string): void {
    this.objects.delete(id);
  }

  clear(): void {
    this.objects.clear();
  }

  get(id: string): SceneObject | undefined {
    return this.objects.get(id);
  }

  getAll(): SceneObject[] {
    return Array.from(this.objects.values());
  }

  update(
    id: string,
    transform: Partial<Transform>,
    extra?: { color?: string; label?: string },
  ): void {
    const obj = this.objects.get(id);
    if (obj == null) return;
    this.objects.set(id, {
      ...obj,
      ...(extra?.color !== undefined ? { color: extra.color } : {}),
      ...(extra?.label !== undefined ? { label: extra.label } : {}),
      transform: { ...obj.transform, ...transform },
    });
  }

  /**
   * Case-insensitive label lookup (exact first, then partial fallback).
   */
  resolve(label: string): SceneObject | undefined {
    const lower = label.trim().toLowerCase();
    for (const obj of this.objects.values()) {
      if (obj.label.toLowerCase() === lower) return obj;
    }
    for (const obj of this.objects.values()) {
      if (obj.label.toLowerCase().includes(lower)) return obj;
    }
    return undefined;
  }

  generateUniqueLabel(base: string): string {
    const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'object';
    if (!this.resolveExact(clean)) return clean;
    let idx = 2;
    while (this.resolveExact(`${clean}_${idx}`)) idx++;
    return `${clean}_${idx}`;
  }

  private resolveExact(label: string): boolean {
    const lower = label.toLowerCase();
    for (const obj of this.objects.values()) {
      if (obj.label.toLowerCase() === lower) return true;
    }
    return false;
  }

  has(id: string): boolean {
    return this.objects.has(id);
  }

  get size(): number {
    return this.objects.size;
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  serialize(): SceneSnapshot {
    return {
      version: this.version,
      objects: Array.from(this.objects.values()).map((o) => ({
        ...o,
        transform: {
          position: [...o.transform.position] as Vec3,
          rotation: [...o.transform.rotation] as Quat,
          scale: [...o.transform.scale] as Vec3,
        },
      })),
      origin: this.origin,
      atmosphere: this.atmosphere,
    };
  }

  deserialize(snapshot: SceneSnapshot): void {
    this.objects.clear();
    for (const obj of snapshot.objects ?? []) {
      this.add(obj);
    }
    this.origin = snapshot.origin ?? null;
    this.atmosphere = snapshot.atmosphere ?? 'daylight';
    this.version = snapshot.version ?? 0;
  }

  bumpVersion(): void {
    this.version++;
  }
}
