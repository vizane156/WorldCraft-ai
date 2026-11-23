/**
 * SceneEngine — single point of truth for the 3D scene graph.
 *
 * Accepts validated SceneAction objects, executes manual/inspector edits,
 * enforces BoundaryGuard constraints, builds multi-part procedural PBR models,
 * and supports undo/redo + atmosphere synchronization.
 */

import { Group, Object3D } from '@iwsdk/core';
import {
  SceneState,
  type AtmospherePreset,
  type SceneObject,
  type SceneSnapshot,
} from './SceneState';
import {
  BoundaryGuard,
  DEFAULT_MAX_OBJECTS,
  DEFAULT_SCENE_RADIUS_M,
} from './BoundaryGuard';
import { getAsset, isKnownAsset } from '../catalog/assetCatalog';
import {
  animateSceneObject,
  buildProceduralAsset,
} from './ProceduralAssetBuilder';
import type { Transform } from '../interaction/InteractionAdapter';

// ─── Scene action types (mirror of server/sceneCommandSchema.json) ─────────

export interface AddObjectAction {
  action_type: 'add_object';
  asset_id: string;
  label: string;
  position: [number, number, number];
  rotation_y?: number;
  scale?: number;
  color?: string;
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
  rotation_y?: number;
  color?: string;
}

export interface SetAtmosphereAction {
  action_type: 'set_atmosphere';
  preset: AtmospherePreset;
}

export interface ClearSceneAction {
  action_type: 'clear_scene';
}

export type SceneAction =
  | AddObjectAction
  | MoveObjectAction
  | RemoveObjectAction
  | ModifyObjectAction
  | SetAtmosphereAction
  | ClearSceneAction;

type SceneEventType =
  | 'sceneChanged'
  | 'objectTransformed'
  | 'selectionChanged'
  | 'atmosphereChanged';
type SceneEventHandler = () => void;

export class SceneEngine {
  readonly root: Group;

  private state: SceneState;
  private guard: BoundaryGuard;
  private listeners = new Map<SceneEventType, Set<SceneEventHandler>>();
  private object3DMap = new Map<string, Object3D>();
  private selectedId: string | null = null;

  constructor(state: SceneState, guard: BoundaryGuard) {
    this.state = state;
    this.guard = guard;
    this.root = new Group();
    this.root.name = 'worldcraft-scene-root';
  }

  on(event: SceneEventType, handler: SceneEventHandler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private emit(event: SceneEventType): void {
    this.listeners.get(event)?.forEach((h) => h());
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  getSelectedId(): string | null {
    return this.selectedId;
  }

  getSelectedObject(): SceneObject | undefined {
    return this.selectedId ? this.state.get(this.selectedId) : undefined;
  }

  setSelectedId(id: string | null): void {
    if (id !== null && !this.state.has(id)) {
      id = null;
    }
    this.selectedId = id;
    this.emit('selectionChanged');
  }

  // ── Surface origin ─────────────────────────────────────────────────────────

  setOrigin(transform: Transform): void {
    const [x, y, z] = transform.position;
    this.root.position.set(x, y, z);
    const [qx, qy, qz, qw] = transform.rotation;
    this.root.quaternion.set(qx, qy, qz, qw);
  }

  // ── Command execution ──────────────────────────────────────────────────────

  async execute(actions: SceneAction[]): Promise<void> {
    if (actions.length === 0) return;

    this.state.pushUndoSnapshot();
    const warnings: string[] = [];
    let atmosphereUpdated = false;

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
        case 'set_atmosphere':
          this.state.setAtmosphere(action.preset);
          atmosphereUpdated = true;
          break;
        case 'clear_scene':
          this.clearAllMeshes();
          this.state.clear();
          this.selectedId = null;
          break;
      }
    }

    if (warnings.length > 0) {
      console.warn('[SceneEngine] Warnings during execute:', warnings);
    }

    this.state.bumpVersion();
    if (atmosphereUpdated) this.emit('atmosphereChanged');
    this.emit('selectionChanged');
    this.emit('sceneChanged');
  }

