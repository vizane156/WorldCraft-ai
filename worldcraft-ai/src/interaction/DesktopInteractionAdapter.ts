/**
 * DesktopInteractionAdapter — mouse + keyboard input for standard 2D browsers.
 *
 * Translates mouse events into InteractionEvents identical to those produced
 * by XRInteractionAdapter. All downstream code is adapter-agnostic.
 *
 * Input mapping:
 *   First canvas click          → surfaceConfirmed (origin at [0, 0, 0])
 *   Click on scene object       → objectSelected
 *   Left-drag selected object   → objectMoved (XZ plane projection)
 *   Right-drag selected object  → objectRotated (horizontal delta → Y rotation)
 *   Scroll on selected object   → objectScaled
 *   Mouse button release        → objectReleased (with final transform)
 */

import {
  Raycaster,
  Vector2,
  Vector3,
  PerspectiveCamera,
  Scene,
} from '@iwsdk/core';
import type {
  InteractionAdapter,
  InteractionEvent,
  InteractionEventHandler,
  Transform,
} from './InteractionAdapter.js';
import type { SceneEngine } from '../scene/SceneEngine.js';
import type { SceneState } from '../scene/SceneState.js';

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];
const DEFAULT_SCALE: [number, number, number] = [1, 1, 1];
const SCENE_PLANE_Y = 0; // Objects move on the Y=0 plane in desktop mode

export class DesktopInteractionAdapter implements InteractionAdapter {
  private canvas: HTMLElement;
  private camera: PerspectiveCamera;
  private threeScene: Scene;
  private engine: SceneEngine;
  private state: SceneState;

  private handlers = new Set<InteractionEventHandler>();
  private raycaster = new Raycaster();
  private pointer = new Vector2();

  private surfaceConfirmed = false;

  // Drag state
  private dragObjectId: string | null = null;
  private dragButton: number | null = null; // 0 = left, 2 = right
  private lastPointerX = 0;
  private lastPointerY = 0;
  private dragRotationY = 0;
  private dragScale = 1;
  private dragCurrentPosition: [number, number, number] = [0, 0, 0];

  // Plane used for XZ position projection during drag
  private dragStartWorldPos = new Vector3();

  // Bound event handlers (stored for removal)
  private _onPointerDown: (e: PointerEvent) => void;
  private _onPointerMove: (e: PointerEvent) => void;
  private _onPointerUp:   (e: PointerEvent) => void;
  private _onWheel:       (e: WheelEvent)   => void;
  private _onContextMenu: (e: Event)        => void;

  constructor(
    canvas: HTMLElement,
    camera: PerspectiveCamera,
    threeScene: Scene,
    engine: SceneEngine,
    state: SceneState,
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.threeScene = threeScene;
    this.engine = engine;
    this.state = state;

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp   = this.onPointerUp.bind(this);
    this._onWheel       = this.onWheel.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    canvas.addEventListener('pointerdown',   this._onPointerDown);
    canvas.addEventListener('pointermove',   this._onPointerMove);
    canvas.addEventListener('pointerup',     this._onPointerUp);
    canvas.addEventListener('wheel',         this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu',   this._onContextMenu);
  }

  // ── InteractionAdapter interface ──────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_delta: number): void {
    // Desktop adapter is event-driven; nothing to poll per frame.
  }

  on(handler: InteractionEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown',  this._onPointerDown);
    this.canvas.removeEventListener('pointermove',  this._onPointerMove);
    this.canvas.removeEventListener('pointerup',    this._onPointerUp);
    this.canvas.removeEventListener('wheel',        this._onWheel);
    this.canvas.removeEventListener('contextmenu',  this._onContextMenu);
    this.handlers.clear();
  }

  // ── Private event handlers ────────────────────────────────────────────────

  private emit(event: InteractionEvent): void {
    for (const h of this.handlers) h(event);
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;
  }

