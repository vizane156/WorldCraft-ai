/**
 * ProceduralAssetBuilder — builds multi-part PBR Three.js models for every
 * asset in the WorldCraft catalog.
 *
 * Design principles:
 * - Zero external network dependencies (no .glb / .png 404s)
 * - Every asset is a 5-12 part THREE.Group with bottom-center pivot at y = 0
 * - Procedural CanvasTextures with SRGBColorSpace for wood, stone, awning, tatami
 * - Varied roughness (>= 0.25 contrast) and metalness between adjacent parts
 * - Soft radial contact shadow disc beneath each asset for grounding
 */

import {
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';

export interface AnimatedAssetHandle {
  update: (elapsed: number) => void;
}

// ─── Procedural Texture Cache ──────────────────────────────────────────────

let texWood: CanvasTexture | null = null;
let texStone: CanvasTexture | null = null;
let texAwning: CanvasTexture | null = null;
let texTatami: CanvasTexture | null = null;
let texShadow: CanvasTexture | null = null;

function getWoodTexture(): CanvasTexture {
  if (texWood) return texWood;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8b5a34';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 64; i++) {
    const y = i * 4;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(55, 32, 16, 0.18)' : 'rgba(190, 138, 86, 0.12)';
    ctx.fillRect(0, y, 256, 2);
  }
  ctx.strokeStyle = 'rgba(42, 24, 10, 0.22)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 16; i++) {
    ctx.beginPath();
    const y0 = i * 16 + 4;
    ctx.moveTo(0, y0);
    ctx.bezierCurveTo(85, y0 + 5, 170, y0 - 5, 256, y0 + 2);
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  texWood = tex;
  return tex;
}

