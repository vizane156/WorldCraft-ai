import * as THREE from 'three';

type TextureKey =
  | 'wood'
  | 'stone'
  | 'tatami'
  | 'awning'
  | 'koiWater'
  | 'techGrid'
  | 'foliage';

const textureCache = new Map<TextureKey, THREE.CanvasTexture>();
let shadowTextureCache: THREE.CanvasTexture | null = null;

function createContactShadowTexture(): THREE.CanvasTexture {
  if (shadowTextureCache) return shadowTextureCache;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(6, 10, 18, 0.45)');
  grad.addColorStop(0.55, 'rgba(6, 10, 18, 0.2)');
  grad.addColorStop(1, 'rgba(6, 10, 18, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  shadowTextureCache = tex;
  return tex;
}

function getProceduralTexture(key: TextureKey): THREE.CanvasTexture {
  const existing = textureCache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  if (key === 'wood') {
    ctx.fillStyle = '#8b5a36';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 6) {
      ctx.fillStyle = y % 12 === 0 ? 'rgba(42, 22, 10, 0.16)' : 'rgba(210, 155, 100, 0.1)';
      ctx.fillRect(0, y, 256, 3);
    }
    ctx.strokeStyle = 'rgba(35, 18, 8, 0.22)';
    for (let x = 32; x < 256; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
  } else if (key === 'stone') {
    ctx.fillStyle = '#8d9299';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 420; i++) {
      const x = (i * 73) % 256;
      const y = (i * 139) % 256;
      const tone = i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(25,30,38,0.12)';
      ctx.fillStyle = tone;
      ctx.fillRect(x, y, 6 + (i % 5), 6 + (i % 4));
    }
    ctx.strokeStyle = 'rgba(40, 44, 52, 0.22)';
    ctx.lineWidth = 2;
    for (let row = 0; row < 256; row += 32) {
      ctx.beginPath();
      ctx.moveTo(0, row);
      ctx.lineTo(256, row);
      ctx.stroke();
      const offset = (row / 32) % 2 === 0 ? 0 : 24;
      for (let col = offset; col < 256; col += 48) {
        ctx.beginPath();
        ctx.moveTo(col, row);
        ctx.lineTo(col, row + 32);
        ctx.stroke();
      }
    }
  } else if (key === 'tatami') {
    ctx.fillStyle = '#c4be8c';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(130, 122, 74, 0.18)';
    for (let y = 0; y < 256; y += 4) {
      ctx.fillRect(0, y, 256, 2);
    }
    ctx.strokeStyle = '#2d4a3a';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 118);
    ctx.strokeRect(5, 133, 246, 118);
  } else if (key === 'awning') {
    for (let x = 0; x < 256; x += 32) {
      ctx.fillStyle = (x / 32) % 2 === 0 ? '#ffffff' : '#d6d9df';
      ctx.fillRect(x, 0, 32, 256);
    }
  } else if (key === 'koiWater') {
    const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, '#3899b5');
    grad.addColorStop(1, '#1d566d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(210, 245, 255, 0.25)';
    ctx.lineWidth = 2;
    for (const r of [34, 66, 98]) {
      ctx.beginPath();
      ctx.arc(128, 128, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (key === 'techGrid') {
    ctx.fillStyle = '#141c29';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(66, 224, 245, 0.26)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#639b56';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 320; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(24,52,20,0.18)';
      ctx.beginPath();
      ctx.arc((i * 53) % 256, (i * 97) % 256, 6 + (i % 5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  textureCache.set(key, tex);
  return tex;
}

function makeMat(
  color: THREE.ColorRepresentation,
  options: {
    roughness?: number;
    metalness?: number;
    map?: THREE.CanvasTexture;
    emissive?: THREE.ColorRepresentation;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    accent?: boolean;
  } = {},
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.62,
    metalness: options.metalness ?? 0.08,
    ...(options.map ? { map: options.map } : {}),
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });
  if (options.accent) {
    mat.userData.accentMaterial = true;
  }
  return mat;
}

function addShadowDisc(group: THREE.Group, radius: number): void {
  const geo = new THREE.PlaneGeometry(radius * 2.15, radius * 2.15);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: createContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  });
  const disc = new THREE.Mesh(geo, mat);
  disc.position.y = 0.012;
  disc.userData.isShadowDisc = true;
  group.add(disc);
}

function tagShadows(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && !child.userData.isShadowDisc) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function makeBox(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function makeCyl(
  rt: number,
  rb: number,
  h: number,
  seg: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

export function buildProceduralAsset(
  assetId: string,
  accentHex: string,
): THREE.Group {
  const root = new THREE.Group();
  root.userData.assetId = assetId;

  const woodTex = getProceduralTexture('wood');
  const stoneTex = getProceduralTexture('stone');
  const tatamiTex = getProceduralTexture('tatami');
  const awningTex = getProceduralTexture('awning');
  const waterTex = getProceduralTexture('koiWater');
  const techTex = getProceduralTexture('techGrid');
  const foliageTex = getProceduralTexture('foliage');

  const accentMat = makeMat(accentHex, { roughness: 0.45, metalness: 0.1, accent: true });
  const woodMat = makeMat(0x8e5d38, { map: woodTex, roughness: 0.72 });
  const darkWoodMat = makeMat(0x4b3120, { map: woodTex, roughness: 0.78 });
  const stoneMat = makeMat(0x9aa0a8, { map: stoneTex, roughness: 0.85 });
  const darkStoneMat = makeMat(0x49505a, { map: stoneTex, roughness: 0.8 });
  const ironMat = makeMat(0x282d35, { roughness: 0.42, metalness: 0.78 });
  const goldMat = makeMat(0xdcb45c, { roughness: 0.3, metalness: 0.85 });

  switch (assetId) {
    case 'market_stall_japanese': {
      addShadowDisc(root, 1.3);
      root.add(makeBox(2.2, 0.14, 1.45, darkStoneMat, 0, 0.07, 0));
      root.add(makeBox(1.9, 0.82, 0.95, woodMat, 0, 0.55, 0));
      root.add(makeBox(2.05, 0.08, 1.05, darkWoodMat, 0, 0.98, 0.05));
      for (const px of [-0.92, 0.92]) {
        for (const pz of [-0.45, 0.45]) {
          root.add(makeBox(0.1, 2.05, 0.1, darkWoodMat, px, 1.12, pz));
        }
      }
      const roof = makeBox(2.38, 0.12, 1.55, makeMat(accentHex, { map: awningTex, roughness: 0.65, accent: true }), 0, 2.2, 0.08);
      roof.rotation.x = 0.24;
      root.add(roof);
      for (const lx of [-0.65, 0.65]) {
        const lantern = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 14, 12),
          makeMat('#ffbe5c', { emissive: '#ff962d', emissiveIntensity: 0.95 }),
        );
        lantern.scale.y = 1.35;
        lantern.position.set(lx, 1.75, 0.62);
        lantern.userData.animatedPart = 'lantern';
        root.add(lantern);
      }
      break;
    }

    case 'torii_gate': {
      addShadowDisc(root, 1.45);
      for (const sx of [-0.95, 0.95]) {
        root.add(makeCyl(0.22, 0.26, 0.32, 14, darkStoneMat, sx, 0.16, 0));
        root.add(makeCyl(0.14, 0.16, 2.55, 16, accentMat, sx, 1.55, 0));
      }
      root.add(makeBox(2.45, 0.15, 0.18, accentMat, 0, 2.25, 0));
      root.add(makeBox(2.95, 0.2, 0.28, accentMat, 0, 2.82, 0));
      root.add(makeBox(3.18, 0.14, 0.34, darkWoodMat, 0, 2.98, 0));
      root.add(makeBox(0.22, 0.48, 0.12, darkWoodMat, 0, 2.52, 0));
      break;
    }

    case 'tea_pavilion': {
      addShadowDisc(root, 1.85);
      root.add(makeBox(2.8, 0.28, 2.8, darkStoneMat, 0, 0.14, 0));
      root.add(makeBox(2.55, 0.08, 2.55, makeMat(0xcac494, { map: tatamiTex, roughness: 0.82 }), 0, 0.31, 0));
      for (const px of [-1.08, 1.08]) {
        for (const pz of [-1.08, 1.08]) {
          root.add(makeCyl(0.09, 0.1, 1.85, 12, darkWoodMat, px, 1.25, pz));
        }
      }
      root.add(makeBox(0.75, 0.22, 0.75, woodMat, 0, 0.45, 0));
      const lowerRoof = makeCyl(1.4, 2.45, 0.55, 4, accentMat, 0, 2.42, 0);
      lowerRoof.rotation.y = Math.PI / 4;
      root.add(lowerRoof);
      const upperRoof = makeCyl(0.15, 1.45, 0.65, 4, darkWoodMat, 0, 2.96, 0);
      upperRoof.rotation.y = Math.PI / 4;
      root.add(upperRoof);
      root.add(makeCyl(0.05, 0.1, 0.24, 10, goldMat, 0, 3.38, 0));
      break;
    }

    case 'ramen_cart': {
      addShadowDisc(root, 1.05);
      root.add(makeBox(1.5, 0.68, 0.85, woodMat, 0, 0.62, 0));
      root.add(makeBox(1.62, 0.07, 0.96, darkWoodMat, 0, 0.99, 0));
      for (const wx of [-0.62, 0.62]) {
        const wheel = makeCyl(0.24, 0.24, 0.08, 18, ironMat, wx, 0.24, 0.46);
        wheel.rotation.x = Math.PI / 2;
        root.add(wheel);
      }
      for (const px of [-0.68, 0.68]) {
        root.add(makeBox(0.07, 1.2, 0.07, darkWoodMat, px, 1.56, -0.35));
        root.add(makeBox(0.07, 1.2, 0.07, darkWoodMat, px, 1.56, 0.35));
      }
      root.add(makeBox(1.72, 0.12, 1.08, darkWoodMat, 0, 2.18, 0));
      for (let i = -2; i <= 2; i++) {
        root.add(makeBox(0.27, 0.32, 0.04, accentMat, i * 0.3, 1.94, 0.48));
      }
      root.add(makeCyl(0.16, 0.16, 0.18, 14, ironMat, -0.25, 1.11, 0));
      break;
    }

    case 'stone_lantern': {
      addShadowDisc(root, 0.55);
      root.add(makeCyl(0.28, 0.35, 0.2, 6, stoneMat, 0, 0.1, 0));
      root.add(makeCyl(0.14, 0.18, 0.75, 8, stoneMat, 0, 0.56, 0));
      root.add(makeBox(0.42, 0.1, 0.42, stoneMat, 0, 0.98, 0));
      const core = makeBox(0.26, 0.3, 0.26, makeMat(accentHex, { emissive: accentHex, emissiveIntensity: 1.15, accent: true }), 0, 1.18, 0);
      core.userData.animatedPart = 'lantern';
      root.add(core);
      root.add(makeCyl(0.08, 0.42, 0.28, 6, darkStoneMat, 0, 1.47, 0));
      root.add(makeCyl(0.03, 0.08, 0.14, 8, stoneMat, 0, 1.66, 0));
      break;
    }

    case 'cherry_blossom_tree': {
      addShadowDisc(root, 1.35);
      const trunk = makeCyl(0.14, 0.26, 1.5, 10, darkWoodMat, 0, 0.72, 0);
      trunk.rotation.z = 0.08;
      root.add(trunk);
      const branch = makeCyl(0.07, 0.11, 0.95, 8, darkWoodMat, 0.32, 1.48, 0);
      branch.rotation.z = -0.62;
      root.add(branch);
      const blossomMat = makeMat(accentHex, { roughness: 0.7, accent: true });
      const canopyGroup = new THREE.Group();
      canopyGroup.userData.animatedPart = 'sakura';
      for (const [cx, cy, cz, r] of [
        [0, 2.05, 0, 0.85],
        [-0.58, 1.85, 0.32, 0.62],
        [0.62, 1.9, -0.25, 0.68],
        [0.15, 2.35, -0.32, 0.55],
      ]) {
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), blossomMat);
        puff.position.set(cx, cy, cz);
        puff.scale.y = 0.76;
        canopyGroup.add(puff);
      }
      root.add(canopyGroup);
      break;
    }

    case 'bamboo_cluster': {
      addShadowDisc(root, 0.7);
      root.add(makeCyl(0.45, 0.5, 0.1, 12, darkStoneMat, 0, 0.05, 0));
      const leafMat = makeMat(accentHex, { map: foliageTex, roughness: 0.65, accent: true });
      const stalks = [
        [-0.18, 2.2, 0.12, 0.055],
        [0.18, 2.55, -0.1, 0.06],
        [0, 1.95, -0.22, 0.05],
        [-0.12, 1.75, -0.05, 0.045],
        [0.22, 2.05, 0.18, 0.05],
      ];
      for (const [sx, h, sz, r] of stalks) {
        root.add(makeCyl(r * 0.9, r, h, 10, leafMat, sx, h / 2 + 0.06, sz));
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 7), leafMat);
        tuft.position.set(sx, h + 0.18, sz);
        root.add(tuft);
      }
      break;
    }

    case 'koi_pond': {
      addShadowDisc(root, 1.58);
      for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        const rx = Math.cos(angle) * 1.25;
        const rz = Math.sin(angle) * 1.15;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26 + (i % 3) * 0.06, 0), stoneMat);
        rock.position.set(rx, 0.14, rz);
        rock.scale.set(1.2, 0.72, 1.0);
        root.add(rock);
      }
      const water = makeCyl(1.16, 1.16, 0.09, 28, makeMat(accentHex, { map: waterTex, roughness: 0.12, metalness: 0.2, accent: true }), 0, 0.09, 0);
      water.userData.animatedPart = 'water';
      root.add(water);
      const padMat = makeMat(0x4b8f48, { roughness: 0.6 });
      for (const [px, pz, pr] of [
        [-0.35, 0.25, 0.22],
        [0.45, -0.3, 0.18],
        [0.12, 0.42, 0.15],
      ]) {
        root.add(makeCyl(pr, pr, 0.02, 14, padMat, px, 0.145, pz));
      }
      break;
    }

    case 'fountain_stone': {
      addShadowDisc(root, 1.62);
      root.add(makeCyl(1.38, 1.48, 0.34, 8, stoneMat, 0, 0.17, 0));
      root.add(makeCyl(1.18, 1.18, 0.12, 16, makeMat(accentHex, { map: waterTex, roughness: 0.15, accent: true }), 0, 0.29, 0));
      root.add(makeCyl(0.22, 0.3, 0.95, 12, stoneMat, 0, 0.68, 0));
      root.add(makeCyl(0.68, 0.28, 0.18, 12, stoneMat, 0, 1.18, 0));
      const jet = makeCyl(0.06, 0.12, 0.62, 10, makeMat('#a9ecff', { emissive: accentHex, emissiveIntensity: 0.45, transparent: true, opacity: 0.85 }), 0, 1.55, 0);
      jet.userData.animatedPart = 'fountain';
      root.add(jet);
      break;
    }

    case 'wooden_bench': {
      addShadowDisc(root, 0.85);
      for (const lx of [-0.62, 0.62]) {
        root.add(makeBox(0.08, 0.42, 0.56, ironMat, lx, 0.21, 0));
        root.add(makeBox(0.08, 0.48, 0.08, ironMat, lx, 0.64, -0.24));
      }
      root.add(makeBox(1.48, 0.07, 0.52, accentMat, 0, 0.44, 0.02));
      const back = makeBox(1.48, 0.36, 0.07, accentMat, 0, 0.72, -0.24);
      back.rotation.x = -0.14;
      root.add(back);
      break;
    }

    case 'cafe_terrace': {
      addShadowDisc(root, 1.25);
      root.add(makeCyl(0.32, 0.36, 0.06, 16, ironMat, 0, 0.03, 0));
      root.add(makeCyl(0.05, 0.05, 0.72, 12, ironMat, 0, 0.39, 0));
      root.add(makeCyl(0.55, 0.55, 0.05, 22, makeMat('#eae8e1', { roughness: 0.3 }), 0, 0.76, 0));
      root.add(makeCyl(0.035, 0.035, 2.15, 10, woodMat, 0, 1.15, 0));
      root.add(makeCyl(0.12, 1.22, 0.42, 8, makeMat(accentHex, { map: awningTex, roughness: 0.65, accent: true }), 0, 2.22, 0));
      for (const sx of [-0.75, 0.75]) {
        root.add(makeBox(0.38, 0.05, 0.38, woodMat, sx, 0.44, 0));
        root.add(makeBox(0.36, 0.4, 0.05, woodMat, sx, 0.66, sx < 0 ? -0.17 : 0.17));
        root.add(makeCyl(0.03, 0.03, 0.44, 8, ironMat, sx, 0.22, 0));
      }
      break;
    }

    case 'street_lamp': {
      addShadowDisc(root, 0.5);
      root.add(makeCyl(0.18, 0.24, 0.34, 10, ironMat, 0, 0.17, 0));
      root.add(makeCyl(0.055, 0.085, 2.15, 10, ironMat, 0, 1.4, 0));
      const globe = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.18, 1),
        makeMat(accentHex, { emissive: accentHex, emissiveIntensity: 1.2, accent: true }),
      );
      globe.position.set(0, 2.6, 0);
      globe.userData.animatedPart = 'lantern';
      root.add(globe);
      root.add(makeCyl(0.04, 0.25, 0.15, 8, ironMat, 0, 2.8, 0));
      break;
    }

    case 'stone_arch': {
      addShadowDisc(root, 1.55);
      for (const sx of [-1.05, 1.05]) {
        root.add(makeBox(0.56, 0.28, 0.64, darkStoneMat, sx, 0.14, 0));
        root.add(makeBox(0.46, 1.65, 0.52, stoneMat, sx, 1.1, 0));
      }
      const archGeo = new THREE.TorusGeometry(1.05, 0.22, 10, 20, Math.PI);
      const arch = new THREE.Mesh(archGeo, accentMat);
      arch.position.set(0, 1.88, 0);
      root.add(arch);
      root.add(makeBox(0.36, 0.42, 0.56, darkStoneMat, 0, 2.95, 0));
      break;
    }

    case 'medieval_tower': {
      addShadowDisc(root, 1.72);
      root.add(makeCyl(1.02, 1.16, 0.36, 10, darkStoneMat, 0, 0.18, 0));
      root.add(makeCyl(0.86, 0.96, 2.35, 10, stoneMat, 0, 1.5, 0));
      root.add(makeBox(0.46, 0.72, 0.16, darkWoodMat, 0, 0.72, 0.9));
      root.add(makeCyl(1.02, 0.94, 0.32, 10, darkStoneMat, 0, 2.78, 0));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        root.add(makeBox(0.28, 0.28, 0.24, stoneMat, Math.cos(a) * 0.92, 3.05, Math.sin(a) * 0.92));
      }
      root.add(makeCyl(0.06, 0.98, 1.18, 10, accentMat, 0, 3.55, 0));
      root.add(makeCyl(0.02, 0.02, 0.38, 6, ironMat, 0, 4.26, 0));
      break;
    }

    case 'modern_kiosk': {
      addShadowDisc(root, 1.4);
      root.add(makeBox(2.2, 0.14, 1.6, darkStoneMat, 0, 0.07, 0));
      const glassMat = makeMat('#8ad4e6', { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 });
      root.add(makeBox(1.8, 1.65, 1.15, glassMat, 0, 0.96, -0.05));
      root.add(makeBox(1.6, 0.72, 0.48, ironMat, 0, 0.5, 0.38));
      const roof = makeBox(2.35, 0.16, 1.75, makeMat('#d2d8e0', { roughness: 0.25, metalness: 0.6 }), 0, 1.9, 0.05);
      roof.rotation.x = -0.06;
      root.add(roof);
      root.add(makeBox(2.36, 0.06, 0.06, makeMat(accentHex, { emissive: accentHex, emissiveIntensity: 0.9, accent: true }), 0, 1.88, 0.9));
      break;
    }

    case 'cyber_tower': {
      addShadowDisc(root, 1.2);
      const alloyMat = makeMat(0x161d2b, { map: techTex, roughness: 0.35, metalness: 0.72 });
      const glowMat = makeMat(accentHex, { emissive: accentHex, emissiveIntensity: 1.35, roughness: 0.2, accent: true });
      root.add(makeCyl(0.88, 1.0, 0.24, 6, alloyMat, 0, 0.12, 0));
      root.add(makeCyl(0.45, 0.74, 2.95, 6, alloyMat, 0, 1.7, 0));
      for (const a of [0, Math.PI * 0.66, Math.PI * 1.33]) {
        const strip = makeBox(0.06, 2.5, 0.06, glowMat, Math.cos(a) * 0.58, 1.68, Math.sin(a) * 0.58);
        root.add(strip);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.045, 10, 32), glowMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 2.65;
      ring.userData.animatedPart = 'holo';
      root.add(ring);
      root.add(makeCyl(0.03, 0.1, 0.7, 8, glowMat, 0, 3.5, 0));
      break;
    }

    case 'hover_rover': {
      addShadowDisc(root, 1.25);
      const craft = new THREE.Group();
      craft.userData.animatedPart = 'rover';
      const hullMat = makeMat(0xd5dce6, { roughness: 0.28, metalness: 0.65 });
      const trimGlow = makeMat(accentHex, { emissive: accentHex, emissiveIntensity: 1.15, accent: true });
      craft.add(makeBox(1.3, 0.36, 1.85, hullMat, 0, 0.62, 0));
      craft.add(makeBox(0.95, 0.28, 0.9, makeMat('#18283a', { roughness: 0.15, metalness: 0.85 }), 0, 0.9, 0.12));
      for (const px of [-0.72, 0.72]) {
        for (const pz of [-0.62, 0, 0.62]) {
          craft.add(makeCyl(0.16, 0.2, 0.14, 12, ironMat, px, 0.54, pz));
          craft.add(makeCyl(0.12, 0.08, 0.06, 12, trimGlow, px, 0.44, pz));
        }
      }
      root.add(craft);
      break;
    }

    case 'crystal_monolith': {
      addShadowDisc(root, 0.95);
      root.add(makeCyl(0.68, 0.82, 0.28, 7, darkStoneMat, 0, 0.14, 0));
      const crystalMat = makeMat(accentHex, {
        emissive: accentHex,
        emissiveIntensity: 0.75,
        roughness: 0.14,
        metalness: 0.15,
        transparent: true,
        opacity: 0.9,
        accent: true,
      });
      for (const [cx, cy, cz, h, rx, rz] of [
        [0, 1.15, 0, 1.9, 0.04, -0.05],
        [-0.36, 0.82, 0.2, 1.25, 0.2, 0.24],
        [0.34, 0.88, -0.18, 1.35, -0.18, -0.2],
      ]) {
        const spire = new THREE.Mesh(new THREE.ConeGeometry(0.24, h, 5), crystalMat);
        spire.position.set(cx, cy, cz);
        spire.rotation.set(rx, 0, rz);
        spire.userData.animatedPart = 'crystal';
        root.add(spire);
      }
      break;
    }

    case 'motorcycle_red': {
      addShadowDisc(root, 1.1);
      for (const wz of [-0.64, 0.64]) {
        const tire = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 12, 24), ironMat);
        tire.rotation.y = Math.PI / 2;
        tire.position.set(0, 0.38, wz);
        root.add(tire);
      }
      root.add(makeBox(0.32, 0.34, 0.92, ironMat, 0, 0.56, 0));
      root.add(makeBox(0.36, 0.24, 0.56, accentMat, 0, 0.82, 0.16));
      root.add(makeBox(0.28, 0.14, 0.48, makeMat('#1f2329', { roughness: 0.8 }), 0, 0.78, -0.34));
      const fork = makeBox(0.18, 0.64, 0.08, goldMat, 0, 0.72, 0.48);
      fork.rotation.x = 0.34;
      root.add(fork);
      root.add(makeBox(0.62, 0.06, 0.06, ironMat, 0, 1.0, 0.38));
      root.add(makeCyl(0.08, 0.08, 0.08, 12, makeMat('#fff5cc', { emissive: '#ffdf88', emissiveIntensity: 1.0 }), 0, 0.88, 0.62));
      break;
    }

    case 'pine_tree':
    default: {
      addShadowDisc(root, 1.15);
      root.add(makeCyl(0.14, 0.22, 0.95, 10, darkWoodMat, 0, 0.47, 0));
      const pineMat = makeMat(accentHex, { map: foliageTex, roughness: 0.78, accent: true });
      for (const [y, r, h] of [
        [1.15, 0.95, 1.05],
        [1.75, 0.76, 0.95],
        [2.28, 0.54, 0.82],
      ]) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9), pineMat);
        cone.position.y = y;
        root.add(cone);
      }
      break;
    }
  }

  tagShadows(root);
  return root;
}

export function applyAssetAccentColor(group: THREE.Group, hex: string): void {
  const color = new THREE.Color(hex);
  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      if (child.material.userData.accentMaterial) {
        child.material.color.copy(color);
        if (child.material.emissiveIntensity > 0) {
          child.material.emissive.copy(color);
        }
      }
    }
  });
}