  private onPointerDown(e: PointerEvent): void {
    this.updatePointer(e);
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    // ── Surface confirmation (first left-click anywhere on the canvas) ──────
    if (!this.surfaceConfirmed && e.button === 0) {
      this.surfaceConfirmed = true;
      const origin: Transform = {
        position: [0, 0, 0],
        rotation: IDENTITY_QUAT,
        scale:    DEFAULT_SCALE,
      };
      this.state.setOrigin(origin);
      this.emit({ type: 'surfaceConfirmed', origin });
      return;
    }

    if (!this.surfaceConfirmed) return;

    // ── Object hit test ───────────────────────────────────────────────────
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = Array.from(this.engine.getSceneObjects().values());
    const hits = this.raycaster.intersectObjects(meshes, true);

    if (hits.length === 0) return;

    // Walk up to the direct child of scene root to find the object id
    let target = hits[0].object;
    while (target.parent !== this.engine.root && target.parent != null) {
      target = target.parent;
    }
    const objectId = target.name;
    if (!this.state.has(objectId)) return;

    this.dragObjectId = objectId;
    this.dragButton   = e.button;

    const obj = this.state.get(objectId)!;
    this.dragRotationY = obj.transform.rotation[1];
    this.dragScale     = obj.transform.scale[0];
    this.dragCurrentPosition = [...obj.transform.position];
    this.dragStartWorldPos.set(...obj.transform.position);

    this.canvas.setPointerCapture(e.pointerId);
    this.emit({ type: 'objectSelected', objectId });
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.dragObjectId == null || !this.surfaceConfirmed) return;

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.dragButton === 0) {
      // Left drag → move on a vertical plane facing the camera (Z = object's Z)
      // This is more intuitive in desktop 2D than projecting onto Y=0
      this.updatePointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);

      const ray = this.raycaster.ray;
      // Project onto Z = dragStartWorldPos.z (plane facing camera)
      const targetZ = this.dragCurrentPosition[2];
      const t = (targetZ - ray.origin.z) / ray.direction.z;
      if (t > 0) {
        const worldPos = ray.origin.clone().addScaledVector(ray.direction, t);
        const pos: [number, number, number] = [worldPos.x, worldPos.y, targetZ];
        this.dragCurrentPosition = pos;
        this.engine.previewTransform(this.dragObjectId, pos);
        this.emit({ type: 'objectMoved', objectId: this.dragObjectId, position: pos });
      }
    } else if (this.dragButton === 2) {
      // Right drag → rotate around Y axis
      const ROTATION_SENSITIVITY = 0.01; // radians per pixel
      this.dragRotationY += dx * ROTATION_SENSITIVITY;
      this.emit({
        type: 'objectRotated',
        objectId: this.dragObjectId,
        rotationY: this.dragRotationY,
      });
    }

    void dy; // dy unused for now (could drive Y-axis translation later)
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.dragObjectId == null) return;

    const obj = this.state.get(this.dragObjectId);
    if (obj != null) {
      // Use the live drag position, not the stale SceneState position
      const finalTransform = {
        position: this.dragCurrentPosition,
        rotation: [
          0,
          Math.sin(this.dragRotationY / 2),
          0,
          Math.cos(this.dragRotationY / 2),
        ] as [number, number, number, number],
        scale: [this.dragScale, this.dragScale, this.dragScale] as [number, number, number],
      };
      this.emit({
        type: 'objectReleased',
        objectId: this.dragObjectId,
        transform: finalTransform,
      });
    }

    this.canvas.releasePointerCapture(e.pointerId);
    this.dragObjectId = null;
    this.dragButton   = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.dragObjectId == null && !this.surfaceConfirmed) return;

    // Find the object under the pointer
    this.updatePointer(e as unknown as PointerEvent);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = Array.from(this.engine.getSceneObjects().values());
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return;

    let target = hits[0].object;
    while (target.parent !== this.engine.root && target.parent != null) {
      target = target.parent;
    }
    const objectId = target.name;
    if (!this.state.has(objectId)) return;

    const SCALE_SENSITIVITY = 0.001;
    const obj = this.state.get(objectId)!;
    const newScale = Math.max(0.1, obj.transform.scale[0] - e.deltaY * SCALE_SENSITIVITY);

    this.emit({ type: 'objectScaled', objectId, scale: newScale });
  }
}
