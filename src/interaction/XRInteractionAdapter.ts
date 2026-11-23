import * as THREE from 'three';
import {
  Entity,
  EnvironmentRaycastTarget,
  Grabbed,
  RaycastSpace,
  SessionMode,
  Types,
  VisibilityState,
  World,
  createSystem,
} from '@iwsdk/core';
import { WorldCraftItem } from '../components';
import { SceneEngine } from '../scene/SceneEngine';
import { StudioEnvironment } from '../scene/StudioEnvironment';

export interface XRStatus {
  supported: boolean;
  inXR: boolean;
  sessionMode: 'immersive-ar' | 'immersive-vr' | 'inline';
  surfaceAnchored: boolean;
}

export class WorldCraftXRSystem extends createSystem(
  {
    grabbedItems: { required: [WorldCraftItem, Grabbed] },
  },
  {
    onGrabStart: { type: Types.Object, default: undefined },
    onGrabEnd: { type: Types.Object, default: undefined },
    onTick: { type: Types.Object, default: undefined },
  },
) {
  init(): void {
    this.cleanupFuncs.push(
      this.queries.grabbedItems.subscribe('qualify', (entity) => {
        const objectId = entity.getValue(WorldCraftItem, 'objectId');
        const cb = this.config.onGrabStart.value as ((id: string) => void) | undefined;
        if (objectId && cb) cb(objectId);
      }),
      this.queries.grabbedItems.subscribe('disqualify', (entity) => {
        const objectId = entity.getValue(WorldCraftItem, 'objectId');
        const cb = this.config.onGrabEnd.value as ((id: string) => void) | undefined;
        if (objectId && cb) cb(objectId);
      }),
    );
  }

  update(delta: number, time: number): void {
    const tick = this.config.onTick.value as ((dt: number, elapsed: number) => void) | undefined;
    if (tick) tick(delta, time);
  }
}

export class XRInteractionAdapter {
  readonly world: World;
  readonly engine: SceneEngine;
  readonly env: StudioEnvironment;

  private reticleEntity: Entity | null = null;
  private reticleMesh: THREE.Group;
  private surfaceAnchored = false;
  private activeInXR = false;
  private xrSupported = false;
  private statusListeners = new Set<(status: XRStatus) => void>();
  private unsubVisibility: (() => void) | null = null;

  constructor(world: World, engine: SceneEngine, env: StudioEnvironment) {
    this.world = world;
    this.engine = engine;
    this.env = env;

    this.reticleMesh = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.2, 32),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    outer.rotation.x = -Math.PI / 2;
    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(0.035, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.002;
    this.reticleMesh.add(outer, inner);
    this.reticleMesh.visible = false;
  }

  async init(onPerFrameTick: (delta: number, elapsed: number) => void): Promise<void> {
    this.xrSupported = await this.checkXRSupport();

    this.world.registerSystem(WorldCraftXRSystem, {
      priority: 0,
      configData: {
        onGrabStart: (objectId: string) => {
          this.engine.setSelectedId(objectId);
        },
        onGrabEnd: (objectId: string) => {
          this.engine.commitLiveXrTransform(objectId);
        },
        onTick: (delta: number, elapsed: number) => {
          this.handleHitTestPlacement();
          onPerFrameTick(delta, elapsed);
        },
      },
    });

    this.reticleEntity = this.world.createTransformEntity(this.reticleMesh, {
      parent: this.world.sceneEntity,
    });
    this.reticleEntity.addComponent(EnvironmentRaycastTarget, {
      space: RaycastSpace.Right,
      maxDistance: 8,
    });

    this.unsubVisibility = this.world.visibilityState.subscribe((vis) => {
      const nowXR = vis !== VisibilityState.NonImmersive;
      if (nowXR !== this.activeInXR) {
        this.activeInXR = nowXR;
        this.onXRTransition(nowXR);
      }
    });

    this.emitStatus();
  }

  private async checkXRSupport(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
      return false;
    }
    try {
      const ar = await navigator.xr.isSessionSupported('immersive-ar');
      if (ar) return true;
      return await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }

