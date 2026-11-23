import * as THREE from 'three';
import {
  DistanceGrabbable,
  Entity,
  MovementMode,
  RayInteractable,
  World,
} from '@iwsdk/core';
import { getAsset } from '../catalog/assetCatalog';
import { WorldCraftItem } from '../components';
import { BoundaryGuard } from './BoundaryGuard';
import {
  applyAssetAccentColor,
  buildProceduralAsset,
} from './ProceduralAssetBuilder';
import {
  AtmospherePreset,
  SceneCommandBatch,
  SceneObjectData,
  SceneSnapshot,
  SceneState,
} from './SceneState';

export interface SceneChangeEvent {
  reason: 'command' | 'edit' | 'undo' | 'redo' | 'load' | 'restore' | 'xr-grab';
  persist: boolean;
  note?: string;
}

export class SceneEngine {
  readonly state: SceneState;
  readonly guard: BoundaryGuard;
  readonly root: THREE.Group;

  private meshes = new Map<string, THREE.Group>();
  private entities = new Map<string, Entity>();
  private world: World | null = null;
  private rootEntity: Entity | null = null;

  private selectedId: string | null = null;
  private changeListeners = new Set<(ev: SceneChangeEvent) => void>();
  private selectionListeners = new Set<(id: string | null) => void>();
  private atmosphereListeners = new Set<(preset: AtmospherePreset) => void>();

  constructor(sessionId: string) {
    this.state = new SceneState(sessionId);
    this.guard = new BoundaryGuard();
    this.root = new THREE.Group();
    this.root.name = 'WorldCraftObjectsRoot';
  }

  bindWorld(world: World): void {
    this.world = world;
    this.rootEntity = world.createTransformEntity(this.root, {
      parent: world.sceneEntity,
    });
    // Upgrade any pre-existing meshes into grabbable ECS entities
    for (const [id, mesh] of this.meshes.entries()) {
      if (!this.entities.has(id)) {
        const obj = this.state.getObject(id);
        if (obj) {
          this.attachEntity(obj, mesh);
        }
      }
    }
  }

