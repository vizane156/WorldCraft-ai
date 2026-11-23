/**
 * StudioEnvironment — PBR studio stage, RoomEnvironment IBL, 3-point lighting,
 * atmosphere presets, tabletop plinth with boundary ring, selection ring,
 * OrbitControls, and software-WebGL detection.
 */

import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  GridHelper,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from '@iwsdk/core';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type AtmospherePreset = 'daylight' | 'golden_hour' | 'twilight_lanterns';
export type CameraPreset = 'iso' | 'top' | 'front' | 'reset';

interface AtmosphereConfig {
  bg: number;
  fogDensity: number;
  keyColor: number;
  keyIntensity: number;
  keyPos: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  rimColor: number;
  rimIntensity: number;
  plinthColor: number;
  ringColor: number;
  exposure: number;
}

const ATMOSPHERE_PRESETS: Record<AtmospherePreset, AtmosphereConfig> = {
  daylight: {
    bg: 0x161b24,
    fogDensity: 0.14,
    keyColor: 0xfff5e4,
    keyIntensity: 2.1,
    keyPos: [1.4, 2.2, 1.6],
    hemiSky: 0xdbeafe,
    hemiGround: 0x2c3442,
    hemiIntensity: 0.95,
    rimColor: 0x93c5fd,
    rimIntensity: 0.75,
    plinthColor: 0x242b38,
    ringColor: 0x6366f1,
    exposure: 1.08,
  },
  golden_hour: {
    bg: 0x1c1614,
    fogDensity: 0.16,
    keyColor: 0xffb36b,
    keyIntensity: 2.35,
    keyPos: [1.9, 1.25, 1.3],
    hemiSky: 0xfde68a,
    hemiGround: 0x382824,
    hemiIntensity: 0.8,
    rimColor: 0x818cf8,
    rimIntensity: 0.65,
    plinthColor: 0x2b2421,
    ringColor: 0xf59e0b,
    exposure: 1.12,
  },
  twilight_lanterns: {
    bg: 0x0b0f19,
    fogDensity: 0.18,
    keyColor: 0x93c5fd,
    keyIntensity: 1.15,
    keyPos: [-1.2, 2.0, 1.4],
    hemiSky: 0x3b4d7a,
    hemiGround: 0x141824,
    hemiIntensity: 0.65,
    rimColor: 0xfbbf24,
    rimIntensity: 0.9,
    plinthColor: 0x191f2c,
    ringColor: 0x38bdf8,
    exposure: 1.05,
  },
};

