import * as THREE from 'three';
import { TANK, sandHeight, noise3, fbm3, makeRng } from './config.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { enhanceStandard } from './shaders.js';

// 魚が避ける障害物（楕円体）。center と radius（各軸の半径）
export const obstacles = [];

export function buildTerrain(scene) {
  const group = new THREE.Group();
  scene.add(group);
  group.add(buildSand());
  group.add(buildBackWall());
  group.add(buildGravel());
  for (const r of buildRocks()) group.add(r);
  group.add(buildDriftwood());
  return group;
}

function sandTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rng = makeRng(11);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm3(x / 60, y / 60, 0.5, 3) * 0.5 + 0.5;
      const grain = rng();
      let v = 0.78 + 0.18 * n + (grain - 0.5) * 0.22;
      if (grain > 0.985) v *= 0.55;
      const i = (y * size + x) * 4;
      img.data[i] = 222 * v;
      img.data[i + 1] = 200 * v;
      img.data[i + 2] = 160 * v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildSand() {
  const w = TANK.maxX - TANK.minX;
  const d = TANK.maxZ - TANK.minZ;
  const geo = new THREE.PlaneGeometry(w, d, 180, 80);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, sandHeight(x, z));
    uv.setXY(i, x / 2.2, z / 2.2);
  }
  geo.computeVertexNormals();

  // 前面・側面ガラス越しに見える底床の断面
  const skirt = buildSkirt();
  const tex = sandTexture();
  const mat = enhanceStandard(new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
  }), { key: 'sand' });

  const g = new THREE.Group();
  const top = new THREE.Mesh(geo, mat);
  top.receiveShadow = true;
  g.add(top);
  const side = new THREE.Mesh(skirt, mat);
  side.receiveShadow = true;
  g.add(side);
  return g;
}

