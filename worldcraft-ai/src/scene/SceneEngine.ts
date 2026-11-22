/**
 * SceneEngine — single point of truth for the 3D scene graph.
 *
 * Accepts only validated SceneAction objects and mutates the Three.js scene.
 * Has no knowledge of IWSDK, WebXR, mouse input, Gemini, or the network.
 *
 * Import Three.js from '@iwsdk/core', never from 'three' directly.
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from '@iwsdk/core';
import { SceneState } from './SceneState.js';
import { BoundaryGuard } from './BoundaryGuard.js';
import { isKnownAsset } from '../catalog/assetCatalog.js';
import type { Transform } from '../interaction/InteractionAdapter.js';

// ─── Scene action types (mirror of scene_command_schema.json) ──────────────

export interface AddObjectAction {
  action_type: 'add_object';
  asset_id: string;
  label: string;
  position: [number, number, number];
  rotation_y?: number;
  scale?: number;
}

export interface MoveObjectAction {
  action_type: 'move_object';
  target_label: string;
  position: [number, number, number];
  rotation_y?: number;
}

export interface RemoveObjectAction {
  action_type: 'remove_object';
  target_label: string;
}

export interface ModifyObjectAction {
  action_type: 'modify_object';
  target_label: string;
  scale?: number;
}

export type SceneAction =
  | AddObjectAction
  | MoveObjectAction
  | RemoveObjectAction
  | ModifyObjectAction;

// ─── Event emitter (minimal, no external dep) ─────────────────────────────

type SceneEventType = 'sceneChanged' | 'objectTransformed';
type SceneEventHandler = () => void;

// ─── SceneEngine ──────────────────────────────────────────────────────────

export class SceneEngine {
  /** Root Group positioned at the confirmed surface origin. */
  readonly root: Group;

  private state: SceneState;
  private guard: BoundaryGuard;
  private listeners = new Map<SceneEventType, Set<SceneEventHandler>>();

  /** Map from SceneObject.id to its Three.js Object3D. */
  private object3DMap = new Map<string, Object3D>();

  constructor(state: SceneState, guard: BoundaryGuard) {
    this.state = state;
    this.guard = guard;
    this.root = new Group();
    this.root.name = 'worldcraft-scene-root';
  }

  // ── Event bus ─────────────────────────────────────────────────────────────

  on(event: SceneEventType, handler: SceneEventHandler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private emit(event: SceneEventType): void {
    this.listeners.get(event)?.forEach((h) => h());
  }

  // ── Surface origin ─────────────────────────────────────────────────────────

  setOrigin(transform: Transform): void {
    const [x, y, z] = transform.position;
    this.root.position.set(x, y, z);
    // Rotation applied as quaternion
    const [qx, qy, qz, qw] = transform.rotation;
    this.root.quaternion.set(qx, qy, qz, qw);
  }

  // ── Command execution ──────────────────────────────────────────────────────

  async execute(actions: SceneAction[]): Promise<void> {
    const warnings: string[] = [];

    for (const action of actions) {
      switch (action.action_type) {
        case 'add_object':
          this.execAdd(action, warnings);
          break;
        case 'move_object':
          this.execMove(action, warnings);
          break;
        case 'remove_object':
          this.execRemove(action, warnings);
          break;
        case 'modify_object':
          this.execModify(action, warnings);
          break;
      }
    }

    if (warnings.length > 0) {
      console.warn('[SceneEngine] Warnings during execute:', warnings);
    }

    this.state.bumpVersion();
    this.emit('sceneChanged');
  }

  private execAdd(action: AddObjectAction, warnings: string[]): void {
    if (!isKnownAsset(action.asset_id)) {
      warnings.push(`Unknown asset_id "${action.asset_id}" — skipped.`);
      return;
    }

    const id = crypto.randomUUID();
    const scale = action.scale ?? 1.0;
    const rotY = ((action.rotation_y ?? 0) * Math.PI) / 180;

    const mesh = this.buildPlaceholder(action.asset_id, scale);
    mesh.name = id;
    mesh.position.set(...action.position);
    mesh.rotation.y = rotY;

    this.root.add(mesh);
    this.object3DMap.set(id, mesh);

    this.state.add({
      id,
      asset_id: action.asset_id,
      label: action.label,
      transform: {
        position: action.position,
        rotation: [0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2)],
        scale: [scale, scale, scale],
      },
    });
  }

  private execMove(action: MoveObjectAction, warnings: string[]): void {
    const obj = this.state.resolve(action.target_label);
    if (obj == null) {
      warnings.push(`target_label "${action.target_label}" not found — skipped.`);
      return;
    }
    const mesh = this.object3DMap.get(obj.id);
    if (mesh == null) return;

    mesh.position.set(...action.position);
    if (action.rotation_y != null) {
      mesh.rotation.y = (action.rotation_y * Math.PI) / 180;
    }
    this.state.update(obj.id, { position: action.position });
  }

  private execRemove(action: RemoveObjectAction, warnings: string[]): void {
    const obj = this.state.resolve(action.target_label);
    if (obj == null) {
      warnings.push(`target_label "${action.target_label}" not found — skipped.`);
      return;
    }
    const mesh = this.object3DMap.get(obj.id);
    if (mesh != null) {
      this.root.remove(mesh);
      this.object3DMap.delete(obj.id);
    }
    this.state.remove(obj.id);
  }

  private execModify(action: ModifyObjectAction, warnings: string[]): void {
    const obj = this.state.resolve(action.target_label);
    if (obj == null) {
      warnings.push(`target_label "${action.target_label}" not found — skipped.`);
      return;
    }
    const mesh = this.object3DMap.get(obj.id);
    if (mesh == null) return;

    if (action.scale != null) {
      mesh.scale.setScalar(action.scale);
      this.state.update(obj.id, {
        scale: [action.scale, action.scale, action.scale],
      });
    }
  }

  // ── Live transform update (called during drag, before release) ────────────

  previewTransform(objectId: string, position: [number, number, number]): void {
    const mesh = this.object3DMap.get(objectId);
    if (mesh != null) mesh.position.set(...position);
  }

  // ── Apply final clamped transform (called on objectReleased) ─────────────

  applyTransform(objectId: string, transform: Transform): void {
    const mesh = this.object3DMap.get(objectId);
    if (mesh == null) return;

    mesh.position.set(...transform.position);
    mesh.quaternion.set(...transform.rotation);
    mesh.scale.set(...transform.scale);
    this.state.update(objectId, transform);
    this.state.bumpVersion();
    this.emit('objectTransformed');
  }

  // ── Serialize / deserialize ────────────────────────────────────────────────

  serialize() {
    return this.state.serialize();
  }

  async deserialize(snapshot: ReturnType<SceneState['serialize']>): Promise<void> {
    // Remove all existing objects
    for (const [id, mesh] of this.object3DMap) {
      this.root.remove(mesh);
      this.object3DMap.delete(id);
    }

    this.state.deserialize(snapshot);

    // Re-create Three.js objects for each restored SceneObject
    for (const obj of this.state.getAll()) {
      const mesh = this.buildPlaceholder(obj.asset_id, obj.transform.scale[0]);
      mesh.name = obj.id;
      mesh.position.set(...obj.transform.position);
      mesh.quaternion.set(...obj.transform.rotation);
      mesh.scale.set(...obj.transform.scale);
      this.root.add(mesh);
      this.object3DMap.set(obj.id, mesh);
    }
  }

  /** Return the Three.js Object3D for a given scene object id, if any. */
  getObject3D(objectId: string): Object3D | undefined {
    return this.object3DMap.get(objectId);
  }

  /** Return all object3D entries — used by DesktopInteractionAdapter for raycasting. */
  getSceneObjects(): Map<string, Object3D> {
    return this.object3DMap;
  }

  // ── Placeholder geometry (replaced by AssetLoader in T-21) ───────────────

  private buildPlaceholder(assetId: string, scale: number): Mesh {
    const geo = new BoxGeometry(0.1, 0.1, 0.1);
    const mat = new MeshStandardMaterial({
      color: this.colorForAsset(assetId),
    });
    const mesh = new Mesh(geo, mat);
    mesh.scale.setScalar(scale);
    mesh.castShadow = false;
    return mesh;
  }

  private colorForAsset(assetId: string): number {
    // Deterministic color per asset for easy visual identification during dev
    const palette: Record<string, number> = {
      market_stall_japanese: 0xe07b39,
      fountain_stone:        0x7ab3c8,
      motorcycle_red:        0xd63a2f,
    };
    return palette[assetId] ?? 0x888888;
  }
}
