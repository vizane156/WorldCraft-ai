/**
 * SceneState — pure in-memory registry of scene objects.
 *
 * No Three.js, no IWSDK, no networking. Plain data only.
 * This is the single source of truth for what objects exist in the scene,
 * their labels, and their current transforms.
 */

import type { Transform, Vec3, Quat } from '../interaction/InteractionAdapter.js';

export type { Transform, Vec3, Quat };

// ─── Scene data types ──────────────────────────────────────────────────────

export interface SceneObject {
  /** Stable UUID assigned at placement time. */
  id: string;
  /** Must exist in the asset catalog. */
  asset_id: string;
  /** Human-readable name used for AI target resolution (e.g. "shop_2"). */
  label: string;
  transform: Transform;
}

export interface SceneSnapshot {
  version: number;
  objects: SceneObject[];
  /** Confirmed surface position/orientation in world space. */
  origin: Transform | null;
}

// ─── SceneState ────────────────────────────────────────────────────────────

export class SceneState {
  private objects = new Map<string, SceneObject>();
  private origin: Transform | null = null;
  private version = 0;

  // ── Origin ──────────────────────────────────────────────────────────────

  setOrigin(t: Transform): void {
    this.origin = t;
  }

  getOrigin(): Transform | null {
    return this.origin;
  }

  // ── Objects ──────────────────────────────────────────────────────────────

  add(obj: SceneObject): void {
    this.objects.set(obj.id, { ...obj });
  }

  remove(id: string): void {
    this.objects.delete(id);
  }

  get(id: string): SceneObject | undefined {
    return this.objects.get(id);
  }

  getAll(): SceneObject[] {
    return Array.from(this.objects.values());
  }

  /**
   * Update the transform of an existing object.
   * Silently ignores unknown IDs.
   */
  update(id: string, transform: Partial<Transform>): void {
    const obj = this.objects.get(id);
    if (obj == null) return;
    this.objects.set(id, {
      ...obj,
      transform: { ...obj.transform, ...transform },
    });
  }

  /**
   * Case-insensitive label lookup.
   * Used by the Scene Engine to resolve AI target_label references.
   */
  resolve(label: string): SceneObject | undefined {
    const lower = label.toLowerCase();
    for (const obj of this.objects.values()) {
      if (obj.label.toLowerCase() === lower) return obj;
    }
    return undefined;
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
      objects: Array.from(this.objects.values()).map((o) => ({ ...o })),
      origin: this.origin,
    };
  }

  deserialize(snapshot: SceneSnapshot): void {
    this.objects.clear();
    for (const obj of snapshot.objects) {
      this.objects.set(obj.id, { ...obj });
    }
    this.origin = snapshot.origin;
    this.version = snapshot.version;
  }

  /** Increment version — call after every mutation that should be persisted. */
  bumpVersion(): void {
    this.version++;
  }
}