function buildSkirt() {
  const verts = [], uvs = [], idx = [];
  const e = 0.001;
  const edges = [
    // 前面（左→右）
    (t) => [THREE.MathUtils.lerp(TANK.minX, TANK.maxX, t), TANK.maxZ - e, [0, 0, 1]],
    // 左面
    (t) => [TANK.minX + e, THREE.MathUtils.lerp(TANK.minZ, TANK.maxZ, t), [-1, 0, 0]],
    // 右面
    (t) => [TANK.maxX - e, THREE.MathUtils.lerp(TANK.maxZ, TANK.minZ, t), [1, 0, 0]],
  ];
  const normals = [];
  for (const edge of edges) {
    const base = verts.length / 3;
    const n = 160;
    for (let i = 0; i <= n; i++) {
      const [x, z, nrm] = edge(i / n);
      const h = sandHeight(x, z);
      verts.push(x, 0, z, x, h, z);
      const s = (x + z) / 2.2;
      uvs.push(s, 0, s, h / 2.2);
      normals.push(...nrm, ...nrm);
      if (i < n) {
        const a = base + i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

// 奥の壁を覆う岩のバックスクリーン。水槽の裏側が見えないようにする
function rockWallTexture() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W * 12, v = y / H * 6;
      const cracks = Math.abs(noise3(u * 1.3, v * 1.3, 4.2));
      const layer = Math.sin(v * 5.5 + fbm3(u * 0.8, v * 0.8, 1.7, 3) * 4) * 0.5 + 0.5;
      const n = fbm3(u * 1.8, v * 1.8, 9.1, 4);
      let r = 0.42 + 0.22 * n + 0.08 * layer;
      r *= 0.78 + 0.22 * THREE.MathUtils.smoothstep(cracks, 0.0, 0.1);
      const warm = 0.5 + 0.5 * noise3(u * 0.4, v * 0.4, 2.2);
      const i = (y * W + x) * 4;
      img.data[i] = 255 * r * (0.95 + 0.12 * warm);
      img.data[i + 1] = 255 * r * (0.9 + 0.06 * warm);
      img.data[i + 2] = 255 * r * (0.82 - 0.05 * warm);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildBackWall() {
  const w = TANK.maxX - TANK.minX;
  const h = TANK.glassTop;
  const geo = new THREE.PlaneGeometry(w, h, 160, 80);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i) + h / 2;
    const edge = 1 - THREE.MathUtils.smoothstep(Math.abs(x), w / 2 - 0.3, w / 2);
    const relief = (0.2 + 0.18 * fbm3(x * 0.5, y * 0.5, 5.5, 4) + 0.05 * noise3(x * 3, y * 3, 1)) * edge;
    pos.setXYZ(i, x, y, TANK.minZ + 0.02 + Math.max(relief, 0) * 1.4);
  }
  geo.computeVertexNormals();
  const mat = enhanceStandard(new THREE.MeshStandardMaterial({
    map: rockWallTexture(), roughness: 0.9,
  }), { key: 'wall', causticGain: 0.35 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildGravel() {
  const base = new THREE.IcosahedronGeometry(1, 1);
  const p = base.attributes.position;
  const rng0 = makeRng(5);
  // 頂点ごとに歪ませて角の取れた小石にする（同一座標の頂点は同じだけ動かす）
  const jitter = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.75 + rng0() * 0.4);
    const s = jitter.get(key);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.6, p.getZ(i) * s);
  }
  base.computeVertexNormals();

  const count = 5200;
  const mat = enhanceStandard(new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }), { key: 'gravel' });
  const mesh = new THREE.InstancedMesh(base, mat, count);
  const rng = makeRng(21);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const e = new THREE.Euler();
  const palette = [0x8a8378, 0x6b645c, 0xb9ad98, 0x4d4640, 0xd8d0c0, 0x7a6450, 0x9a8d7a];
  const col = new THREE.Color();
  let n = 0;
  while (n < count) {
    const x = rng.range(TANK.minX + 0.05, TANK.maxX - 0.05);
    const z = rng.range(-1.4, TANK.maxZ - 0.04);
    // 手前ほど密に、奥（砂の斜面）は疎らに
    const density = THREE.MathUtils.smoothstep(z, -1.4, 0.2);
    if (rng() > density) continue;
    const size = rng.range(0.035, 0.085) * (rng() < 0.08 ? 1.6 : 1);
    t.set(x, sandHeight(x, z) - size * 0.05, z);
    e.set(rng() * 0.6, rng() * Math.PI * 2, rng() * 0.6);
    q.setFromEuler(e);
    s.set(size * rng.range(0.8, 1.3), size, size * rng.range(0.8, 1.3));
    m.compose(t, q, s);
    mesh.setMatrixAt(n, m);
    col.setHex(rng.pick(palette)).multiplyScalar(rng.range(0.8, 1.15));
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function rockGeometry(seed, detail = 5) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const geo = mergeVertices(ico);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const o = seed * 13.37;
  const v = new THREE.Vector3();
  const cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    let r = cache.get(key);
    if (r === undefined) {
      const ridge = 1 - Math.abs(noise3(v.x * 2.2 + o, v.y * 2.2, v.z * 2.2));
      r = 1 + 0.28 * fbm3(v.x * 1.3 + o, v.y * 1.3, v.z * 1.3, 4) + 0.1 * ridge * ridge
        + 0.04 * noise3(v.x * 7 + o, v.y * 7, v.z * 7);
      cache.set(key, r);
    }
    // 底面は平らにして砂に据わらせる
    const y = Math.max(v.y * r, -0.55);
    pos.setXYZ(i, v.x * r, y, v.z * r);
    const strata = Math.sin(y * 9 + noise3(v.x * 3 + o, y * 3, v.z * 3) * 2.5) * 0.5 + 0.5;
    const tone = 0.13 + 0.07 * strata + 0.06 * noise3(v.x * 4 + o, v.y * 4, v.z * 4);
    const moss = THREE.MathUtils.smoothstep(v.y, 0.35, 0.9) * 0.5 * (0.5 + 0.5 * noise3(v.x * 5 + o, v.y * 5, v.z * 5));
    colors[i * 3] = tone * 1.08 * (1 - moss) + 0.05 * moss;
    colors[i * 3 + 1] = tone * 1.0 * (1 - moss) + 0.12 * moss;
    colors[i * 3 + 2] = tone * 0.88 * (1 - moss) + 0.03 * moss;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// 奥に積んだ岩で背面を塞ぎ、中景にも石組みを置く
const ROCKS = [
  // 奥の岩壁
  { x: -5.3, z: -1.95, sx: 1.1, sy: 2.5, sz: 0.85 },
  { x: -3.9, z: -2.0, sx: 1.3, sy: 1.7, sz: 0.9 },
  { x: -2.5, z: -2.05, sx: 1.0, sy: 3.0, sz: 0.8 },
  { x: -1.05, z: -2.1, sx: 1.4, sy: 1.5, sz: 0.85 },
  { x: 0.4, z: -2.0, sx: 1.1, sy: 2.3, sz: 0.9 },
  { x: 1.85, z: -2.1, sx: 1.5, sy: 1.8, sz: 0.8 },
  { x: 3.1, z: -2.05, sx: 0.9, sy: 2.5, sz: 0.8 },
  { x: 4.4, z: -2.15, sx: 1.1, sy: 1.1, sz: 0.7 },
  { x: 5.4, z: -2.1, sx: 0.8, sy: 1.7, sz: 0.7 },
  // 隙間を埋める手前側の岩
  { x: -4.6, z: -1.35, sx: 0.7, sy: 0.9, sz: 0.6 },
  { x: -1.8, z: -1.45, sx: 0.8, sy: 1.1, sz: 0.6 },
  { x: 1.1, z: -1.45, sx: 0.7, sy: 0.8, sz: 0.55 },
  { x: 2.6, z: -1.4, sx: 0.6, sy: 1.0, sz: 0.55 },
  // 中景の石組み
  { x: -1.4, z: 0.25, sx: 0.8, sy: 0.65, sz: 0.62 },
  { x: -0.55, z: 0.7, sx: 0.36, sy: 0.3, sz: 0.3 },
  { x: 2.3, z: 0.45, sx: 0.7, sy: 0.55, sz: 0.55 },
  { x: 3.4, z: -0.35, sx: 0.85, sy: 1.15, sz: 0.7 },
  { x: -4.4, z: 0.75, sx: 0.5, sy: 0.35, sz: 0.45 },
  { x: 4.6, z: 1.2, sx: 0.4, sy: 0.3, sz: 0.35 },
];

function buildRocks() {
  const mat = enhanceStandard(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0,
  }), { key: 'rock' });
  const rng = makeRng(77);
  return ROCKS.map((d, i) => {
    const geo = rockGeometry(i + 1, d.sx > 0.6 ? 5 : 4);
    const mesh = new THREE.Mesh(geo, mat);
    const y = sandHeight(d.x, d.z) + d.sy * 0.28;
    mesh.position.set(d.x, y, d.z);
    mesh.scale.set(d.sx, d.sy, d.sz);
    mesh.rotation.y = rng() * Math.PI * 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    obstacles.push({
      center: new THREE.Vector3(d.x, y + d.sy * 0.15, d.z),
      radius: new THREE.Vector3(d.sx * 1.15, d.sy * 1.05, d.sz * 1.15),
    });
    return mesh;
  });
}

