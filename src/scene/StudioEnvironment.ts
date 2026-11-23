import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AtmospherePreset } from './SceneState';

export type CameraPreset = 'iso' | 'top' | 'front' | 'reset';

interface AtmosphereConfig {
  bg: number;
  fogColor: number;
  fogDensity: number;
  keyColor: number;
  keyIntensity: number;
  fillColor: number;
  fillIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  plinthColor: number;
  ringColor: number;
}

const ATMOSPHERES: Record<AtmospherePreset, AtmosphereConfig> = {
  daylight: {
    bg: 0x0f1624,
    fogColor: 0x0f1624,
    fogDensity: 0.016,
    keyColor: 0xfff5e4,
    keyIntensity: 2.25,
    fillColor: 0x8cc2ff,
    fillIntensity: 0.72,
    hemiSky: 0xd9ebff,
    hemiGround: 0x263142,
    hemiIntensity: 0.82,
    plinthColor: 0x1b2538,
    ringColor: 0x22d3ee,
  },
  golden: {
    bg: 0x1d1418,
    fogColor: 0x1d1418,
    fogDensity: 0.018,
    keyColor: 0xffb36b,
    keyIntensity: 2.45,
    fillColor: 0x9b8cff,
    fillIntensity: 0.58,
    hemiSky: 0xffd2a1,
    hemiGround: 0x332220,
    hemiIntensity: 0.76,
    plinthColor: 0x291e23,
    ringColor: 0xf59e0b,
  },
  twilight: {
    bg: 0x090d19,
    fogColor: 0x090d19,
    fogDensity: 0.022,
    keyColor: 0x76b8ff,
    keyIntensity: 1.65,
    fillColor: 0xeb6bff,
    fillIntensity: 0.75,
    hemiSky: 0x5c7ec9,
    hemiGround: 0x141724,
    hemiIntensity: 0.68,
    plinthColor: 0x12192b,
    ringColor: 0x38bdf8,
  },
};

export function detectSoftwareWebGL(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '');
      const rendererStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      if (/swiftshader|llvmpipe|software|mesa offscreen/i.test(`${vendor} ${rendererStr}`)) {
        return true;
      }
    }
    const baseRenderer = String(gl.getParameter(gl.RENDERER) || '');
    return /swiftshader|llvmpipe|software/i.test(baseRenderer);
  } catch {
    return false;
  }
}