  private sessionSelectCleanup: (() => void) | null = null;

  private onXRTransition(inXR: boolean): void {
    this.env.setImmersiveMode(inXR);
    this.sessionSelectCleanup?.();
    this.sessionSelectCleanup = null;

    if (inXR) {
      this.surfaceAnchored = false;
      // Default tabletop placement right in front of the user at comfortable reach
      this.engine.root.position.set(0, 0.82, -1.35);
      this.engine.root.scale.setScalar(0.18);
      this.reticleMesh.visible = true;

      const session = this.world.session;
      if (session) {
        const onSelect = () => {
          if (
            this.activeInXR &&
            !this.surfaceAnchored &&
            this.reticleMesh.visible &&
            this.reticleEntity?.object3D
          ) {
            this.engine.root.position.copy(this.reticleEntity.object3D.position);
            this.engine.root.scale.setScalar(0.18);
            this.surfaceAnchored = true;
            this.reticleMesh.visible = false;
            this.emitStatus();
          }
        };
        session.addEventListener('select', onSelect);
        this.sessionSelectCleanup = () => session.removeEventListener('select', onSelect);
      }
    } else {
      this.reticleMesh.visible = false;
      this.surfaceAnchored = false;
      this.engine.root.position.set(0, 0, 0);
      this.engine.root.scale.setScalar(1.0);
      this.env.setCameraPreset('iso');
    }
    this.emitStatus();
  }

  private handleHitTestPlacement(): void {
    if (!this.activeInXR || this.surfaceAnchored || !this.reticleEntity) {
      if (this.reticleMesh.visible && !this.activeInXR) {
        this.reticleMesh.visible = false;
      }
      return;
    }

    const hit = this.reticleEntity.getValue(
      EnvironmentRaycastTarget,
      'xrHitTestResult',
    );
    const hasHit = Boolean(hit);
    this.reticleMesh.visible = hasHit;

    const rightPad = this.world.input.xr.gamepads.right;
    const leftPad = this.world.input.xr.gamepads.left;
    const triggerPressed =
      Boolean(rightPad?.getSelectStart()) || Boolean(leftPad?.getSelectStart());

    if (hasHit && triggerPressed && this.reticleEntity.object3D) {
      this.engine.root.position.copy(this.reticleEntity.object3D.position);
      this.engine.root.scale.setScalar(0.18);
      this.surfaceAnchored = true;
      this.reticleMesh.visible = false;
      this.emitStatus();
    }
  }

  reAnchorTabletop(): void {
    if (!this.activeInXR) return;
    this.surfaceAnchored = false;
    this.reticleMesh.visible = true;
    this.emitStatus();
  }

  async launchAR(): Promise<{ ok: boolean; message: string }> {
    if (!this.xrSupported) {
      return {
        ok: false,
        message:
          'WebXR headset/emulator not detected on this browser. Open in Meta Quest Browser or run with Meta IWER emulator.',
      };
    }
    try {
      const arOk = await navigator.xr?.isSessionSupported('immersive-ar');
      this.world.launchXR({
        sessionMode: arOk ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR,
        features: {
          hitTest: true,
          handTracking: true,
          anchors: true,
        },
      });
      return {
        ok: true,
        message: arOk
          ? 'Launching Meta Quest Immersive AR session...'
          : 'Launching Meta Quest Immersive VR session...',
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to start XR session.',
      };
    }
  }

  exitXR(): void {
    if (this.activeInXR) {
      this.world.exitXR();
    }
  }

  getStatus(): XRStatus {
    return {
      supported: this.xrSupported,
      inXR: this.activeInXR,
      sessionMode: this.activeInXR ? 'immersive-ar' : 'inline',
      surfaceAnchored: this.surfaceAnchored,
    };
  }

  onStatusChange(cb: (status: XRStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.getStatus());
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const cb of this.statusListeners) cb(status);
  }

  dispose(): void {
    this.unsubVisibility?.();
  }
}