function buildDriftwood() {
  const group = new THREE.Group();
  const mat = enhanceStandard(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85,
  }), { key: 'wood' });
  const branches = [
    { pts: [[-4.6, 0.3, 1.2], [-3.9, 0.9, 0.7], [-3.3, 1.9, 0.1], [-2.9, 3.0, -0.5], [-2.7, 3.6, -0.9]], r: 0.16 },
    { pts: [[-3.5, 1.5, 0.35], [-4.1, 2.4, 0.0], [-4.6, 3.1, -0.3]], r: 0.07 },
    { pts: [[-3.0, 2.7, -0.35], [-2.2, 3.1, -0.2], [-1.6, 3.2, -0.5]], r: 0.06 },
    { pts: [[-4.4, 0.45, 1.05], [-5.2, 0.55, 0.8], [-5.7, 0.9, 0.4]], r: 0.08 },
  ];
  branches.forEach((b, bi) => {
    const curve = new THREE.CatmullRomCurve3(b.pts.map((p) => new THREE.Vector3(...p)));
    const tubular = 60, radial = 10;
    const geo = new THREE.TubeGeometry(curve, tubular, b.r, radial, false);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= tubular; i++) {
      const u = i / tubular;
      curve.getPointAt(u, c);
      const taper = 1 - 0.75 * Math.pow(u, 1.3);
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        v.fromBufferAttribute(pos, k).sub(c);
        const bark = 1 + 0.18 * noise3(u * 30 + bi, j * 0.7, bi * 3.3);
        v.multiplyScalar(taper * bark).add(c);
        pos.setXYZ(k, v.x, v.y, v.z);
        const streak = 0.5 + 0.5 * noise3(u * 60 + bi * 5, j * 1.3, 0.5);
        const tone = 0.18 + 0.12 * streak;
        colors[k * 3] = tone * 1.25;
        colors[k * 3 + 1] = tone * 0.88;
        colors[k * 3 + 2] = tone * 0.6;
      }
      if (i % 6 === 0) {
        obstacles.push({
          center: c.clone(),
          radius: new THREE.Vector3(1, 1, 1).multiplyScalar(b.r * taper + 0.18),
        });
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

export function insideObstacle(p, margin = 0) {
  for (const o of obstacles) {
    const dx = (p.x - o.center.x) / (o.radius.x + margin);
    const dy = (p.y - o.center.y) / (o.radius.y + margin);
    const dz = (p.z - o.center.z) / (o.radius.z + margin);
    if (dx * dx + dy * dy + dz * dz < 1) return true;
  }
  return false;
}
