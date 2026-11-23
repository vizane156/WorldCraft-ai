import * as THREE from 'three';
import {
  computeSpatialDistanceParams,
  getSpatialSoundProfile,
  type SpatialSoundKind,
} from './spatialSoundProfiles';
import { SceneEngine } from '../scene/SceneEngine';

export interface AudioStatus {
  enabled: boolean;
  unlocked: boolean;
  activeSources: number;
  inXR: boolean;
}

export class SpatialAudioEngine {
  private engine: SceneEngine;
  private scene: THREE.Scene;
  private desktopCamera: THREE.Camera;
  private renderer: THREE.WebGLRenderer;

  private listenerRig = new THREE.Object3D();
  private listener: THREE.AudioListener | null = null;
  private bufferCache = new Map<SpatialSoundKind, AudioBuffer>();
  private emitters = new Map<string, { sound: THREE.PositionalAudio; assetId: string }>();

  private enabled = true;
  private unlocked = false;
  private inXR = false;
  private statusListeners = new Set<(status: AudioStatus) => void>();
  private unsubChange: (() => void) | null = null;
  private gestureHandler: (() => void) | null = null;
  private tempPos = new THREE.Vector3();
  private tempQuat = new THREE.Quaternion();
  private tempScale = new THREE.Vector3();

  constructor(
    engine: SceneEngine,
    scene: THREE.Scene,
    desktopCamera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
  ) {
    this.engine = engine;
    this.scene = scene;
    this.desktopCamera = desktopCamera;
    this.renderer = renderer;
    this.listenerRig.name = 'SpatialAudioListenerRig';
    this.scene.add(this.listenerRig);
  }

  init(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return;
    }

    try {
      this.listener = new THREE.AudioListener();
      this.listenerRig.add(this.listener);
      this.unlocked = this.listener.context.state === 'running';
    } catch {
      this.listener = null;
      return;
    }

    this.gestureHandler = () => {
      void this.unlock();
    };
    window.addEventListener('pointerdown', this.gestureHandler, { passive: true });
    window.addEventListener('keydown', this.gestureHandler, { passive: true });

    this.unsubChange = this.engine.onChange((ev) => {
      this.syncSceneEmitters();
      if (ev.reason === 'edit' && ev.note?.startsWith('Added ')) {
        const selId = this.engine.getSelectedId();
        if (selId) this.playSpatialChime(selId, 'spawn');
      } else if (ev.reason === 'xr-grab') {
        const selId = this.engine.getSelectedId();
        if (selId) this.playSpatialChime(selId, 'grab');
      }
    });