  getRootEntity(): Entity | null {
    return this.rootEntity;
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getMesh(id: string): THREE.Group | undefined {
    return this.meshes.get(id);
  }

  getMeshMap(): Map<string, THREE.Group> {
    return this.meshes;
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  setSelectedId(id: string | null): void {
    const resolved = id && this.meshes.has(id) ? id : null;
    if (this.selectedId === resolved) return;
    this.selectedId = resolved;
    for (const cb of this.selectionListeners) cb(this.selectedId);
  }

  onChange(cb: (ev: SceneChangeEvent) => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  onSelectionChange(cb: (id: string | null) => void): () => void {
    this.selectionListeners.add(cb);
    return () => this.selectionListeners.delete(cb);
  }

  onAtmosphereChange(cb: (preset: AtmospherePreset) => void): () => void {
    this.atmosphereListeners.add(cb);
    return () => this.atmosphereListeners.delete(cb);
  }

  private emitChange(ev: SceneChangeEvent): void {
    for (const cb of this.changeListeners) cb(ev);
  }

  private attachEntity(data: SceneObjectData, mesh: THREE.Group): void {
    if (!this.world || !this.rootEntity) return;
    const entity = this.world.createTransformEntity(mesh, {
      parent: this.rootEntity,
    });
    entity.addComponent(WorldCraftItem, {
      objectId: data.id,
      assetId: data.asset_id,
    });
    entity.addComponent(RayInteractable);
    entity.addComponent(DistanceGrabbable, {
      translate: true,
      rotate: true,
      scale: true,
      movementMode: MovementMode.MoveAtSource,
      scaleMin: [0.25, 0.25, 0.25],
      scaleMax: [3.0, 3.0, 3.0],
    });
    this.entities.set(data.id, entity);
  }

  private createSceneObject(data: SceneObjectData): void {
    const mesh = buildProceduralAsset(data.asset_id, data.color);
    mesh.userData.objectId = data.id;
    mesh.position.set(data.position[0], data.position[1], data.position[2]);
    mesh.rotation.y = data.rotation_y;
    mesh.scale.setScalar(data.scale);
    this.root.add(mesh);
    this.meshes.set(data.id, mesh);
    this.state.upsertObject(data);
    this.attachEntity(data, mesh);
  }

  private destroySceneObject(id: string): void {
    const entity = this.entities.get(id);
    if (entity) {
      try {
        entity.destroy();
      } catch {
        // Ignore if already destroyed
      }
      this.entities.delete(id);
    }
    const mesh = this.meshes.get(id);
    if (mesh) {
      this.root.remove(mesh);
      this.meshes.delete(id);
    }
    this.state.removeObject(id);
    if (this.selectedId === id) {
      this.setSelectedId(null);
    }
  }

  private rebuildMeshesFromState(): void {
    for (const id of Array.from(this.meshes.keys())) {
      const entity = this.entities.get(id);
      if (entity) {
        try {
          entity.destroy();
        } catch {
          // Safe cleanup
        }
        this.entities.delete(id);
      }
      const mesh = this.meshes.get(id);
      if (mesh) {
        this.root.remove(mesh);
        this.meshes.delete(id);
      }
    }

    for (const obj of this.state.getAllObjects()) {
      const mesh = buildProceduralAsset(obj.asset_id, obj.color);
      mesh.userData.objectId = obj.id;
      mesh.position.set(obj.position[0], obj.position[1], obj.position[2]);
      mesh.rotation.y = obj.rotation_y;
      mesh.scale.setScalar(obj.scale);
      this.root.add(mesh);
      this.meshes.set(obj.id, mesh);
      this.attachEntity(obj, mesh);
    }

    if (this.selectedId && !this.meshes.has(this.selectedId)) {
      this.setSelectedId(null);
    }
    for (const cb of this.atmosphereListeners) cb(this.state.atmosphere);
  }

  spawnManual(
    assetId: string,
    position?: [number, number, number],
  ): SceneObjectData | null {
    if (!this.guard.canAdd(this.state.getCount())) {
      return null;
    }
    const asset = getAsset(assetId);
    if (!asset) return null;

    this.state.checkpoint();
    const existing = this.state.getAllObjects();
    let candidatePos: [number, number, number] = position ?? [0, 0, 0];

    if (!position) {
      let placed = false;
      for (let step = 0; step < 36; step++) {
        const angle = (existing.length + step) * 2.39996;
        const r = Math.min(6.4, 2.1 + Math.floor(step / 5) * 0.9 + (step % 3) * 0.45);
        const cx = Number((Math.cos(angle) * r).toFixed(2));
        const cz = Number((Math.sin(angle) * r).toFixed(2));
        const collides = existing.some((o) => {
          const otherAsset = getAsset(o.asset_id);
          const minSep = (otherAsset?.boundingRadius ?? 1.0) * o.scale + asset.boundingRadius + 0.35;
          return Math.hypot(cx - o.position[0], cz - o.position[2]) < minSep;
        });
        if (!collides) {
          candidatePos = [cx, 0, cz];
          placed = true;
          break;
        }
      }
      if (!placed) {
        const angle = existing.length * 2.39996;
        candidatePos = [
          Number((Math.cos(angle) * 4.5).toFixed(2)),
          0,
          Number((Math.sin(angle) * 4.5).toFixed(2)),
        ];
      }
    }

    const id = `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const clampedPos = this.guard.clampPosition(
      candidatePos,
      asset.boundingRadius,
      asset.defaultScale,
    );

    const data: SceneObjectData = {
      id,
      asset_id: asset.id,
      label: asset.name,
      position: clampedPos,
      rotation_y: 0,
      scale: asset.defaultScale,
      color: asset.defaultColor,
    };

    this.createSceneObject(data);
    this.setSelectedId(data.id);
    this.emitChange({ reason: 'edit', persist: true, note: `Added ${asset.name}` });
    return data;
  }

  updateObjectTransform(
    id: string,
    patch: {
      position?: [number, number, number];
      rotation_y?: number;
      scale?: number;
      color?: string;
      label?: string;
    },
    checkpoint = true,
    persist = true,
  ): SceneObjectData | null {
    const existing = this.state.getObject(id);
    const mesh = this.meshes.get(id);
    if (!existing || !mesh) return null;

    if (checkpoint) {
      this.state.checkpoint();
    }

    const asset = getAsset(existing.asset_id);
    const nextScale =
      patch.scale !== undefined ? this.guard.clampScale(patch.scale) : existing.scale;
    const nextPos =
      patch.position !== undefined
        ? this.guard.clampPosition(patch.position, asset?.boundingRadius ?? 0.8, nextScale)
        : existing.position;
    const nextRot =
      patch.rotation_y !== undefined
        ? this.guard.normalizeRotationY(patch.rotation_y)
        : existing.rotation_y;
    const nextColor = patch.color ?? existing.color;
    const nextLabel = patch.label?.trim() || existing.label;

    const updated: SceneObjectData = {
      ...existing,
      position: nextPos,
      rotation_y: nextRot,
      scale: nextScale,
      color: nextColor,
      label: nextLabel,
    };

    mesh.position.set(updated.position[0], updated.position[1], updated.position[2]);
    mesh.rotation.set(0, updated.rotation_y, 0);
    mesh.scale.setScalar(updated.scale);
    if (patch.color && patch.color !== existing.color) {
      applyAssetAccentColor(mesh, updated.color);
    }

    this.state.upsertObject(updated);
    this.emitChange({ reason: 'edit', persist });
    return updated;
  }

  commitLiveXrTransform(id: string): void {
    const existing = this.state.getObject(id);
    const mesh = this.meshes.get(id);
    if (!existing || !mesh) return;

    const asset = getAsset(existing.asset_id);
    const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, 'YXZ');
    const clampedScale = this.guard.clampScale(mesh.scale.x);
    const clampedPos = this.guard.clampPosition(
      [mesh.position.x, mesh.position.y, mesh.position.z],
      asset?.boundingRadius ?? 0.8,
      clampedScale,
    );
    const normalizedRot = this.guard.normalizeRotationY(euler.y);

    this.state.checkpoint();
    mesh.position.set(clampedPos[0], clampedPos[1], clampedPos[2]);
    mesh.rotation.set(0, normalizedRot, 0);
    mesh.scale.setScalar(clampedScale);

    this.state.upsertObject({
      ...existing,
      position: clampedPos,
      rotation_y: normalizedRot,
      scale: clampedScale,
    });
    this.emitChange({
      reason: 'xr-grab',
      persist: true,
      note: `XR moved ${existing.label}`,
    });
  }

  duplicateObject(id: string): SceneObjectData | null {
    const existing = this.state.getObject(id);
    if (!existing || !this.guard.canAdd(this.state.getCount())) return null;
    const asset = getAsset(existing.asset_id);
    const offsetPos = this.guard.clampPosition(
      [existing.position[0] + 1.1, existing.position[1], existing.position[2] + 0.9],
      asset?.boundingRadius ?? 0.8,
      existing.scale,
    );
    this.state.checkpoint();
    const copy: SceneObjectData = {
      ...existing,
      id: `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      label: `${existing.label} Copy`,
      position: offsetPos,
    };
    this.createSceneObject(copy);
    this.setSelectedId(copy.id);
    this.emitChange({ reason: 'edit', persist: true, note: `Duplicated ${existing.label}` });
    return copy;
  }

  deleteObject(id: string): boolean {
    if (!this.meshes.has(id)) return false;
    const label = this.state.getObject(id)?.label || 'Object';
    this.state.checkpoint();
    this.destroySceneObject(id);
    this.emitChange({ reason: 'edit', persist: true, note: `Deleted ${label}` });
    return true;
  }

  clearScene(): void {
    if (this.state.getCount() === 0) return;
    this.state.checkpoint();
    for (const id of Array.from(this.meshes.keys())) {
      this.destroySceneObject(id);
    }
    this.emitChange({ reason: 'edit', persist: true, note: 'Cleared scene' });
  }

  setTitle(title: string): void {
    const trimmed = title.trim() || 'Untitled Spatial World';
    if (trimmed === this.state.title) return;
    this.state.title = trimmed;
    this.emitChange({ reason: 'edit', persist: true });
  }

  setAtmosphere(preset: AtmospherePreset, persist = true): void {
    if (this.state.atmosphere === preset) return;
    this.state.checkpoint();
    this.state.atmosphere = preset;
    for (const cb of this.atmosphereListeners) cb(preset);
    this.emitChange({ reason: 'edit', persist, note: `Atmosphere: ${preset}` });
  }

  applyCommandBatch(batch: SceneCommandBatch, note?: string): number {
    this.state.checkpoint();
    let applied = 0;

    if (batch.atmosphere) {
      this.state.atmosphere = batch.atmosphere;
      for (const cb of this.atmosphereListeners) cb(batch.atmosphere!);
    }

    for (const cmd of batch.commands) {
      if (cmd.action === 'clear') {
        for (const id of Array.from(this.meshes.keys())) {
          this.destroySceneObject(id);
        }
        applied++;
        continue;
      }

      if (cmd.action === 'spawn') {
        if (!this.guard.canAdd(this.state.getCount())) continue;
        const asset = getAsset(cmd.asset_id);
        if (!asset) continue;
        const id =
          cmd.target_id && !this.meshes.has(cmd.target_id)
            ? cmd.target_id
            : `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const scale = this.guard.clampScale(cmd.scale ?? asset.defaultScale);
        const pos = this.guard.clampPosition(cmd.position, asset.boundingRadius, scale);
        const rot = this.guard.normalizeRotationY(cmd.rotation_y ?? 0);

        this.createSceneObject({
          id,
          asset_id: asset.id,
          label: cmd.label?.trim() || asset.name,
          position: pos,
          rotation_y: rot,
          scale,
          color: cmd.color || asset.defaultColor,
        });
        applied++;
        continue;
      }

      if (cmd.action === 'move') {
        const updated = this.updateObjectTransform(
          cmd.target_id,
          {
            ...(cmd.position ? { position: cmd.position } : {}),
            ...(cmd.rotation_y !== undefined ? { rotation_y: cmd.rotation_y } : {}),
          },
          false,
          false,
        );
        if (updated) applied++;
        continue;
      }

      if (cmd.action === 'modify') {
        const updated = this.updateObjectTransform(
          cmd.target_id,
          {
            ...(cmd.scale !== undefined ? { scale: cmd.scale } : {}),
            ...(cmd.rotation_y !== undefined ? { rotation_y: cmd.rotation_y } : {}),
            ...(cmd.color ? { color: cmd.color } : {}),
            ...(cmd.label ? { label: cmd.label } : {}),
          },
          false,
          false,
        );
        if (updated) applied++;
        continue;
      }

      if (cmd.action === 'delete') {
        if (this.meshes.has(cmd.target_id)) {
          this.destroySceneObject(cmd.target_id);
          applied++;
        }
      }
    }

    this.emitChange({
      reason: 'command',
      persist: true,
      note: note || batch.assistantMessage || 'AI scene update',
    });
    return applied;
  }

  undo(): boolean {
    if (!this.state.undo()) return false;
    this.rebuildMeshesFromState();
    this.emitChange({ reason: 'undo', persist: true, note: 'Undo' });
    return true;
  }

  redo(): boolean {
    if (!this.state.redo()) return false;
    this.rebuildMeshesFromState();
    this.emitChange({ reason: 'redo', persist: true, note: 'Redo' });
    return true;
  }

  loadSnapshot(
    snapshot: SceneSnapshot,
    reason: 'load' | 'restore' = 'load',
  ): void {
    const normalized: SceneObjectData[] = (snapshot.objects || []).map((o) => {
      const asset = getAsset(o.asset_id);
      return {
        id: o.id,
        asset_id: o.asset_id,
        label: o.label || asset?.name || o.asset_id,
        position: o.position,
        rotation_y: o.rotation_y ?? 0,
        scale: o.scale ?? 1,
        color: o.color || asset?.defaultColor || '#38bdf8',
      };
    });

    this.state.replaceState(
      snapshot.title || 'Untitled Spatial World',
      snapshot.atmosphere || 'daylight',
      normalized,
      snapshot.version,
    );
    this.rebuildMeshesFromState();
    this.emitChange({ reason, persist: false });
  }
}
