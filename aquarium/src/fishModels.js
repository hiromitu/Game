import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { enhanceStandard } from './shaders.js';

// 魚のモデルはローカル座標で 頭 = +x、背 = +y、右体側 = +z。
// 体は球を変形させ、ひれはグリッド状の面にして尾びれまで滑らかに曲がるようにする

const lerp = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;

function profile(t, peak, tail, headPow) {
  if (t < peak) {
    const u = t / peak;
    return tail + (1 - tail) * Math.pow(Math.sin(u * Math.PI / 2), 1.1);
  }
  const u = (t - peak) / (1 - peak);
  return Math.pow(Math.cos(u * Math.PI / 2), headPow);
}

function bodyGeometry(o) {
  const { L, H, W, peak = 0.6, tail = 0.12, headPow = 0.55, belly = 1, back = 1, snoutDrop = 0, colorFn } = o;
  const g = new THREE.SphereGeometry(1, 40, 24);
  g.rotateZ(-Math.PI / 2);
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (x + 1) / 2;
    const ring = Math.hypot(y, z);
    const ny = ring > 1e-6 ? y / ring : 0;
    const nz = ring > 1e-6 ? z / ring : 0;
    const pr = profile(t, peak, tail, headPow);
    const yy = ny * (ny > 0 ? back : belly) * (H / 2) * pr - snoutDrop * H * smooth(t, 0.7, 1.0);
    const zz = nz * (W / 2) * pr;
    p.setXYZ(i, x * L / 2, yy, zz);
    const c = colorFn(t, ny, nz);
    colors.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// 体表の上端（背びれを付ける高さ）
function bodyTop(o, x) {
  const t = x / o.L + 0.5;
  return (o.H / 2) * (o.back ?? 1) * profile(THREE.MathUtils.clamp(t, 0, 1), o.peak ?? 0.6, o.tail ?? 0.12, o.headPow ?? 0.55);
}

function eyes(o, color = [0.02, 0.02, 0.02], ring = [0.75, 0.72, 0.6]) {
  const t = o.eyeT ?? 0.86;
  const x = (t - 0.5) * o.L;
  const r = o.eyeR ?? o.H * 0.16;
  const zSurf = (o.W / 2) * profile(t, o.peak ?? 0.6, o.tail ?? 0.12, o.headPow ?? 0.55);
  const y = o.eyeY ?? o.H * 0.1;
  const parts = [];
  for (const side of [1, -1]) {
    const g = new THREE.SphereGeometry(r, 12, 8);
    g.deleteAttribute('uv');
    g.scale(1, 1, 0.6);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const outward = (p.getZ(i) * side) / (r * 0.6);
      colors.set(outward > 0.55 ? color : ring, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.translate(x, y, side * (zSurf - r * 0.15));
    parts.push(g.toNonIndexed());
  }
  return parts;
}

// 4 隅（A: 前・付け根, B: 後・付け根, C: 後・先端, D: 前・先端）を双線形補間したひれ
function finQuad(A, B, C, D, colorFn, nu = 6, nv = 6) {
  return finGrid((u, v) => {
    const out = [];
    for (let k = 0; k < 3; k++) {
      const base = lerp(A[k] ?? 0, B[k] ?? 0, u);
      const tip = lerp(D[k] ?? 0, C[k] ?? 0, u);
      out.push(lerp(base, tip, v));
    }
    return out;
  }, colorFn, nu, nv);
}

function finGrid(posFn, colorFn, nu = 8, nv = 8) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv;
      const [x, y, z = 0] = posFn(u, v);
      pos.push(x, y, z);
      col.push(...colorFn(x, y, u, v));
      if (i < nu && j < nv) {
        const a = i * (nv + 1) + j;
        idx.push(a, a + nv + 1, a + 1, a + 1, a + nv + 1, a + nv + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// 尾びれ。fork > 0 で二叉、< 0 で丸い扇形
function caudal(xt, hb, ht, len, fork, colorFn, n = 10) {
  return finGrid((u, v) => {
    const s = v * 2 - 1;
    // fork < 0 は後縁が丸く張り出す扇形（グッピーのデルタテール等）
    const edge = fork >= 0
      ? len * (1 - fork * (1 - Math.abs(s)) ** 1.5)
      : len * (1 + fork + -fork * Math.sqrt(Math.max(0, 1 - s * s)));
    const x = xt - u * edge;
    const y = s * lerp(hb, ht, Math.pow(u, 0.8));
    return [x, y];
  }, (x, y, u, v) => colorFn(x, y, u, v), n, n);
}

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------------------------------------------------------- 各種の形と色

function neonModel() {
  const o = { L: 0.36, H: 0.095, W: 0.055, peak: 0.55, tail: 0.16, headPow: 0.6, eyeR: 0.018, eyeT: 0.85 };
  const back = [0.3, 0.28, 0.2], blue = [0.1, 0.7, 1.35], red = [1.1, 0.06, 0.08], belly = [0.85, 0.85, 0.82];
  o.colorFn = (t, ny) => {
    const stripe = smooth(ny, -0.12, 0.0) * (1 - smooth(ny, 0.3, 0.45)) * smooth(t, 0.12, 0.25) * (1 - smooth(t, 0.86, 0.95));
    const lower = 1 - smooth(ny, -0.2, -0.05);
    const redZone = lower * (1 - smooth(t, 0.5, 0.6)) * smooth(t, 0.08, 0.18);
    let c = ny > 0.2 ? back : mix3(back, belly, smooth(-ny, -0.2, 0.3));
    c = mix3(c, red, redZone);
    c = mix3(c, blue, stripe);
    return c;
  };
  const clear = [0.75, 0.78, 0.82];
  const fins = [
    caudal(-0.15, 0.02, 0.07, 0.1, 0.55, (x, y, u) => mix3([0.9, 0.2, 0.2], clear, u * 1.5 > 1 ? 1 : u * 1.5)),
    finQuad([0.0, 0.035], [-0.05, 0.03], [-0.07, 0.075], [-0.02, 0.085], () => clear, 3, 3),
    finQuad([0.02, -0.03], [-0.1, -0.02], [-0.11, -0.05], [0.0, -0.065], () => clear, 4, 3),
  ];
  return { o, body: [bodyGeometry(o), ...eyes(o, [0.05, 0.05, 0.08], [0.4, 0.55, 0.7])], fins };
}

function angelModel() {
  const o = { L: 0.62, H: 0.64, W: 0.12, peak: 0.52, tail: 0.18, headPow: 0.75, snoutDrop: 0.05, eyeR: 0.045, eyeT: 0.82, eyeY: 0.06 };
  const silver = [0.86, 0.87, 0.82], dark = [0.06, 0.06, 0.07], gold = [0.95, 0.78, 0.45];
  const bar = (t) => Math.max(
    1 - smooth(Math.abs(t - 0.82), 0.025, 0.05),
    1 - smooth(Math.abs(t - 0.56), 0.035, 0.065),
    1 - smooth(Math.abs(t - 0.3), 0.03, 0.06),
  );
  o.colorFn = (t, ny) => {
    let c = mix3(silver, gold, smooth(ny, 0.5, 0.95) * smooth(t, 0.55, 0.8) * 0.6);
    return mix3(c, dark, bar(t) * 0.92);
  };
  const finCol = (x) => {
    const t = x / o.L + 0.5;
    return mix3([0.55, 0.57, 0.58], dark, bar(t) * 0.9);
  };
  const top = (x) => bodyTop(o, x) * 0.8;
  const fins = [
    finQuad([0.1, top(0.1)], [-0.24, top(-0.24) * 0.8], [-0.4, 0.66], [-0.3, 0.8], finCol, 10, 10),
    finQuad([0.06, -top(0.06)], [-0.24, -top(-0.24) * 0.8], [-0.4, -0.7], [-0.32, -0.84], finCol, 10, 10),
    caudal(-0.27, 0.07, 0.24, 0.26, -0.25, (x, y, u) => mix3([0.72, 0.74, 0.74], [0.35, 0.35, 0.36], u * u), 10),
    // 腹びれの糸状の鰭条
    finQuad([0.16, -0.2, 0.02], [0.13, -0.2, 0.02], [-0.12, -0.85, 0.05], [-0.1, -0.86, 0.05], () => [0.8, 0.8, 0.78], 2, 10),
    finQuad([0.16, -0.2, -0.02], [0.13, -0.2, -0.02], [-0.12, -0.85, -0.05], [-0.1, -0.86, -0.05], () => [0.8, 0.8, 0.78], 2, 10),
  ];
  return { o, body: [bodyGeometry(o), ...eyes(o, [0.05, 0.02, 0.02], [0.75, 0.25, 0.15])], fins };
}

const GUPPY_TAILS = [
  { a: [1.1, 0.3, 0.05], b: [1.0, 0.75, 0.1], spots: [0.08, 0.04, 0.03] },
  { a: [0.1, 0.3, 1.1], b: [0.45, 0.85, 1.1], spots: [0.05, 0.05, 0.15] },
  { a: [0.05, 0.05, 0.05], b: [1.0, 0.85, 0.15], spots: [0.02, 0.02, 0.02] },
  { a: [0.9, 0.1, 0.35], b: [1.0, 0.55, 0.75], spots: [0.25, 0.02, 0.1] },
  { a: [0.2, 0.7, 0.3], b: [0.95, 0.95, 0.3], spots: [0.02, 0.1, 0.03] },
];

function guppyModel(variant, female) {
  const o = female
    ? { L: 0.34, H: 0.1, W: 0.065, peak: 0.55, tail: 0.18, headPow: 0.55, eyeR: 0.02, eyeT: 0.84 }
    : { L: 0.26, H: 0.07, W: 0.048, peak: 0.55, tail: 0.2, headPow: 0.55, eyeR: 0.016, eyeT: 0.84 };
  const pal = GUPPY_TAILS[variant % GUPPY_TAILS.length];
  const grey = [0.62, 0.62, 0.52];
  o.colorFn = female
    ? (t, ny) => mix3(mix3(grey, [0.85, 0.85, 0.78], smooth(-ny, 0.0, 0.6)), [0.2, 0.2, 0.18], (1 - smooth(Math.abs(t - 0.45), 0.03, 0.07)) * smooth(-ny, -0.1, 0.3) * 0.7)
    : (t, ny, nz) => {
      const base = mix3([0.7, 0.72, 0.62], [0.9, 0.9, 0.85], smooth(-ny, 0.0, 0.6));
      const patch = (1 - smooth(t, 0.1, 0.35)) * 0.9 + (Math.sin(t * 40 + nz * 6) > 0.6 ? 0.4 : 0) * (1 - smooth(t, 0.3, 0.6));
      return mix3(base, pal.a, Math.min(patch, 1));
    };
  const xt = -o.L / 2 + 0.02;
  const tailCol = female
    ? () => [0.7, 0.68, 0.55]
    : (x, y, u, v) => {
      const spot = Math.sin(x * 140 + Math.sin(y * 90) * 2) * Math.sin(y * 120) > 0.55;
      return spot ? pal.spots : mix3(pal.a, pal.b, u);
    };
  const fins = female
    ? [
      caudal(xt, 0.02, 0.06, 0.12, -0.2, tailCol, 6),
      finQuad([0.0, 0.04], [-0.05, 0.035], [-0.08, 0.06], [-0.03, 0.07], () => [0.7, 0.68, 0.55], 3, 3),
    ]
    : [
      caudal(xt, 0.015, 0.14, 0.27, -0.45, tailCol, 12),
      finQuad([0.0, 0.03], [-0.06, 0.028], [-0.2, 0.08], [-0.05, 0.08], (x, y, u, v) => mix3(pal.a, pal.b, v), 6, 4),
    ];
  return { o, body: [bodyGeometry(o), ...eyes(o)], fins };
}

function coryModel(panda) {
  const o = { L: 0.5, H: 0.18, W: 0.15, peak: 0.62, tail: 0.25, headPow: 0.8, belly: 0.55, back: 1.25, snoutDrop: 0.18, eyeR: 0.026, eyeT: 0.82, eyeY: 0.035 };
  const dark = [0.05, 0.05, 0.05];
  if (panda) {
    const cream = [0.92, 0.86, 0.75];
    o.colorFn = (t, ny) => {
      const eyePatch = (1 - smooth(Math.abs(t - 0.83), 0.04, 0.07)) * smooth(ny, -0.5, -0.1);
      const tailSpot = (1 - smooth(t, 0.12, 0.2)) * smooth(ny, -0.3, 0.1);
      return mix3(mix3(cream, [0.98, 0.95, 0.9], smooth(-ny, 0.2, 0.7)), dark, Math.max(eyePatch, tailSpot));
    };
  } else {
    const bronze = [0.55, 0.4, 0.22], green = [0.25, 0.48, 0.38], belly = [0.9, 0.78, 0.6];
    o.colorFn = (t, ny, nz) => {
      const sheen = (1 - smooth(Math.abs(ny), 0.1, 0.6));
      const c = mix3(bronze, green, sheen * smooth(t, 0.2, 0.4) * (1 - smooth(t, 0.8, 0.9)));
      return mix3(c, belly, smooth(-ny, 0.3, 0.75));
    };
  }
  const finBase = panda ? [0.85, 0.82, 0.75] : [0.6, 0.5, 0.35];
  const dorsalCol = panda ? () => dark : () => finBase;
  const fins = [
    finQuad([0.06, 0.1], [-0.05, 0.1], [-0.06, 0.2], [0.02, 0.24], dorsalCol, 4, 5),
    caudal(-0.22, 0.035, 0.1, 0.13, 0.45, () => finBase, 8),
    finQuad([0.12, -0.04, 0.05], [0.06, -0.05, 0.06], [0.0, -0.08, 0.17], [0.07, -0.07, 0.17], () => finBase, 3, 4),
    finQuad([0.12, -0.04, -0.05], [0.06, -0.05, -0.06], [0.0, -0.08, -0.17], [0.07, -0.07, -0.17], () => finBase, 3, 4),
    finQuad([-0.1, 0.1], [-0.14, 0.09], [-0.15, 0.13], [-0.12, 0.13], () => finBase, 2, 2),
  ];
  return { o, body: [bodyGeometry(o), ...eyes(o, dark, [0.45, 0.45, 0.4])], fins };
}

const modelCache = new Map();
export function getModel(kind, variant = 0) {
  const key = `${kind}:${variant}`;
  if (modelCache.has(key)) return modelCache.get(key);
  let m;
  if (kind === 'neon') m = neonModel();
  else if (kind === 'angel') m = angelModel();
  else if (kind === 'guppyM') m = guppyModel(variant, false);
  else if (kind === 'guppyF') m = guppyModel(variant, true);
  else if (kind === 'coryPanda') m = coryModel(true);
  else m = coryModel(false);
  const model = {
    L: m.o.L,
    body: mergeGeometries(m.body),
    fins: mergeGeometries(m.fins),
  };
  model.body.computeBoundingSphere();
  modelCache.set(key, model);
  return model;
}

const BEND_PARS = /* glsl */ `
uniform float uPhase;
uniform float uAmp;
uniform float uBend;
uniform float uHeadX;
uniform float uLen;
uniform float uWaveK;
`;
const BEND_CODE = /* glsl */ `
{
  float s = clamp((uHeadX - transformed.x) / uLen, 0.0, 1.5);
  float env = 0.1 + s * s;
  transformed.z += sin(uPhase - s * uWaveK) * uAmp * env * uLen + uBend * s * s * uLen;
}
`;

// 1 匹ぶんのメッシュ（体とひれ）。ユニフォームは 2 つのマテリアルで共有する
export function createFishMesh(kind, variant, opts = {}) {
  const model = getModel(kind, variant);
  const uniforms = {
    uPhase: { value: Math.random() * 10 },
    uAmp: { value: 0.1 },
    uBend: { value: 0 },
    uHeadX: { value: model.L / 2 },
    uLen: { value: model.L },
    uWaveK: { value: opts.waveK ?? 5.5 },
  };
  const bodyMat = enhanceStandard(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: opts.roughness ?? 0.35, metalness: opts.metalness ?? 0.2,
  }), { uniforms, vertexPars: BEND_PARS, beginVertex: BEND_CODE, key: 'fishBody', causticGain: 0.3 });
  const finMat = enhanceStandard(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.5, metalness: 0, transparent: true, opacity: opts.finOpacity ?? 0.72,
    side: THREE.DoubleSide,
  }), { uniforms, vertexPars: BEND_PARS, beginVertex: BEND_CODE, key: 'fishFin', causticGain: 0.2 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(model.body, bodyMat);
  body.castShadow = true;
  const fins = new THREE.Mesh(model.fins, finMat);
  fins.castShadow = true;
  group.add(body, fins);
  return { group, uniforms, length: model.L };
}