    this.updateListenerPose();
    this.syncSceneEmitters();
    this.emitStatus();
  }

  async unlock(): Promise<boolean> {
    if (!this.listener) return false;
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    this.unlocked = ctx.state === 'running';
    if (this.unlocked && this.enabled) {
      this.syncSceneEmitters();
      this.startPausedEmitters();
    }
    this.emitStatus();
    return this.unlocked;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.listener) {
      this.listener.setMasterVolume(enabled ? 1 : 0);
      if (enabled) {
        void this.unlock().then(() => this.startPausedEmitters());
      } else {
        for (const { sound } of this.emitters.values()) {
          if (sound.isPlaying) {
            sound.pause();
          }
        }
      }
    }
    this.emitStatus();
  }

  toggleEnabled(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setInXR(inXR: boolean): void {
    if (this.inXR === inXR) return;
    this.inXR = inXR;
    this.updateEmitterParameters();
    this.emitStatus();
  }

  updateListenerPose(): void {
    if (!this.listener) return;
    // In WebXR, track the actual Quest headset ArrayCamera; in studio, track desktop camera
    const activeCam =
      this.inXR && this.renderer.xr.isPresenting
        ? this.renderer.xr.getCamera()
        : this.desktopCamera;

    activeCam.updateMatrixWorld();
    activeCam.matrixWorld.decompose(this.tempPos, this.tempQuat, this.tempScale);
    this.listenerRig.position.copy(this.tempPos);
    this.listenerRig.quaternion.copy(this.tempQuat);
    this.listenerRig.updateMatrixWorld(true);
  }

  getDistanceToObject(objectId: string): number | null {
    const mesh = this.engine.getMesh(objectId);
    if (!mesh) return null;
    const objWorld = new THREE.Vector3();
    mesh.getWorldPosition(objWorld);
    return Number(this.listenerRig.position.distanceTo(objWorld).toFixed(2));
  }

  getObjectAudioInfo(
    objectId: string,
  ): { label: string; distanceM: number | null; enabled: boolean } | null {
    const obj = this.engine.state.getObject(objectId);
    if (!obj) return null;
    const profile = getSpatialSoundProfile(obj.asset_id);
    return {
      label: profile.label,
      distanceM: this.getDistanceToObject(objectId),
      enabled: this.enabled,
    };
  }

  getStatus(): AudioStatus {
    return {
      enabled: this.enabled,
      unlocked: this.unlocked,
      activeSources: this.emitters.size,
      inXR: this.inXR,
    };
  }

  onStatusChange(cb: (status: AudioStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.getStatus());
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const cb of this.statusListeners) cb(status);
  }

  private syncSceneEmitters(): void {
    if (!this.listener) return;
    const meshMap = this.engine.getMeshMap();

    // Remove emitters whose objects were deleted or rebuilt
    for (const [id, entry] of Array.from(this.emitters.entries())) {
      const mesh = meshMap.get(id);
      if (!mesh || entry.sound.parent !== mesh) {
        try {
          if (entry.sound.isPlaying) entry.sound.stop();
          entry.sound.disconnect();
          entry.sound.removeFromParent();
        } catch {
          // Safe cleanup
        }
        this.emitters.delete(id);
      }
    }

    // Attach positional HRTF audio to every active scene object
    for (const [id, mesh] of meshMap.entries()) {
      if (this.emitters.has(id)) continue;
      const obj = this.engine.state.getObject(id);
      if (!obj) continue;

      const profile = getSpatialSoundProfile(obj.asset_id);
      const buffer = this.getOrSynthesizeBuffer(profile.kind);
      if (!buffer) continue;

      const sound = new THREE.PositionalAudio(this.listener);
      sound.setBuffer(buffer);
      sound.setLoop(true);
      sound.setDistanceModel('inverse');
      const panner = sound.panner;
      if (panner) {
        panner.panningModel = 'HRTF';
      }
      // Subtle random start offset so multiple identical objects never phase-lock
      sound.offset = Math.random() * Math.max(0.5, buffer.duration - 0.5);

      mesh.add(sound);
      this.emitters.set(id, { sound, assetId: obj.asset_id });
    }

    this.updateEmitterParameters();
    if (this.enabled && this.unlocked) {
      this.startPausedEmitters();
    }
    this.emitStatus();
  }

  private updateEmitterParameters(): void {
    const count = this.emitters.size;
    for (const { sound, assetId } of this.emitters.values()) {
      const profile = getSpatialSoundProfile(assetId);
      const params = computeSpatialDistanceParams(profile, this.inXR, count);
      sound.setRefDistance(params.refDistance);
      sound.setMaxDistance(params.maxDistance);
      sound.setRolloffFactor(params.rolloffFactor);
      sound.setVolume(params.volume);
    }
  }

  private startPausedEmitters(): void {
    if (!this.enabled || !this.unlocked) return;
    for (const { sound } of this.emitters.values()) {
      if (!sound.isPlaying && sound.buffer) {
        try {
          sound.play();
        } catch {
          // Ignore if context locked
        }
      }
    }
  }

  playSpatialChime(objectId: string, event: 'spawn' | 'grab'): void {
    if (!this.listener || !this.enabled || !this.unlocked) return;
    const mesh = this.engine.getMesh(objectId);
    if (!mesh) return;

    const ctx = this.listener.context;
    const sampleRate = ctx.sampleRate;
    const duration = 0.28;
    const length = Math.floor(sampleRate * duration);
    const buf = ctx.createBuffer(1, length, sampleRate);
    const data = buf.getChannelData(0);

    const baseFreq = event === 'spawn' ? 523.25 : 392.0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 14);
      data[i] =
        (Math.sin(2 * Math.PI * baseFreq * t) * 0.55 +
          Math.sin(2 * Math.PI * baseFreq * 1.5 * t) * 0.25) *
        env *
        0.35;
    }

    const oneshot = new THREE.PositionalAudio(this.listener);
    oneshot.setBuffer(buf);
    oneshot.setLoop(false);
    oneshot.setDistanceModel('inverse');
    oneshot.setRefDistance(this.inXR ? 0.5 : 2.5);
    oneshot.setMaxDistance(this.inXR ? 4.5 : 18);
    if (oneshot.panner) oneshot.panner.panningModel = 'HRTF';
    oneshot.setVolume(0.32);
    oneshot.onEnded = () => {
      try {
        oneshot.disconnect();
        oneshot.removeFromParent();
      } catch {
        // Safe cleanup
      }
    };
    mesh.add(oneshot);
    try {
      oneshot.play();
    } catch {
      oneshot.removeFromParent();
    }
  }

  private getOrSynthesizeBuffer(kind: SpatialSoundKind): AudioBuffer | null {
    const existing = this.bufferCache.get(kind);
    if (existing) return existing;
    if (!this.listener) return null;

    const ctx = this.listener.context;
    const sampleRate = ctx.sampleRate;
    const duration = 3.2;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const ch = buffer.getChannelData(0);

    // Deterministic seamless loop synthesis per object category
    let lp1 = 0;
    let lp2 = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const phase = (t / duration) * Math.PI * 2;
      const noise = Math.random() * 2 - 1;
      lp1 = lp1 * 0.92 + noise * 0.08;
      lp2 = lp2 * 0.985 + noise * 0.015;

      let sample = 0;
      switch (kind) {
        case 'water': {
          // Gentle fountain splash + modulated stream
          const trickle = (lp1 - lp2) * 3.4 * (0.65 + 0.35 * Math.sin(phase * 3));
          const droplets =
            Math.sin(2 * Math.PI * (640 + 180 * Math.sin(phase * 5)) * t) *
            0.03 *
            Math.max(0, Math.sin(phase * 7));
          sample = trickle + droplets;
          break;
        }
        case 'zen_chime': {
          // Soft wind + resonant pentatonic overtone swell
          const swell = 0.5 + 0.5 * Math.sin(phase - Math.PI / 2);
          const bell =
            (Math.sin(2 * Math.PI * 392 * t) * 0.35 +
              Math.sin(2 * Math.PI * 587.33 * t) * 0.18) *
            Math.pow(swell, 3) *
            0.22;
          sample = lp2 * 1.4 + bell;
          break;
        }
        case 'foliage_breeze': {
          const gust = 0.5 + 0.5 * Math.sin(phase * 2);
          sample = (lp1 - lp2 * 0.7) * 2.1 * (0.45 + 0.55 * gust);
          break;
        }
        case 'market_hearth': {
          // Warm low hearth rumble + subtle crackle pops
          const crackle = Math.random() > 0.996 ? (Math.random() * 2 - 1) * 0.25 : 0;
          sample = lp2 * 2.3 + crackle;
          break;
        }
        case 'cyber_pulse': {
          // Clean dual-oscillator holographic hum
          const pulse = 0.65 + 0.35 * Math.sin(phase * 2);
          sample =
            (Math.sin(2 * Math.PI * 110 * t) * 0.28 +
              Math.sin(2 * Math.PI * 220.5 * t) * 0.12 +
              Math.sin(2 * Math.PI * 440 * t) * 0.05 * pulse) *
            0.65;
          break;
        }
        case 'hover_hum': {
          // Soft antigrav turbine idle
          const flutter = 1 + 0.03 * Math.sin(phase * 4);
          sample =
            (Math.sin(2 * Math.PI * 76 * t * flutter) * 0.32 +
              Math.sin(2 * Math.PI * 152 * t) * 0.14 +
              lp2 * 0.8) *
            0.65;
          break;
        }
        case 'urban_courtyard':
        default: {
          sample = lp2 * 1.35 + Math.sin(2 * Math.PI * 196 * t) * 0.015;
          break;
        }
      }

      // Smooth 60ms crossfade envelope at loop edges for click-free looping
      const edgeSamples = Math.floor(sampleRate * 0.06);
      if (i < edgeSamples) {
        sample *= i / edgeSamples;
      } else if (i > length - edgeSamples) {
        sample *= (length - i) / edgeSamples;
      }

      ch[i] = Math.max(-0.8, Math.min(0.8, sample));
    }

    this.bufferCache.set(kind, buffer);
    return buffer;
  }

  dispose(): void {
    this.unsubChange?.();
    if (this.gestureHandler && typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.gestureHandler);
      window.removeEventListener('keydown', this.gestureHandler);
      this.gestureHandler = null;
    }
    for (const { sound } of this.emitters.values()) {
      try {
        if (sound.isPlaying) sound.stop();
        sound.disconnect();
        sound.removeFromParent();
      } catch {
        // Safe cleanup
      }
    }
    this.emitters.clear();
  }
}