export class StudioEnvironment {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly isSoftwareGl: boolean;

  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private plinthMesh: THREE.Mesh;
  private ringMesh: THREE.Mesh;
  private gridHelper: THREE.GridHelper;
  private selectionRing: THREE.Mesh;
  private pmremRT: THREE.WebGLRenderTarget | null = null;
  private envRoot: THREE.Group;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    domElement: HTMLElement,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.isSoftwareGl = detectSoftwareWebGL(renderer);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !this.isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.isSoftwareGl) {
      renderer.setPixelRatio(1);
    } else {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }

    if (!this.isSoftwareGl) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        this.pmremRT = pmrem.fromScene(room, 0.04);
        scene.environment = this.pmremRT.texture;
        scene.environmentIntensity = 0.55;
        room.dispose();
        pmrem.dispose();
      } catch {
        // Fallback safely if PMREM unsupported
      }
    }

    this.envRoot = new THREE.Group();
    this.envRoot.name = 'StudioEnvironmentRoot';
    scene.add(this.envRoot);

    this.hemiLight = new THREE.HemisphereLight(0xd9ebff, 0x263142, 0.82);
    this.envRoot.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff5e4, 2.25);
    this.keyLight.position.set(8.5, 13.5, 7.5);
    if (!this.isSoftwareGl) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(1024, 1024);
      this.keyLight.shadow.camera.near = 1;
      this.keyLight.shadow.camera.far = 36;
      const d = 11;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.bias = -0.0005;
    }
    this.envRoot.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0x8cc2ff, 0.72);
    this.fillLight.position.set(-7.5, 6.0, -6.5);
    this.envRoot.add(this.fillLight);

    const plinthGeo = new THREE.CylinderGeometry(9.2, 9.5, 0.42, 64);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x1b2538,
      roughness: 0.78,
      metalness: 0.14,
    });
    this.plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    this.plinthMesh.position.y = -0.21;
    this.plinthMesh.receiveShadow = true;
    this.envRoot.add(this.plinthMesh);

    const ringGeo = new THREE.RingGeometry(8.98, 9.12, 72);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.52,
    });
    this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.ringMesh.position.y = 0.005;
    this.envRoot.add(this.ringMesh);

    this.gridHelper = new THREE.GridHelper(17.5, 18, 0x3b4d6b, 0x223047);
    this.gridHelper.position.y = 0.003;
    const gridMaterials = Array.isArray(this.gridHelper.material)
      ? this.gridHelper.material
      : [this.gridHelper.material];
    for (const gm of gridMaterials) {
      gm.transparent = true;
      gm.opacity = 0.34;
    }
    this.envRoot.add(this.gridHelper);

    const selGeo = new THREE.RingGeometry(0.9, 1.06, 40);
    selGeo.rotateX(-Math.PI / 2);
    const selMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    this.selectionRing = new THREE.Mesh(selGeo, selMat);
    this.selectionRing.visible = false;
    this.selectionRing.position.y = 0.025;
    this.envRoot.add(this.selectionRing);

    this.controls = new OrbitControls(camera, domElement);
    this.controls.target.set(0, 0.55, 0);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.update();

    this.setAtmosphere('daylight');
  }

  setAtmosphere(preset: AtmospherePreset): void {
    const cfg = ATMOSPHERES[preset] ?? ATMOSPHERES.daylight;
    this.scene.background = new THREE.Color(cfg.bg);
    this.scene.fog = new THREE.FogExp2(cfg.fogColor, cfg.fogDensity);
    this.keyLight.color.setHex(cfg.keyColor);
    this.keyLight.intensity = cfg.keyIntensity;
    this.fillLight.color.setHex(cfg.fillColor);
    this.fillLight.intensity = cfg.fillIntensity;
    this.hemiLight.color.setHex(cfg.hemiSky);
    this.hemiLight.groundColor.setHex(cfg.hemiGround);
    this.hemiLight.intensity = cfg.hemiIntensity;
    (this.plinthMesh.material as THREE.MeshStandardMaterial).color.setHex(cfg.plinthColor);
    (this.ringMesh.material as THREE.MeshBasicMaterial).color.setHex(cfg.ringColor);
  }

  setImmersiveMode(inXR: boolean): void {
    this.controls.enabled = !inXR;
    if (inXR) {
      // Transparent background for AR passthrough
      this.scene.background = null;
      this.scene.fog = null;
      this.plinthMesh.visible = false;
      this.gridHelper.visible = false;
      (this.ringMesh.material as THREE.MeshBasicMaterial).opacity = 0.25;
    } else {
      this.plinthMesh.visible = true;
      this.gridHelper.visible = true;
      (this.ringMesh.material as THREE.MeshBasicMaterial).opacity = 0.52;
    }
  }

  setGridVisible(visible: boolean): void {
    this.gridHelper.visible = visible;
  }

  setSelectionTarget(
    target: { x: number; y: number; z: number; radius: number } | null,
    rootOffset: THREE.Vector3 = new THREE.Vector3(),
  ): void {
    if (!target) {
      this.selectionRing.visible = false;
      return;
    }
    this.selectionRing.visible = true;
    this.selectionRing.position.set(
      rootOffset.x + target.x,
      rootOffset.y + target.y + 0.025,
      rootOffset.z + target.z,
    );
    const s = Math.max(0.65, target.radius);
    this.selectionRing.scale.set(s, s, 1);
  }

  setCameraPreset(preset: CameraPreset): void {
    switch (preset) {
      case 'top':
        this.camera.position.set(0.01, 13.5, 0.01);
        this.controls.target.set(0, 0, 0);
        break;
      case 'front':
        this.camera.position.set(0, 3.2, 10.2);
        this.controls.target.set(0, 0.85, 0);
        break;
      case 'iso':
      case 'reset':
      default:
        this.camera.position.set(6.8, 5.2, 7.6);
        this.controls.target.set(0, 0.55, 0);
        break;
    }
    this.controls.update();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  tick(elapsed: number, objectRoot: THREE.Group): void {
    if (this.controls.enabled) {
      this.controls.update();
    }

    if (this.selectionRing.visible) {
      const pulse = 1 + Math.sin(elapsed * 3.5) * 0.04;
      const baseScale = this.selectionRing.scale.x;
      this.selectionRing.material = this.selectionRing.material;
      (this.selectionRing.material as THREE.MeshBasicMaterial).opacity =
        0.72 + Math.sin(elapsed * 4) * 0.18;
      void pulse;
      void baseScale;
    }

    objectRoot.traverse((child) => {
      const animType = child.userData?.animatedPart as string | undefined;
      if (!animType) return;
      if (animType === 'holo') {
        child.rotation.z = elapsed * 0.9;
        child.position.y = 2.65 + Math.sin(elapsed * 2.2) * 0.06;
      } else if (animType === 'rover') {
        child.position.y = Math.sin(elapsed * 2.4) * 0.08;
      } else if (animType === 'fountain') {
        child.scale.y = 0.88 + Math.sin(elapsed * 5.2) * 0.14;
      } else if (animType === 'crystal') {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = 0.65 + Math.sin(elapsed * 2.6) * 0.2;
        }
      } else if (animType === 'sakura') {
        child.rotation.y = Math.sin(elapsed * 0.6) * 0.03;
      }
    });
  }

  capturePngDataUrl(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.controls.dispose();
    this.pmremRT?.dispose();
  }
}