function getStoneTexture(): CanvasTexture {
  if (texStone) return texStone;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9b9a94';
  ctx.fillRect(0, 0, 256, 256);
  // Deterministic speckle
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 1800; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const r = 1 + rand() * 3;
    const v = Math.floor(110 + rand() * 75);
    ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},0.35)`;
    ctx.fillRect(x, y, r, r);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  texStone = tex;
  return tex;
}

function getAwningTexture(): CanvasTexture {
  if (texAwning) return texAwning;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const stripes = 8;
  const sw = 256 / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#c9382b' : '#f4efe6';
    ctx.fillRect(i * sw, 0, sw, 256);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < 256; y += 8) {
    ctx.fillRect(0, y, 256, 1);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  texAwning = tex;
  return tex;
}

function getTatamiTexture(): CanvasTexture {
  if (texTatami) return texTatami;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c4be8f';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(130, 125, 70, 0.2)';
  for (let y = 0; y < 256; y += 4) {
    ctx.fillRect(0, y, 256, 1);
  }
  ctx.strokeStyle = '#2d4739';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 246);
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  texTatami = tex;
  return tex;
}

function getContactShadowTexture(): CanvasTexture {
  if (texShadow) return texShadow;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(6, 10, 18, 0.55)');
  grad.addColorStop(0.55, 'rgba(6, 10, 18, 0.25)');
  grad.addColorStop(1, 'rgba(6, 10, 18, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  texShadow = tex;
  return tex;
}

function addContactShadow(group: Group, radius: number): void {
  const geo = new CircleGeometry(radius, 24);
  const mat = new MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  });
  const shadow = new Mesh(geo, mat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.0015;
  shadow.userData.isContactShadow = true;
  group.add(shadow);
}

function enableShadows(obj: Object3D): void {
  obj.traverse((child) => {
    if ((child as Mesh).isMesh && !child.userData.isContactShadow) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function parseColor(hex?: string, fallback = 0xffffff): Color {
  if (!hex) return new Color(fallback);
  try {
    return new Color(hex);
  } catch {
    return new Color(fallback);
  }
}

// ─── 1. Japanese Market Stall ──────────────────────────────────────────────

function buildMarketStall(accentColor?: string): Group {
  const g = new Group();
  const woodMat = new MeshStandardMaterial({
    map: getWoodTexture(),
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0.05,
  });
  const darkWoodMat = new MeshStandardMaterial({
    color: 0x3b2618,
    roughness: 0.78,
    metalness: 0.08,
  });
  const awningMat = new MeshStandardMaterial({
    map: getAwningTexture(),
    color: parseColor(accentColor, 0xffffff),
    roughness: 0.9,
    metalness: 0.0,
    side: DoubleSide,
  });
  const lanternMat = new MeshStandardMaterial({
    color: 0xffd7a3,
    emissive: 0xff7b29,
    emissiveIntensity: 1.4,
    roughness: 0.55,
  });
  const ceramicMat = new MeshStandardMaterial({
    color: 0x365c6b,
    roughness: 0.25,
    metalness: 0.1,
  });

  // Base platform
  const base = new Mesh(new BoxGeometry(0.18, 0.012, 0.13), darkWoodMat);
  base.position.y = 0.006;
  g.add(base);

  // Four corner posts
  const postGeo = new CylinderGeometry(0.006, 0.007, 0.165, 8);
  const postCoords: [number, number][] = [
    [-0.08, -0.055],
    [0.08, -0.055],
    [-0.08, 0.055],
    [0.08, 0.055],
  ];
  for (const [px, pz] of postCoords) {
    const post = new Mesh(postGeo, darkWoodMat);
    post.position.set(px, 0.088, pz);
    g.add(post);
  }

  // Front service counter + lower wooden paneling
  const counter = new Mesh(new BoxGeometry(0.165, 0.012, 0.055), woodMat);
  counter.position.set(0, 0.068, 0.032);
  g.add(counter);

  const apron = new Mesh(new BoxGeometry(0.155, 0.056, 0.01), woodMat);
  apron.position.set(0, 0.034, 0.053);
  g.add(apron);

  // Back display shelf
  const shelf = new Mesh(new BoxGeometry(0.155, 0.01, 0.035), woodMat);
  shelf.position.set(0, 0.085, -0.035);
  g.add(shelf);

  // Goods on counter (ceramic jars & fruit crate)
  const jarGeo = new CylinderGeometry(0.009, 0.011, 0.022, 10);
  for (let i = -1; i <= 1; i++) {
    const jar = new Mesh(jarGeo, ceramicMat);
    jar.position.set(i * 0.032 - 0.02, 0.085, 0.032);
    g.add(jar);
  }
  const crate = new Mesh(
    new BoxGeometry(0.036, 0.016, 0.028),
    new MeshStandardMaterial({ color: 0xd99b43, roughness: 0.85 }),
  );
  crate.position.set(0.048, 0.082, 0.032);
  g.add(crate);

  // Sloped striped awning roof
  const roof = new Mesh(new BoxGeometry(0.205, 0.008, 0.155), awningMat);
  roof.position.set(0, 0.172, 0.008);
  roof.rotation.x = 0.22;
  g.add(roof);

  // Noren banner drop at front eaves
  const noren = new Mesh(
    new BoxGeometry(0.16, 0.024, 0.004),
    new MeshStandardMaterial({
      color: parseColor(accentColor, 0x263f6a),
      roughness: 0.85,
    }),
  );
  noren.position.set(0, 0.145, 0.064);
  g.add(noren);

  // Two hanging paper lanterns
  const lanternGeo = new SphereGeometry(0.013, 12, 10);
  for (const lx of [-0.055, 0.055]) {
    const lantern = new Mesh(lanternGeo, lanternMat);
    lantern.scale.set(0.95, 1.25, 0.95);
    lantern.position.set(lx, 0.138, 0.072);
    lantern.userData.animType = 'lantern_glow';
    g.add(lantern);
  }

  addContactShadow(g, 0.125);
  return g;
}

// ─── 2. Stone Fountain ─────────────────────────────────────────────────────

function buildStoneFountain(accentColor?: string): Group {
  const g = new Group();
  const stoneMat = new MeshStandardMaterial({
    map: getStoneTexture(),
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.05,
  });
  const trimStoneMat = new MeshStandardMaterial({
    color: 0x767874,
    roughness: 0.72,
    metalness: 0.08,
  });
  const waterMat = new MeshPhysicalMaterial({
    color: parseColor(accentColor, 0x3898c8),
    roughness: 0.08,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.84,
  });

  // Stepped octagonal base
  const step1 = new Mesh(new CylinderGeometry(0.115, 0.125, 0.014, 8), trimStoneMat);
  step1.position.y = 0.007;
  g.add(step1);

  // Outer basin wall using LatheGeometry
  const basinPts = [
    new Vector2(0.0, 0.014),
    new Vector2(0.1, 0.014),
    new Vector2(0.105, 0.055),
    new Vector2(0.088, 0.055),
    new Vector2(0.084, 0.025),
    new Vector2(0.0, 0.025),
  ];
  const basin = new Mesh(new LatheGeometry(basinPts, 16), stoneMat);
  g.add(basin);

  // Lower water pool
  const waterPool = new Mesh(new CylinderGeometry(0.086, 0.086, 0.006, 24), waterMat);
  waterPool.position.y = 0.044;
  waterPool.userData.animType = 'water_shimmer';
  g.add(waterPool);

  // Central carved pedestal
  const columnPts = [
    new Vector2(0.032, 0.025),
    new Vector2(0.02, 0.055),
    new Vector2(0.024, 0.085),
    new Vector2(0.016, 0.115),
    new Vector2(0.045, 0.122),
    new Vector2(0.048, 0.132),
    new Vector2(0.014, 0.126),
    new Vector2(0.012, 0.165),
    new Vector2(0.0, 0.172),
  ];
  const column = new Mesh(new LatheGeometry(columnPts, 16), stoneMat);
  g.add(column);

  // Upper water disc
  const upperWater = new Mesh(new CylinderGeometry(0.038, 0.038, 0.004, 18), waterMat);
  upperWater.position.y = 0.131;
  upperWater.userData.animType = 'water_shimmer';
  g.add(upperWater);

  // Rising water plume & droplets
  const plumeMat = new MeshStandardMaterial({
    color: 0xcbeeff,
    emissive: 0x3b82f6,
    emissiveIntensity: 0.25,
    roughness: 0.15,
    transparent: true,
    opacity: 0.78,
  });
  const spout = new Mesh(new ConeGeometry(0.012, 0.042, 10), plumeMat);
  spout.position.y = 0.185;
  spout.userData.animType = 'water_plume';
  g.add(spout);

  addContactShadow(g, 0.135);
  return g;
}

// ─── 3. Red Motorcycle ─────────────────────────────────────────────────────

function buildMotorcycle(accentColor?: string): Group {
  const g = new Group();
  const bodyPaintMat = new MeshPhysicalMaterial({
    color: parseColor(accentColor, 0xd62b22),
    metalness: 0.45,
    roughness: 0.2,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const chromeMat = new MeshStandardMaterial({
    color: 0xd4dae3,
    metalness: 0.92,
    roughness: 0.14,
  });
  const tireMat = new MeshStandardMaterial({
    color: 0x1e2024,
    roughness: 0.88,
    metalness: 0.05,
  });
  const seatMat = new MeshStandardMaterial({
    color: 0x2a2422,
    roughness: 0.75,
    metalness: 0.04,
  });
  const headlightMat = new MeshStandardMaterial({
    color: 0xfff8e7,
    emissive: 0xffe4a0,
    emissiveIntensity: 1.3,
    roughness: 0.1,
  });

  // Wheels (front & rear) — radius 0.036, sitting flush at y = 0.036
  const tireGeo = new TorusGeometry(0.028, 0.0085, 10, 22);
  const rimGeo = new CylinderGeometry(0.02, 0.02, 0.008, 12);
  const discGeo = new CylinderGeometry(0.014, 0.014, 0.01, 12);

  for (const wz of [-0.068, 0.068]) {
    const wheelGroup = new Group();
    wheelGroup.position.set(0, 0.0365, wz);
    const tire = new Mesh(tireGeo, tireMat);
    tire.rotation.y = Math.PI / 2;
    const rim = new Mesh(rimGeo, chromeMat);
    rim.rotation.z = Math.PI / 2;
    const disc = new Mesh(discGeo, chromeMat);
    disc.rotation.z = Math.PI / 2;
    wheelGroup.add(tire, rim, disc);
    g.add(wheelGroup);
  }

  // Engine block & chassis frame
  const engine = new Mesh(new BoxGeometry(0.034, 0.036, 0.052), chromeMat);
  engine.position.set(0, 0.046, 0);
  g.add(engine);

  // Twin chrome exhaust pipes
  const exhaustGeo = new CylinderGeometry(0.0045, 0.0055, 0.09, 8);
  for (const ex of [-0.02, 0.02]) {
    const pipe = new Mesh(exhaustGeo, chromeMat);
    pipe.rotation.x = Math.PI / 2 - 0.12;
    pipe.position.set(ex, 0.034, -0.042);
    g.add(pipe);
  }

  // Sculpted fuel tank + fairing
  const tank = new Mesh(new SphereGeometry(0.026, 14, 12), bodyPaintMat);
  tank.scale.set(0.85, 0.72, 1.45);
  tank.position.set(0, 0.082, 0.016);
  g.add(tank);

  // Front fairing nose
  const fairing = new Mesh(new ConeGeometry(0.02, 0.045, 10), bodyPaintMat);
  fairing.rotation.x = Math.PI / 2 - 0.45;
  fairing.position.set(0, 0.088, 0.058);
  g.add(fairing);

  // Tail cowl
  const tail = new Mesh(new BoxGeometry(0.026, 0.014, 0.046), bodyPaintMat);
  tail.rotation.x = -0.22;
  tail.position.set(0, 0.082, -0.055);
  g.add(tail);

  // Rider saddle
  const seat = new Mesh(new BoxGeometry(0.028, 0.012, 0.048), seatMat);
  seat.position.set(0, 0.072, -0.022);
  g.add(seat);

  // Front forks + handlebars
  const forkGeo = new CylinderGeometry(0.0035, 0.0035, 0.078, 8);
  for (const fx of [-0.014, 0.014]) {
    const fork = new Mesh(forkGeo, chromeMat);
    fork.rotation.x = -0.38;
    fork.position.set(fx, 0.068, 0.054);
    g.add(fork);
  }

  const handlebar = new Mesh(new CylinderGeometry(0.003, 0.003, 0.068, 8), chromeMat);
  handlebar.rotation.z = Math.PI / 2;
  handlebar.position.set(0, 0.102, 0.042);
  g.add(handlebar);

  // Headlight lens
  const headlight = new Mesh(new SphereGeometry(0.009, 10, 10), headlightMat);
  headlight.position.set(0, 0.086, 0.076);
  g.add(headlight);

  addContactShadow(g, 0.105);
  return g;
}

// ─── 4. Cherry Blossom Tree ────────────────────────────────────────────────

function buildCherryBlossomTree(accentColor?: string): Group {
  const g = new Group();
  const barkMat = new MeshStandardMaterial({
    map: getWoodTexture(),
    color: 0x5c3d2e,
    roughness: 0.92,
    metalness: 0.02,
  });
  const blossomMat = new MeshStandardMaterial({
    color: parseColor(accentColor, 0xf7a8c4),
    roughness: 0.72,
    metalness: 0.02,
  });
  const blossomDeepMat = new MeshStandardMaterial({
    color: parseColor(accentColor, 0xe87ea4),
    roughness: 0.76,
    metalness: 0.02,
  });

  // Curved organic trunk via TubeGeometry
  const trunkCurve = new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(0.008, 0.06, 0.005),
    new Vector3(-0.006, 0.13, -0.004),
    new Vector3(0.004, 0.18, 0.006),
  ]);
  const trunk = new Mesh(new TubeGeometry(trunkCurve, 12, 0.017, 8, false), barkMat);
  g.add(trunk);

  // Root flare collar
  const roots = new Mesh(new CylinderGeometry(0.018, 0.032, 0.024, 8), barkMat);
  roots.position.y = 0.012;
  g.add(roots);

  // Major branches
  const branchSpecs: [Vector3, Vector3, number][] = [
    [new Vector3(0.0, 0.12, 0.0), new Vector3(0.055, 0.175, 0.035), 0.009],
    [new Vector3(0.0, 0.135, 0.0), new Vector3(-0.058, 0.185, -0.025), 0.009],
    [new Vector3(0.0, 0.15, 0.0), new Vector3(0.01, 0.21, -0.055), 0.008],
  ];
  for (const [p0, p1, r] of branchSpecs) {
    const curve = new CatmullRomCurve3([p0, p1]);
    const branch = new Mesh(new TubeGeometry(curve, 6, r, 7, false), barkMat);
    g.add(branch);
  }

  // Layered sakura blossom clusters
  const clusters: [number, number, number, number, boolean][] = [
    [0.0, 0.23, 0.0, 0.064, false],
    [0.055, 0.19, 0.036, 0.048, true],
    [-0.056, 0.195, -0.022, 0.05, false],
    [0.012, 0.21, -0.055, 0.046, true],
    [-0.02, 0.205, 0.048, 0.044, true],
    [0.042, 0.225, -0.02, 0.042, false],
  ];
  for (const [cx, cy, cz, cr, deep] of clusters) {
    const puff = new Mesh(
      new SphereGeometry(cr, 12, 10),
      deep ? blossomDeepMat : blossomMat,
    );
    puff.scale.set(1.15, 0.72, 1.15);
    puff.position.set(cx, cy, cz);
    puff.userData.animType = 'canopy_sway';
    g.add(puff);
  }

  addContactShadow(g, 0.115);
  return g;
}

// ─── 5. Toro Stone Lantern ─────────────────────────────────────────────────

function buildStoneLantern(accentColor?: string): Group {
  const g = new Group();
  const stoneMat = new MeshStandardMaterial({
    map: getStoneTexture(),
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.04,
  });
  const glowMat = new MeshStandardMaterial({
    color: 0xffe4b5,
    emissive: parseColor(accentColor, 0xff8c2b),
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });

  // Base pedestal
  const base = new Mesh(new CylinderGeometry(0.038, 0.048, 0.018, 6), stoneMat);
  base.position.y = 0.009;
  g.add(base);

  // Pillar shaft
  const shaft = new Mesh(new CylinderGeometry(0.016, 0.02, 0.075, 8), stoneMat);
  shaft.position.y = 0.055;
  g.add(shaft);

  // Platform tray
  const tray = new Mesh(new CylinderGeometry(0.036, 0.022, 0.014, 6), stoneMat);
  tray.position.y = 0.099;
  g.add(tray);

  // Glowing firebox
  const firebox = new Mesh(new BoxGeometry(0.03, 0.034, 0.03), glowMat);
  firebox.position.y = 0.123;
  firebox.userData.animType = 'lantern_glow';
  g.add(firebox);

  // Corner firebox struts
  const strutGeo = new BoxGeometry(0.005, 0.036, 0.005);
  for (const sx of [-0.015, 0.015]) {
    for (const sz of [-0.015, 0.015]) {
      const strut = new Mesh(strutGeo, stoneMat);
      strut.position.set(sx, 0.123, sz);
      g.add(strut);
    }
  }

  // Pagoda roof cap
  const roof = new Mesh(new ConeGeometry(0.056, 0.034, 6), stoneMat);
  roof.position.y = 0.156;
  g.add(roof);

  // Top finial (hoju)
  const finial = new Mesh(new SphereGeometry(0.01, 10, 8), stoneMat);
  finial.scale.set(1, 1.35, 1);
  finial.position.y = 0.178;
  g.add(finial);

  addContactShadow(g, 0.065);
  return g;
}

// ─── 6. Torii Gate ─────────────────────────────────────────────────────────

function buildToriiGate(accentColor?: string): Group {
  const g = new Group();
  const vermilionMat = new MeshStandardMaterial({
    color: parseColor(accentColor, 0xd43828),
    roughness: 0.45,
    metalness: 0.08,
  });
  const stoneBaseMat = new MeshStandardMaterial({
    color: 0x222428,
    roughness: 0.78,
    metalness: 0.1,
  });
  const plaqueMat = new MeshStandardMaterial({
    color: 0x1a1c22,
    roughness: 0.4,
    metalness: 0.5,
  });

  // Twin pillars + black stone bases (kamebara)
  for (const px of [-0.075, 0.075]) {
    const base = new Mesh(new CylinderGeometry(0.016, 0.02, 0.028, 12), stoneBaseMat);
    base.position.set(px, 0.014, 0);
    g.add(base);

    const pillar = new Mesh(new CylinderGeometry(0.012, 0.014, 0.195, 12), vermilionMat);
    pillar.position.set(px, 0.118, 0);
    g.add(pillar);
  }

  // Lower crossbeam (nuki)
  const nuki = new Mesh(new BoxGeometry(0.195, 0.012, 0.012), vermilionMat);
  nuki.position.set(0, 0.168, 0);
  g.add(nuki);

  // Upper lintel (kasagi + shimaki)
  const kasagi = new Mesh(new BoxGeometry(0.24, 0.014, 0.022), vermilionMat);
  kasagi.position.set(0, 0.214, 0);
  g.add(kasagi);

  const capRoof = new Mesh(new BoxGeometry(0.252, 0.01, 0.028), stoneBaseMat);
  capRoof.position.set(0, 0.224, 0);
  g.add(capRoof);

  // Center plaque (gakuzuka)
  const plaque = new Mesh(new BoxGeometry(0.022, 0.036, 0.016), plaqueMat);
  plaque.position.set(0, 0.191, 0);
  g.add(plaque);

  addContactShadow(g, 0.125);
  return g;
}

// ─── 7. Wooden Garden Bench ────────────────────────────────────────────────

function buildWoodenBench(accentColor?: string): Group {
  const g = new Group();
  const woodMat = new MeshStandardMaterial({
    map: getWoodTexture(),
    color: parseColor(accentColor, 0xe2b27b),
    roughness: 0.72,
    metalness: 0.04,
  });
  const ironMat = new MeshStandardMaterial({
    color: 0x262930,
    roughness: 0.42,
    metalness: 0.78,
  });

  // Iron side frames / legs
  const legGeo = new BoxGeometry(0.008, 0.056, 0.068);
  for (const lx of [-0.072, 0.072]) {
    const leg = new Mesh(legGeo, ironMat);
    leg.position.set(lx, 0.028, 0);
    g.add(leg);

    const arm = new Mesh(new BoxGeometry(0.008, 0.008, 0.065), ironMat);
    arm.position.set(lx, 0.062, 0.002);
    g.add(arm);
  }

  // Seat slats
  const slatGeo = new BoxGeometry(0.16, 0.006, 0.016);
  for (let i = 0; i < 3; i++) {
    const slat = new Mesh(slatGeo, woodMat);
    slat.position.set(0, 0.046, -0.02 + i * 0.021);
    g.add(slat);
  }

  // Backrest slats
  for (let i = 0; i < 2; i++) {
    const back = new Mesh(slatGeo, woodMat);
    back.rotation.x = -0.22;
    back.position.set(0, 0.068 + i * 0.021, -0.031 - i * 0.004);
    g.add(back);
  }

  addContactShadow(g, 0.105);
  return g;
}

// ─── 8. Ramen Yatai Cart ───────────────────────────────────────────────────

function buildRamenCart(accentColor?: string): Group {
  const g = new Group();
  const woodMat = new MeshStandardMaterial({
    map: getWoodTexture(),
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.05,
  });
  const steelMat = new MeshStandardMaterial({
    color: 0xcfd6de,
    roughness: 0.22,
    metalness: 0.88,
  });
  const roofMat = new MeshStandardMaterial({
    color: parseColor(accentColor, 0xb82e24),
    roughness: 0.82,
    metalness: 0.04,
  });
  const lanternMat = new MeshStandardMaterial({
    color: 0xffd5b0,
    emissive: 0xff4d24,
    emissiveIntensity: 1.5,
    roughness: 0.5,
  });

  // Cart wheels
  const wheelGeo = new CylinderGeometry(0.02, 0.02, 0.01, 16);
  for (const wx of [-0.075, 0.075]) {
    for (const wz of [-0.045, 0.045]) {
      const wheel = new Mesh(wheelGeo, steelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.02, wz);
      g.add(wheel);
    }
  }

  // Cart body + stainless counter
  const body = new Mesh(new BoxGeometry(0.16, 0.06, 0.095), woodMat);
  body.position.set(0, 0.056, 0);
  g.add(body);

  const counter = new Mesh(new BoxGeometry(0.17, 0.008, 0.105), steelMat);
  counter.position.set(0, 0.09, 0);
  g.add(counter);

  // Steaming broth pot
  const pot = new Mesh(new CylinderGeometry(0.02, 0.018, 0.028, 12), steelMat);
  pot.position.set(-0.035, 0.108, -0.01);
  g.add(pot);

  // Corner poles + pitched canopy
  const poleGeo = new CylinderGeometry(0.0045, 0.0045, 0.105, 8);
  for (const px of [-0.072, 0.072]) {
    for (const pz of [-0.042, 0.042]) {
      const pole = new Mesh(poleGeo, woodMat);
      pole.position.set(px, 0.14, pz);
      g.add(pole);
    }
  }
  const roof = new Mesh(new BoxGeometry(0.19, 0.012, 0.125), roofMat);
  roof.position.set(0, 0.195, 0);
  g.add(roof);

  // Chochin lantern
  const chochin = new Mesh(new SphereGeometry(0.014, 12, 10), lanternMat);
  chochin.scale.set(0.9, 1.35, 0.9);
  chochin.position.set(0.06, 0.155, 0.055);
  chochin.userData.animType = 'lantern_glow';
  g.add(chochin);

  // Two stools in front
  const stoolMat = new MeshStandardMaterial({ color: 0x543824, roughness: 0.75 });
  for (const sx of [-0.035, 0.035]) {
    const stoolTop = new Mesh(new CylinderGeometry(0.015, 0.015, 0.006, 12), stoolMat);
    stoolTop.position.set(sx, 0.042, 0.078);
    const stoolLeg = new Mesh(new CylinderGeometry(0.005, 0.01, 0.04, 8), steelMat);
    stoolLeg.position.set(sx, 0.02, 0.078);
    g.add(stoolTop, stoolLeg);
  }

  addContactShadow(g, 0.13);
  return g;
}

// ─── 9. Bamboo Cluster ─────────────────────────────────────────────────────

function buildBambooCluster(accentColor?: string): Group {
  const g = new Group();
  const caneMat = new MeshStandardMaterial({
    color: parseColor(accentColor, 0x5c9e47),
    roughness: 0.42,
    metalness: 0.05,
  });
  const nodeMat = new MeshStandardMaterial({
    color: 0x3b6e2b,
    roughness: 0.55,
  });
  const leafMat = new MeshStandardMaterial({
    color: parseColor(accentColor, 0x458b3c),
    roughness: 0.65,
    side: DoubleSide,
  });

  const mound = new Mesh(
    new CylinderGeometry(0.052, 0.062, 0.014, 12),
    new MeshStandardMaterial({ color: 0x4b4235, roughness: 0.92 }),
  );
  mound.position.y = 0.007;
  g.add(mound);

  const stalks: [number, number, number, number][] = [
    [-0.02, 0.012, 0.22, 0.08],
    [0.018, -0.014, 0.19, -0.06],
    [0.022, 0.02, 0.16, 0.04],
    [-0.015, -0.022, 0.145, -0.07],
    [0.0, 0.0, 0.24, 0.02],
  ];

  for (const [sx, sz, h, tilt] of stalks) {
    const stalkGroup = new Group();
    stalkGroup.position.set(sx, 0.01, sz);
    stalkGroup.rotation.z = tilt;

    const cane = new Mesh(new CylinderGeometry(0.006, 0.008, h, 8), caneMat);
    cane.position.y = h / 2;
    stalkGroup.add(cane);

    for (let k = 1; k <= 3; k++) {
      const ring = new Mesh(new TorusGeometry(0.0072, 0.0014, 6, 10), nodeMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = (h * k) / 4;
      stalkGroup.add(ring);
    }

    const leafCluster = new Mesh(new ConeGeometry(0.026, 0.045, 6), leafMat);
    leafCluster.rotation.x = Math.PI;
    leafCluster.position.y = h - 0.015;
    leafCluster.userData.animType = 'canopy_sway';
    stalkGroup.add(leafCluster);

    g.add(stalkGroup);
  }

  addContactShadow(g, 0.08);
  return g;
}

// ─── 10. Tea House Pavilion ────────────────────────────────────────────────

function buildTeaPavilion(accentColor?: string): Group {
  const g = new Group();
  const woodMat = new MeshStandardMaterial({
    map: getWoodTexture(),
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.05,
  });
  const tatamiMat = new MeshStandardMaterial({
    map: getTatamiTexture(),
    color: 0xffffff,
    roughness: 0.9,
  });
  const roofMat = new MeshStandardMaterial({
    color: parseColor(accentColor, 0x353b47),
    roughness: 0.62,
    metalness: 0.15,
  });
  const shojiMat = new MeshStandardMaterial({
    color: 0xf7f1e3,
    emissive: 0xffcf87,
    emissiveIntensity: 0.45,
    roughness: 0.8,
  });

  // Raised timber deck
  const deck = new Mesh(new BoxGeometry(0.22, 0.022, 0.22), woodMat);
  deck.position.y = 0.011;
  g.add(deck);

  // Tatami floor insert
  const tatami = new Mesh(new BoxGeometry(0.18, 0.004, 0.18), tatamiMat);
  tatami.position.y = 0.024;
  g.add(tatami);

  // Corner posts
  const postGeo = new BoxGeometry(0.014, 0.125, 0.014);
  for (const px of [-0.085, 0.085]) {
    for (const pz of [-0.085, 0.085]) {
      const post = new Mesh(postGeo, woodMat);
      post.position.set(px, 0.085, pz);
      g.add(post);
    }
  }

  // Back shoji screen wall
  const shoji = new Mesh(new BoxGeometry(0.16, 0.11, 0.008), shojiMat);
  shoji.position.set(0, 0.082, -0.085);
  g.add(shoji);

  // Low tea table inside
  const table = new Mesh(new BoxGeometry(0.068, 0.018, 0.048), woodMat);
  table.position.set(0, 0.035, 0);
  g.add(table);

  // Two-tier hipped pagoda roof
  const lowerRoof = new Mesh(new ConeGeometry(0.175, 0.055, 4), roofMat);
  lowerRoof.rotation.y = Math.PI / 4;
  lowerRoof.position.y = 0.172;
  g.add(lowerRoof);

  const upperRoof = new Mesh(new ConeGeometry(0.105, 0.045, 4), roofMat);
  upperRoof.rotation.y = Math.PI / 4;
  upperRoof.position.y = 0.205;
  g.add(upperRoof);

  const spire = new Mesh(
    new CylinderGeometry(0.003, 0.006, 0.028, 8),
    new MeshStandardMaterial({ color: 0xd4a644, metalness: 0.85, roughness: 0.22 }),
  );
  spire.position.y = 0.238;
  g.add(spire);

  addContactShadow(g, 0.155);
  return g;
}

// ─── 11. Modern Holo-Kiosk ─────────────────────────────────────────────────

function buildModernKiosk(accentColor?: string): Group {
  const g = new Group();
  const metalMat = new MeshStandardMaterial({
    color: 0x2a3140,
    metalness: 0.86,
    roughness: 0.22,
  });
  const trimMat = new MeshStandardMaterial({
    color: 0xb7c2d0,
    metalness: 0.9,
    roughness: 0.18,
  });
  const holoColor = parseColor(accentColor, 0x38bdf8);
  const holoMat = new MeshStandardMaterial({
    color: holoColor,
    emissive: holoColor,
    emissiveIntensity: 1.4,
    roughness: 0.1,
    transparent: true,
    opacity: 0.85,
  });
  const glassMat = new MeshPhysicalMaterial({
    color: 0x9bd8ff,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.65,
  });

  // Circular base
  const base = new Mesh(new CylinderGeometry(0.058, 0.068, 0.018, 20), metalMat);
  base.position.y = 0.009;
  g.add(base);

  // Pedestal spine
  const spine = new Mesh(new BoxGeometry(0.032, 0.13, 0.022), trimMat);
  spine.position.set(0, 0.082, -0.014);
  g.add(spine);

  // Angled glass console screen
  const screenFrame = new Mesh(new BoxGeometry(0.072, 0.048, 0.008), metalMat);
  screenFrame.rotation.x = -0.55;
  screenFrame.position.set(0, 0.11, 0.008);
  g.add(screenFrame);

  const screenGlass = new Mesh(new PlaneGeometry(0.064, 0.04), glassMat);
  screenGlass.rotation.x = -0.55;
  screenGlass.position.set(0, 0.112, 0.012);
  g.add(screenGlass);

  // Floating rotating holo ring
  const holoRing = new Mesh(new TorusGeometry(0.032, 0.003, 10, 24), holoMat);
  holoRing.position.set(0, 0.168, 0);
  holoRing.rotation.x = Math.PI / 3;
  holoRing.userData.animType = 'holo_spin';
  g.add(holoRing);

  const holoCore = new Mesh(new SphereGeometry(0.012, 12, 10), holoMat);
  holoCore.position.set(0, 0.168, 0);
  g.add(holoCore);

  addContactShadow(g, 0.082);
  return g;
}

// ─── 12. Koi Zen Pond ──────────────────────────────────────────────────────

function buildKoiPond(accentColor?: string): Group {
  const g = new Group();
  const rockMat = new MeshStandardMaterial({
    map: getStoneTexture(),
    color: 0x8d8d87,
    roughness: 0.88,
    metalness: 0.04,
  });
  const bedMat = new MeshStandardMaterial({
    color: 0x26383d,
    roughness: 0.9,
  });
  const waterMat = new MeshPhysicalMaterial({
    color: parseColor(accentColor, 0x2c8da8),
    roughness: 0.06,
    metalness: 0.08,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.78,
  });
  const lilyMat = new MeshStandardMaterial({
    color: 0x4d9442,
    roughness: 0.62,
  });
  const koiMat = new MeshStandardMaterial({
    color: 0xf4602c,
    emissive: 0x7c2d12,
    emissiveIntensity: 0.35,
    roughness: 0.35,
  });

  // Pond floor bed
  const bed = new Mesh(new CylinderGeometry(0.115, 0.12, 0.008, 24), bedMat);
  bed.position.y = 0.004;
  g.add(bed);

  // Water disc
  const water = new Mesh(new CylinderGeometry(0.112, 0.112, 0.006, 24), waterMat);
  water.position.y = 0.014;
  water.userData.animType = 'water_shimmer';
  g.add(water);

  // Perimeter river rocks
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rx = Math.cos(a) * 0.114;
    const rz = Math.sin(a) * 0.114;
    const rScale = 0.8 + ((i * 7) % 5) * 0.12;
    const rock = new Mesh(new SphereGeometry(0.018 * rScale, 8, 7), rockMat);
    rock.scale.set(1.25, 0.72, 1.0);
    rock.position.set(rx, 0.014, rz);
    rock.rotation.y = a;
    g.add(rock);
  }

  // Lily pads (using ExtrudeGeometry / notched circle)
  const padShape = new Shape();
  padShape.absarc(0, 0, 0.018, 0.25, Math.PI * 2 - 0.25, false);
  padShape.lineTo(0, 0);
  const padGeo = new ExtrudeGeometry(padShape, { depth: 0.002, bevelEnabled: false });
  for (const [lx, lz, rot] of [
    [-0.04, 0.032, 0.4],
    [0.048, -0.028, 2.1],
    [-0.025, -0.05, 1.1],
  ]) {
    const pad = new Mesh(padGeo, lilyMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = rot;
    pad.position.set(lx, 0.0185, lz);
    g.add(pad);
  }

  // Swimming Koi pivot group
  const koiPivot = new Group();
  koiPivot.position.y = 0.012;
  koiPivot.userData.animType = 'koi_orbit';
  const koiBody = new Mesh(new SphereGeometry(0.011, 10, 8), koiMat);
  koiBody.scale.set(0.65, 0.5, 1.8);
  koiBody.position.set(0.042, 0, 0);
  koiPivot.add(koiBody);
  g.add(koiPivot);

  addContactShadow(g, 0.135);
  return g;
}

// ─── Public Builder & Animator ─────────────────────────────────────────────

export function buildProceduralAsset(
  assetId: string,
  accentColor?: string,
): Group {
  let group: Group;
  switch (assetId) {
    case 'market_stall_japanese':
      group = buildMarketStall(accentColor);
      break;
    case 'fountain_stone':
      group = buildStoneFountain(accentColor);
      break;
    case 'motorcycle_red':
      group = buildMotorcycle(accentColor);
      break;
    case 'cherry_blossom_tree':
      group = buildCherryBlossomTree(accentColor);
      break;
    case 'stone_lantern':
      group = buildStoneLantern(accentColor);
      break;
    case 'torii_gate':
      group = buildToriiGate(accentColor);
      break;
    case 'wooden_bench':
      group = buildWoodenBench(accentColor);
      break;
    case 'ramen_cart':
      group = buildRamenCart(accentColor);
      break;
    case 'bamboo_cluster':
      group = buildBambooCluster(accentColor);
      break;
    case 'tea_pavilion':
      group = buildTeaPavilion(accentColor);
      break;
    case 'modern_kiosk':
      group = buildModernKiosk(accentColor);
      break;
    case 'koi_pond':
      group = buildKoiPond(accentColor);
      break;
    default: {
      // Graceful fallback composite plinth (never a bare unstyled cube)
      group = new Group();
      const plinth = new Mesh(
        new CylinderGeometry(0.05, 0.06, 0.08, 12),
        new MeshStandardMaterial({
          color: parseColor(accentColor, 0x64748b),
          roughness: 0.55,
          metalness: 0.25,
        }),
      );
      plinth.position.y = 0.04;
      group.add(plinth);
      addContactShadow(group, 0.075);
      break;
    }
  }

  enableShadows(group);
  return group;
}

export function animateSceneObject(root: Object3D, elapsed: number): void {
  root.traverse((child) => {
    const type = child.userData.animType as string | undefined;
    if (!type) return;
    if (type === 'water_plume') {
      const s = 1 + Math.sin(elapsed * 5.2) * 0.12;
      child.scale.set(1, s, 1);
      child.rotation.y = elapsed * 1.4;
    } else if (type === 'water_shimmer') {
      child.position.y = (child.userData.baseY ?? child.position.y);
      if (child.userData.baseY === undefined) {
        child.userData.baseY = child.position.y;
      }
      child.position.y = child.userData.baseY + Math.sin(elapsed * 2.4) * 0.0008;
    } else if (type === 'koi_orbit') {
      child.rotation.y = elapsed * 0.7;
    } else if (type === 'holo_spin') {
      child.rotation.y = elapsed * 1.2;
      child.rotation.z = Math.sin(elapsed * 1.5) * 0.2;
    } else if (type === 'canopy_sway') {
      if (child.userData.baseRotZ === undefined) {
        child.userData.baseRotZ = child.rotation.z;
      }
      child.rotation.z = child.userData.baseRotZ + Math.sin(elapsed * 1.4 + child.position.x * 8) * 0.025;
    }
  });
}
