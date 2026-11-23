import * as THREE from 'three';
import { SceneEngine } from '../scene/SceneEngine';
import { StudioEnvironment } from '../scene/StudioEnvironment';
import type { InteractionAdapter } from './InteractionAdapter';

export class DesktopInteractionAdapter implements InteractionAdapter {
  private engine: SceneEngine;
  private env: StudioEnvironment;
  private canvas: HTMLCanvasElement;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hitPoint = new THREE.Vector3();

  private draggingId: string | null = null;
  private dragOffset = new THREE.Vector3();
  private pointerDownClient = new THREE.Vector2();
  private didDrag = false;
  private attached = false;

  constructor(engine: SceneEngine, env: StudioEnvironment, canvas: HTMLCanvasElement) {
    this.engine = engine;
    this.env = env;
    this.canvas = canvas;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  private updateNdc(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private findObjectId(obj: THREE.Object3D | null): string | null {
    let curr: THREE.Object3D | null = obj;
    while (curr && curr !== this.engine.root) {
      if (typeof curr.userData?.objectId === 'string') {
        return curr.userData.objectId;
      }
      curr = curr.parent;
    }
    return null;
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0 || !this.env.controls.enabled) return;

    this.pointerDownClient.set(ev.clientX, ev.clientY);
    this.didDrag = false;
    this.updateNdc(ev);
    this.raycaster.setFromCamera(this.ndc, this.env.camera);

    const targets = Array.from(this.engine.getMeshMap().values());
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return;

    const hitId = this.findObjectId(hits[0].object);
    if (!hitId) return;

    this.engine.setSelectedId(hitId);
    const mesh = this.engine.getMesh(hitId);
    if (!mesh) return;

    const localFloor = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -this.engine.root.position.y,
    );
    if (this.raycaster.ray.intersectPlane(localFloor, this.hitPoint)) {
      const worldMeshPos = new THREE.Vector3();
      mesh.getWorldPosition(worldMeshPos);
      this.dragOffset.copy(worldMeshPos).sub(this.hitPoint);
      this.draggingId = hitId;
      this.env.controls.enabled = false;
      this.engine.state.checkpoint();
    }
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.draggingId) return;
    if (
      Math.hypot(ev.clientX - this.pointerDownClient.x, ev.clientY - this.pointerDownClient.y) >
      3
    ) {
      this.didDrag = true;
    }

    this.updateNdc(ev);
    this.raycaster.setFromCamera(this.ndc, this.env.camera);
    this.floorPlane.constant = -this.engine.root.position.y;
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, this.hitPoint)) {
      return;
    }

    const desiredWorld = this.hitPoint.clone().add(this.dragOffset);
    const localPoint = this.engine.root.worldToLocal(desiredWorld);
    const current = this.engine.state.getObject(this.draggingId);
    if (!current) return;

    this.engine.updateObjectTransform(
      this.draggingId,
      { position: [localPoint.x, current.position[1], localPoint.z] },
      false,
      false,
    );
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (this.draggingId) {
      const id = this.draggingId;
      this.draggingId = null;
      this.env.controls.enabled = true;
      if (this.didDrag) {
        const obj = this.engine.state.getObject(id);
        if (obj) {
          this.engine.updateObjectTransform(
            id,
            { position: obj.position },
            false,
            true,
          );
        }
      }
      return;
    }

    if (
      ev.button === 0 &&
      ev.target === this.canvas &&
      Math.hypot(ev.clientX - this.pointerDownClient.x, ev.clientY - this.pointerDownClient.y) <
        4
    ) {
      this.updateNdc(ev);
      this.raycaster.setFromCamera(this.ndc, this.env.camera);
      const targets = Array.from(this.engine.getMeshMap().values());
      const hits = this.raycaster.intersectObjects(targets, true);
      if (hits.length === 0) {
        this.engine.setSelectedId(null);
      }
    }
  };
}