export function detectSoftwareWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class StudioEnvironment {
  readonly isSoftwareGl: boolean;
  readonly controls: OrbitControls;

  private scene: Scene;
  private camera: PerspectiveCamera;
  private renderer: WebGLRenderer;

  private keyLight: DirectionalLight;
  private hemiLight: HemisphereLight;
  private rimLight: DirectionalLight;

  private stageGroup = new Group();
  private plinthMat: MeshStandardMaterial;
  private boundaryRingMat: MeshBasicMaterial;
  private selectionRing: Mesh;

  private camTargetPos: Vector3 | null = null;
  private camTargetLook: Vector3 | null = null;
  private currentAtmosphere: AtmospherePreset = 'daylight';

  constructor(
    scene: Scene,
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
    sceneRadiusM = 0.5,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.isSoftwareGl = detectSoftwareWebGL();

    // Renderer calibration
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    renderer.shadowMap.enabled = !this.isSoftwareGl;
    renderer.shadowMap.type = PCFSoftShadowMap;

    // Studio IBL reflections via RoomEnvironment
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 3-point warm/cool lighting rig
    this.hemiLight = new HemisphereLight(0xdbeafe, 0x2c3442, 0.95);
    scene.add(this.hemiLight);

    this.keyLight = new DirectionalLight(0xfff5e4, 2.1);
    this.keyLight.position.set(1.4, 2.2, 1.6);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 0.2;
    this.keyLight.shadow.camera.far = 8;
    const d = 0.85;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.015;
    scene.add(this.keyLight);

    this.rimLight = new DirectionalLight(0x93c5fd, 0.75);
    this.rimLight.position.set(-1.5, 1.2, -1.5);
    scene.add(this.rimLight);

    // Build tactile tabletop stage
    this.stageGroup.name = 'worldcraft-studio-stage';
    this.plinthMat = new MeshStandardMaterial({
      color: 0x242b38,
      roughness: 0.78,
      metalness: 0.14,
    });
    const plinthTrimMat = new MeshStandardMaterial({
      color: 0x394356,
      roughness: 0.35,
      metalness: 0.65,
    });

    // Main circular tabletop (top surface sits at y = 0.0)
    const plinth = new Mesh(
      new CylinderGeometry(sceneRadiusM + 0.06, sceneRadiusM + 0.08, 0.042, 48),
      this.plinthMat,
    );
    plinth.position.y = -0.021;
    plinth.receiveShadow = true;
    this.stageGroup.add(plinth);

    // Metallic bevel rim
    const rim = new Mesh(
      new CylinderGeometry(sceneRadiusM + 0.064, sceneRadiusM + 0.068, 0.012, 48),
      plinthTrimMat,
    );
    rim.position.y = -0.008;
    this.stageGroup.add(rim);

    // Grounded outer studio floor well below plinth
    const studioFloor = new Mesh(
      new CircleGeometry(8, 48),
      new MeshStandardMaterial({
        color: 0x11151d,
        roughness: 0.92,
        metalness: 0.05,
      }),
    );
    studioFloor.rotation.x = -Math.PI / 2;
    studioFloor.position.y = -0.044;
    studioFloor.receiveShadow = true;
    this.stageGroup.add(studioFloor);

    // Buildable boundary ring on tabletop (y = 0.001 with polygonOffset)
    this.boundaryRingMat = new MeshBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const boundaryRing = new Mesh(
      new RingGeometry(sceneRadiusM - 0.004, sceneRadiusM, 64),
      this.boundaryRingMat,
    );
    boundaryRing.rotation.x = -Math.PI / 2;
    boundaryRing.position.y = 0.001;
    this.stageGroup.add(boundaryRing);

    // Subtle spatial calibration grid on tabletop
    const grid = new GridHelper(sceneRadiusM * 1.85, 10, 0x475569, 0x334155);
    grid.position.y = 0.0008;
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const gm of gridMats) {
      gm.transparent = true;
      gm.opacity = 0.25;
      gm.polygonOffset = true;
      gm.polygonOffsetFactor = -1;
    }
    this.stageGroup.add(grid);

    // Selection highlight ring
    this.selectionRing = new Mesh(
      new RingGeometry(0.085, 0.098, 36),
      new MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.0025;
    this.selectionRing.visible = false;
    this.stageGroup.add(this.selectionRing);

    scene.add(this.stageGroup);

    // OrbitControls for effortless desktop inspection
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 0.45;
    this.controls.maxDistance = 2.6;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.target.set(0, 0.08, 0);
    camera.position.set(0.75, 0.62, 0.95);
    this.controls.update();

    // Cancel scripted camera transition when user interacts manually
    this.controls.addEventListener('start', () => {
      this.camTargetPos = null;
      this.camTargetLook = null;
    });

    this.setAtmosphere('daylight');
  }

  getAtmosphere(): AtmospherePreset {
    return this.currentAtmosphere;
  }

  setAtmosphere(preset: AtmospherePreset): void {
    this.currentAtmosphere = preset;
    const cfg = ATMOSPHERE_PRESETS[preset] ?? ATMOSPHERE_PRESETS.daylight;
    const bgColor = new Color(cfg.bg);
    this.scene.background = bgColor;
    this.scene.fog = new FogExp2(cfg.bg, cfg.fogDensity);
    this.renderer.setClearColor(cfg.bg, 1);
    this.renderer.toneMappingExposure = cfg.exposure;

    this.keyLight.color.setHex(cfg.keyColor);
    this.keyLight.intensity = cfg.keyIntensity;
    this.keyLight.position.set(...cfg.keyPos);

    this.hemiLight.color.setHex(cfg.hemiSky);
    this.hemiLight.groundColor.setHex(cfg.hemiGround);
    this.hemiLight.intensity = cfg.hemiIntensity;

    this.rimLight.color.setHex(cfg.rimColor);
    this.rimLight.intensity = cfg.rimIntensity;

    this.plinthMat.color.setHex(cfg.plinthColor);
    this.boundaryRingMat.color.setHex(cfg.ringColor);
  }

  setCameraPreset(preset: CameraPreset): void {
    const look = new Vector3(0, 0.08, 0);
    let pos: Vector3;
    switch (preset) {
      case 'top':
        pos = new Vector3(0.01, 1.35, 0.08);
        break;
      case 'front':
        pos = new Vector3(0, 0.36, 1.15);
        break;
      case 'iso':
      case 'reset':
      default:
        pos = new Vector3(0.75, 0.62, 0.95);
        break;
    }
    if (this.isSoftwareGl) {
      this.camera.position.copy(pos);
      this.controls.target.copy(look);
      this.controls.update();
    } else {
      this.camTargetPos = pos;
      this.camTargetLook = look;
    }
  }

  setSelectionIndicator(
    visible: boolean,
    x = 0,
    z = 0,
    scale = 1,
  ): void {
    this.selectionRing.visible = visible;
    if (visible) {
      this.selectionRing.position.set(x, 0.0025, z);
      const rScale = Math.max(0.6, Math.min(2.2, scale));
      this.selectionRing.scale.setScalar(rScale);
    }
  }

  setControlsEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  update(delta: number, elapsed: number): void {
    const dt = Math.min(delta, 0.1);
    if (this.camTargetPos && this.camTargetLook) {
      const alpha = 1 - Math.exp(-8 * dt);
      this.camera.position.lerp(this.camTargetPos, alpha);
      this.controls.target.lerp(this.camTargetLook, alpha);
      if (this.camera.position.distanceTo(this.camTargetPos) < 0.005) {
        this.camera.position.copy(this.camTargetPos);
        this.controls.target.copy(this.camTargetLook);
        this.camTargetPos = null;
        this.camTargetLook = null;
      }
    }

    if (this.selectionRing.visible) {
      const pulse = 1 + Math.sin(elapsed * 3.5) * 0.04;
      this.selectionRing.rotation.z = elapsed * 0.4;
      this.selectionRing.scale.setScalar(
        this.selectionRing.scale.x * 0.9 + pulse * this.selectionRing.scale.x * 0.1,
      );
    }

    this.controls.update();
  }
}