  private execAdd(action: AddObjectAction, warnings: string[]): void {
    if (!isKnownAsset(action.asset_id)) {
      warnings.push(`Unknown asset_id "${action.asset_id}" — skipped.`);
      return;
    }
    if (this.state.size >= DEFAULT_MAX_OBJECTS) {
      warnings.push(`Scene object limit (${DEFAULT_MAX_OBJECTS}) reached — skipped.`);
      return;
    }

    const meta = getAsset(action.asset_id);
    const minScale = meta?.min_scale ?? 0.25;
    const maxScale = meta?.max_scale ?? 2.5;
    const clampedScale = this.guard.clampScale(action.scale ?? 1.0, minScale, maxScale);
    const clampedPos = this.guard.clampPosition(action.position, DEFAULT_SCENE_RADIUS_M);

    const id = crypto.randomUUID();
    const rotY = ((action.rotation_y ?? 0) * Math.PI) / 180;
    const uniqueLabel = this.state.generateUniqueLabel(action.label);

    const mesh = buildProceduralAsset(action.asset_id, action.color);
    mesh.name = id;
    mesh.position.set(...clampedPos);
    mesh.rotation.y = rotY;
    mesh.scale.setScalar(clampedScale);

    this.root.add(mesh);
    this.object3DMap.set(id, mesh);

    this.state.add({
      id,
      asset_id: action.asset_id,
      label: uniqueLabel,
      color: action.color,
      transform: {
        position: clampedPos,
        rotation: [0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2)],
        scale: [clampedScale, clampedScale, clampedScale],
      },
    });
    this.selectedId = id;
  }

  private execMove(action: MoveObjectAction, warnings: string[]): void {
    const obj = this.state.resolve(action.target_label);
    if (obj == null) {
      warnings.push(`target_label "${action.target_label}" not found — skipped.`);
      return;
    }
    const mesh = this.object3DMap.get(obj.id);
    if (mesh == null) return;

    const clampedPos = this.guard.clampPosition(action.position, DEFAULT_SCENE_RADIUS_M);
    mesh.position.set(...clampedPos);

    let nextRotation = obj.transform.rotation;
    if (action.rotation_y != null) {
      const rotY = (action.rotation_y * Math.PI) / 180;
      mesh.rotation.y = rotY;
      nextRotation = [0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2)];
    }
    this.state.update(obj.id, { position: clampedPos, rotation: nextRotation });
  }

  private execRemove(action: RemoveObjectAction, warnings: string[]): void {
    const obj = this.state.resolve(action.target_label);
    if (obj == null) {
      warnings.push(`target_label "${action.target_label}" not found — skipped.`);
      return;
    }
    this.removeByIdInternal(obj.id);
  }

  private execModify(action: ModifyObjectAction, warnings: string[]): void {
    const obj = this.state.resolve(action.target_label);
    if (obj == null) {
      warnings.push(`target_label "${action.target_label}" not found — skipped.`);
      return;
    }
    const mesh = this.object3DMap.get(obj.id);
    if (mesh == null) return;

    const meta = getAsset(obj.asset_id);
    const minScale = meta?.min_scale ?? 0.25;
    const maxScale = meta?.max_scale ?? 2.5;

    let nextScale = obj.transform.scale;
    if (action.scale != null) {
      const s = this.guard.clampScale(action.scale, minScale, maxScale);
      mesh.scale.setScalar(s);
      nextScale = [s, s, s];
    }

    let nextRot = obj.transform.rotation;
    if (action.rotation_y != null) {
      const rotY = (action.rotation_y * Math.PI) / 180;
      mesh.rotation.y = rotY;
      nextRot = [0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2)];
    }

    if (action.color !== undefined) {
      this.rebuildMeshWithColor(obj.id, obj.asset_id, action.color);
    }

    this.state.update(
      obj.id,
      { scale: nextScale, rotation: nextRot },
      action.color !== undefined ? { color: action.color } : undefined,
    );
  }

  // ── Direct Studio Controls (Manual Place, Inspector Edit, Undo/Redo) ─────

  placeAssetManual(assetId: string): SceneObject | null {
    if (!isKnownAsset(assetId) || this.state.size >= DEFAULT_MAX_OBJECTS) {
      return null;
    }
    // Spiral placement around origin so placed objects don't stack on top of each other
    const count = this.state.size;
    const angle = count * 1.15;
    const radius = count === 0 ? 0 : Math.min(0.38, 0.14 + (count % 5) * 0.06);
    const pos: [number, number, number] = [
      Number((Math.cos(angle) * radius).toFixed(3)),
      0,
      Number((Math.sin(angle) * radius).toFixed(3)),
    ];

    const meta = getAsset(assetId);
    const label = this.state.generateUniqueLabel(meta?.id ?? assetId);
    void this.execute([
      {
        action_type: 'add_object',
        asset_id: assetId,
        label,
        position: pos,
        rotation_y: 0,
        scale: 1,
      },
    ]);
    return this.getSelectedObject() ?? null;
  }

  updateObjectManual(
    objectId: string,
    patch: {
      position?: [number, number, number];
      rotationYDeg?: number;
      scale?: number;
      color?: string;
    },
    recordUndo = true,
  ): void {
    const obj = this.state.get(objectId);
    if (!obj) return;
    const mesh = this.object3DMap.get(objectId);
    if (!mesh) return;

    if (recordUndo) {
      this.state.pushUndoSnapshot();
    }

    const meta = getAsset(obj.asset_id);
    const minScale = meta?.min_scale ?? 0.25;
    const maxScale = meta?.max_scale ?? 2.5;

    const nextPos = patch.position
      ? this.guard.clampPosition(patch.position, DEFAULT_SCENE_RADIUS_M)
      : obj.transform.position;

    const nextScaleVal =
      patch.scale !== undefined
        ? this.guard.clampScale(patch.scale, minScale, maxScale)
        : obj.transform.scale[0];

    let nextRot = obj.transform.rotation;
    if (patch.rotationYDeg !== undefined) {
      const rad = (patch.rotationYDeg * Math.PI) / 180;
      nextRot = [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];
    }

    if (patch.color !== undefined && patch.color !== obj.color) {
      this.rebuildMeshWithColor(objectId, obj.asset_id, patch.color);
    }

    const activeMesh = this.object3DMap.get(objectId)!;
    activeMesh.position.set(...nextPos);
    activeMesh.quaternion.set(...nextRot);
    activeMesh.scale.setScalar(nextScaleVal);

    this.state.update(
      objectId,
      {
        position: nextPos,
        rotation: nextRot,
        scale: [nextScaleVal, nextScaleVal, nextScaleVal],
      },
      patch.color !== undefined ? { color: patch.color } : undefined,
    );
    this.state.bumpVersion();
    this.emit('objectTransformed');
    this.emit('sceneChanged');
  }

  removeObjectById(objectId: string): void {
    if (!this.state.has(objectId)) return;
    this.state.pushUndoSnapshot();
    this.removeByIdInternal(objectId);
    this.state.bumpVersion();
    this.emit('selectionChanged');
    this.emit('sceneChanged');
  }

  duplicateObjectById(objectId: string): void {
    const obj = this.state.get(objectId);
    if (!obj || this.state.size >= DEFAULT_MAX_OBJECTS) return;
    const offsetPos = this.guard.clampPosition(
      [obj.transform.position[0] + 0.14, obj.transform.position[1], obj.transform.position[2] + 0.08],
      DEFAULT_SCENE_RADIUS_M,
    );
    const rotY = Math.round(
      (2 * Math.atan2(obj.transform.rotation[1], obj.transform.rotation[3]) * 180) / Math.PI,
    );
    void this.execute([
      {
        action_type: 'add_object',
        asset_id: obj.asset_id,
        label: this.state.generateUniqueLabel(obj.label),
        position: offsetPos,
        rotation_y: rotY,
        scale: obj.transform.scale[0],
        ...(obj.color ? { color: obj.color } : {}),
      },
    ]);
  }

  setAtmosphereManual(preset: AtmospherePreset): void {
    if (this.state.getAtmosphere() === preset) return;
    this.state.pushUndoSnapshot();
    this.state.setAtmosphere(preset);
    this.state.bumpVersion();
    this.emit('atmosphereChanged');
    this.emit('sceneChanged');
  }

  clearSceneManual(): void {
    if (this.state.size === 0) return;
    this.state.pushUndoSnapshot();
    this.clearAllMeshes();
    this.state.clear();
    this.selectedId = null;
    this.state.bumpVersion();
    this.emit('selectionChanged');
    this.emit('sceneChanged');
  }

  async undo(): Promise<boolean> {
    const prev = this.state.popUndo();
    if (!prev) return false;
    await this.deserialize(prev);
    this.emit('atmosphereChanged');
    this.emit('selectionChanged');
    this.emit('sceneChanged');
    return true;
  }

  async redo(): Promise<boolean> {
    const next = this.state.popRedo();
    if (!next) return false;
    await this.deserialize(next);
    this.emit('atmosphereChanged');
    this.emit('selectionChanged');
    this.emit('sceneChanged');
    return true;
  }

  // ── Live transform update (called during drag, before release) ────────────

  previewTransform(objectId: string, position: [number, number, number]): void {
    const mesh = this.object3DMap.get(objectId);
    if (mesh != null) mesh.position.set(...position);
  }

  applyTransform(objectId: string, transform: Transform): void {
    const mesh = this.object3DMap.get(objectId);
    if (mesh == null) return;

    this.state.pushUndoSnapshot();
    mesh.position.set(...transform.position);
    mesh.quaternion.set(...transform.rotation);
    mesh.scale.set(...transform.scale);
    this.state.update(objectId, transform);
    this.state.bumpVersion();
    this.emit('objectTransformed');
    this.emit('sceneChanged');
  }

  // ── Serialize / deserialize ────────────────────────────────────────────────

  serialize(): SceneSnapshot {
    return this.state.serialize();
  }

  async deserialize(snapshot: SceneSnapshot): Promise<void> {
    this.clearAllMeshes();
    this.state.deserialize(snapshot);

    for (const obj of this.state.getAll()) {
      const mesh = buildProceduralAsset(obj.asset_id, obj.color);
      mesh.name = obj.id;
      mesh.position.set(...obj.transform.position);
      mesh.quaternion.set(...obj.transform.rotation);
      mesh.scale.set(...obj.transform.scale);
      this.root.add(mesh);
      this.object3DMap.set(obj.id, mesh);
    }

    if (this.selectedId && !this.state.has(this.selectedId)) {
      this.selectedId = null;
    }
    this.emit('atmosphereChanged');
    this.emit('selectionChanged');
    this.emit('sceneChanged');
  }

  tickAnimations(elapsed: number): void {
    for (const mesh of this.object3DMap.values()) {
      animateSceneObject(mesh, elapsed);
    }
  }

  getObject3D(objectId: string): Object3D | undefined {
    return this.object3DMap.get(objectId);
  }

  getSceneObjects(): Map<string, Object3D> {
    return this.object3DMap;
  }

  private removeByIdInternal(id: string): void {
    const mesh = this.object3DMap.get(id);
    if (mesh != null) {
      this.root.remove(mesh);
      this.object3DMap.delete(id);
    }
    this.state.remove(id);
    if (this.selectedId === id) {
      this.selectedId = null;
    }
  }

  private clearAllMeshes(): void {
    for (const [id, mesh] of this.object3DMap) {
      this.root.remove(mesh);
      this.object3DMap.delete(id);
    }
  }

  private rebuildMeshWithColor(
    objectId: string,
    assetId: string,
    color?: string,
  ): void {
    const oldMesh = this.object3DMap.get(objectId);
    const newMesh = buildProceduralAsset(assetId, color);
    newMesh.name = objectId;
    if (oldMesh) {
      newMesh.position.copy(oldMesh.position);
      newMesh.quaternion.copy(oldMesh.quaternion);
      newMesh.scale.copy(oldMesh.scale);
      this.root.remove(oldMesh);
    }
    this.root.add(newMesh);
    this.object3DMap.set(objectId, newMesh);
  }
}
