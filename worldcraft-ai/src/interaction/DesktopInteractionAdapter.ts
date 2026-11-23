/**
 * DesktopInteractionAdapter — mouse + OrbitControls coordination for 2D browsers.
 *
 * Input mapping:
 *   Click on scene object       → objectSelected (and temporarily suspends OrbitControls)
 *   Left-drag selected object   → objectMoved (raycast onto horizontal tabletop plane)
 *   Right-drag selected object  → objectRotated (Y axis)
 *   Alt + wheel on object       → objectScaled (plain wheel zooms OrbitControls)
 *   Drag empty canvas           → OrbitControls camera orbit / pan
 *   Mouse button release        → objectReleased (with final transform)
 */

import {
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import type {
  InteractionAdapter,
  InteractionEvent,
  InteractionEventHandler,
  Transform,
} from './InteractionAdapter';
import type { SceneEngine } from '../scene/SceneEngine';
import type { SceneState } from '../scene/SceneState';

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];
const DEFAULT_SCALE: [number, number, number] = [1, 1, 1];

export class DesktopInteractionAdapter implements InteractionAdapter {
  private canvas: HTMLElement;
  private camera: PerspectiveCamera;
  private engine: SceneEngine;
  private state: SceneState;
  private setOrbitEnabled: (enabled: boolean) => void;

  private handlers = new Set<InteractionEventHandler>();
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private dragPlane = new Plane(new Vector3(0, 1, 0), 0);
  private intersectPt = new Vector3();

  private dragObjectId: string | null = null;
  private dragButton: number | null = null;
  private lastPointerX = 0;
  private dragRotationY = 0;
  private dragScale = 1;
  private dragCurrentPosition: [number, number, number] = [0, 0, 0];
  private dragOffset = new Vector3();

  private _onPointerDown: (e: PointerEvent) => void;
  private _onPointerMove: (e: PointerEvent) => void;
  private _onPointerUp: (e: PointerEvent) => void;
  private _onWheel: (e: WheelEvent) => void;
  private _onContextMenu: (e: Event) => void;

  constructor(
    canvas: HTMLElement,
    camera: PerspectiveCamera,
    _threeScene: Scene,
    engine: SceneEngine,
    state: SceneState,
    setOrbitEnabled: (enabled: boolean) => void = () => {},
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.engine = engine;
    this.state = state;
    this.setOrbitEnabled = setOrbitEnabled;

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onWheel = this.onWheel.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this._onContextMenu);
  }

  confirmDefaultOrigin(): void {
    const origin: Transform = {
      position: [0, 0, 0],
      rotation: IDENTITY_QUAT,
      scale: DEFAULT_SCALE,
    };
    this.state.setOrigin(origin);
    this.emit({ type: 'surfaceConfirmed', origin });
  }

  update(_delta: number): void {}

  on(handler: InteractionEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    this.handlers.clear();
  }

  private emit(event: InteractionEvent): void {
    for (const h of this.handlers) h(event);
  }

  private updatePointer(e: PointerEvent | WheelEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private hitTestObject(): { objectId: string; hitPoint: Vector3 } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = Array.from(this.engine.getSceneObjects().values());
    if (meshes.length === 0) return null;
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return null;

    let target = hits[0].object;
    while (target.parent !== this.engine.root && target.parent != null) {
      target = target.parent;
    }
    const objectId = target.name;
    if (!this.state.has(objectId)) return null;
    return { objectId, hitPoint: hits[0].point };
  }

  private onPointerDown(e: PointerEvent): void {
    this.updatePointer(e);
    this.lastPointerX = e.clientX;

    const hit = this.hitTestObject();
    if (!hit) {
      // Clicking empty canvas lets OrbitControls handle orbit/pan
      if (e.button === 0 && this.engine.getSelectedId() !== null) {
        this.engine.setSelectedId(null);
      }
      return;
    }

    const { objectId } = hit;
    this.dragObjectId = objectId;
    this.dragButton = e.button;
    this.setOrbitEnabled(false);

    const obj = this.state.get(objectId)!;
    this.dragRotationY = 2 * Math.atan2(obj.transform.rotation[1], obj.transform.rotation[3]);
    this.dragScale = obj.transform.scale[0];
    this.dragCurrentPosition = [...obj.transform.position];

    // Setup horizontal plane at object's Y
    this.dragPlane.set(new Vector3(0, 1, 0), -obj.transform.position[1]);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectPt)) {
      this.dragOffset.set(
        obj.transform.position[0] - this.intersectPt.x,
        0,
        obj.transform.position[2] - this.intersectPt.z,
      );
    } else {
      this.dragOffset.set(0, 0, 0);
    }

    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if synthetic event has no active pointer
    }
    this.emit({ type: 'objectSelected', objectId });
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.dragObjectId == null) return;

    const dx = e.clientX - this.lastPointerX;
    this.lastPointerX = e.clientX;

    if (this.dragButton === 0) {
      this.updatePointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectPt)) {
        const pos: [number, number, number] = [
          this.intersectPt.x + this.dragOffset.x,
          this.dragCurrentPosition[1],
          this.intersectPt.z + this.dragOffset.z,
        ];
        this.dragCurrentPosition = pos;
        this.engine.previewTransform(this.dragObjectId, pos);
        this.emit({ type: 'objectMoved', objectId: this.dragObjectId, position: pos });
      }
    } else if (this.dragButton === 2) {
      const ROTATION_SENSITIVITY = 0.012;
      this.dragRotationY += dx * ROTATION_SENSITIVITY;
      this.emit({
        type: 'objectRotated',
        objectId: this.dragObjectId,
        rotationY: this.dragRotationY,
      });
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.dragObjectId == null) return;

    const obj = this.state.get(this.dragObjectId);
    if (obj != null) {
      const finalTransform: Transform = {
        position: this.dragCurrentPosition,
        rotation: [
          0,
          Math.sin(this.dragRotationY / 2),
          0,
          Math.cos(this.dragRotationY / 2),
        ],
        scale: [this.dragScale, this.dragScale, this.dragScale],
      };
      this.emit({
        type: 'objectReleased',
        objectId: this.dragObjectId,
        transform: finalTransform,
      });
    }

    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    this.dragObjectId = null;
    this.dragButton = null;
    this.setOrbitEnabled(true);
  }

  private onWheel(e: WheelEvent): void {
    if (!e.altKey && !e.shiftKey) {
      // Let OrbitControls zoom the camera cleanly
      return;
    }
    this.updatePointer(e);
    const hit = this.hitTestObject();
    if (!hit) return;

    e.preventDefault();
    e.stopPropagation();
    const obj = this.state.get(hit.objectId);
    if (!obj) return;

    const SCALE_SENSITIVITY = 0.0015;
    const newScale = Math.max(0.25, Math.min(2.5, obj.transform.scale[0] - e.deltaY * SCALE_SENSITIVITY));
    this.emit({ type: 'objectScaled', objectId: hit.objectId, scale: newScale });
    this.engine.updateObjectManual(hit.objectId, { scale: newScale }, false);
  }
}
