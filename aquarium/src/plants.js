import * as THREE from 'three';
import { TANK, sandHeight, makeRng, shared } from './config.js';
import { FLOW_GLSL, WATER_GLSL, waterUniforms } from './shaders.js';
import { insideObstacle } from './terrain.js';

// 水草はすべて同じシェーダーで描き、ポンプの水流で頂点を曲げる。
// aBend: 根元 0 → 先端 1 のしなり具合
const vertexShader = /* glsl */ `
uniform float uTime;
${FLOW_GLSL}
attribute float aBend;
attribute float aPhase;
attribute float aLen;
attribute float aStiff;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vWPos;
varying float vTip;

void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec3 base = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 wp = m * vec4(position, 1.0);

  vec3 f = flowAt(base + vec3(0.0, aLen * 0.6, 0.0));
  vec2 fx = f.xz;
  float fl = length(fx);
  float h = aBend;

  // 水流による定常的なたわみ
  vec2 bend = fx * (0.3 / aStiff) * aLen;
  float bl = length(bend);
  float maxB = 0.8 * aLen;
  if (bl > maxB) bend *= maxB / bl;

  // 流れに対して横方向のはためき + 流れ方向の波打ち
  vec2 dir = fl > 1e-4 ? fx / fl : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float freq = 1.1 + 1.3 / aStiff + fl * 1.2;
  float flutter = sin(uTime * freq + aPhase + h * 3.5) * (0.03 + 0.1 * min(fl, 1.6)) * aLen / aStiff;
  float ripple = sin(uTime * (2.2 + fl) + aPhase * 1.3 - h * 7.0) * 0.035 * min(fl, 1.6) * aLen;
  float idle = sin(uTime * 0.55 + aPhase * 1.7) * 0.025 * aLen;

  vec2 disp = bend * pow(h, 1.6)
            + perp * flutter * h * h
            + dir * ripple * h
            + vec2(idle, idle * 0.6) * h * h;

  // 長さを保つよう、横にずれた分だけ下げる
  float yh = h * aLen;
  float d2 = dot(disp, disp);
  float drop = yh - sqrt(max(yh * yh - d2, 0.0));
  wp.xz += disp;
  wp.y -= drop;

  vCol = color;
  vN = normalize(mat3(m) * normal);
  vWPos = wp.xyz;
  vTip = h;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
${WATER_GLSL}
varying vec3 vCol;
varying vec3 vN;
varying vec3 vWPos;
varying float vTip;

void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 L = normalize(vec3(0.25, 1.0, 0.35));
  float diff = max(dot(n, L), 0.0);
  float trans = max(dot(-n, L), 0.0) * 0.45;
  vec3 col = vCol * (0.32 + 0.8 * diff + trans) * uLightLevel;
  col *= mix(0.75, 1.15, vTip);
  col += vCol * caustic(vWPos, n) * 0.6;
  col = applyWater(col, vWPos);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function plantMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: waterUniforms({ uPump: shared.uPump, uImpact: shared.uImpact }),
    vertexShader,
    fragmentShader,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
}

// 部品を非インデックスの三角形列として集めて 1 つのジオメトリにする
class PlantBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.bend = [];
  }
  add(geo, matrix, colorFn, bendFn) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      colorFn(v, c);
      this.col.push(c.r, c.g, c.b);
      this.bend.push(bendFn(v));
    }
  }
  pushRaw(verts, normals, colors, bends) {
    this.pos.push(...verts); this.nrm.push(...normals); this.col.push(...colors); this.bend.push(...bends);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBend', new THREE.Float32BufferAttribute(this.bend, 1));
    return g;
  }
}

// 高さ 1 のリボン状の葉（バリスネリア・ヘアーグラス）。ねじれながら先細る
function ribbonGeometry(baseColor, tipColor, twist = 2.2) {
  const segs = 18;
  const geo = new THREE.PlaneGeometry(1, 1, 1, segs);
  geo.translate(0, 0.5, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const w = x * (1 - 0.85 * Math.pow(y, 3));
    const a = y * twist;
    p.setXYZ(i, w * Math.cos(a), y, w * Math.sin(a));
  }
  const b = new PlantBuilder();
  const cA = new THREE.Color(baseColor), cB = new THREE.Color(tipColor);
  b.add(geo, new THREE.Matrix4(), (v, c) => c.copy(cA).lerp(cB, v.y), (v) => v.y);
  return b.build();
}

// 有茎草（ロタラ／ルドウィジア風）。茎に対生の葉が並び、先端ほど赤く色づく
function stemGeometry(height, leafColor, tipColor, rng) {
  const b = new PlantBuilder();
  const cL = new THREE.Color(leafColor), cT = new THREE.Color(tipColor);
  const stemCol = new THREE.Color(0x5a7a3a);
  const stem = new THREE.CylinderGeometry(0.012, 0.018, height, 5, 12, true);
  stem.translate(0, height / 2, 0);
  b.add(stem, new THREE.Matrix4(), (v, c) => c.copy(stemCol), (v) => v.y / height);

  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.05, 0.035, 0.16, 0);
  leafShape.quadraticCurveTo(0.05, -0.035, 0, 0);
  const leaf = new THREE.ShapeGeometry(leafShape, 4);
  leaf.rotateX(Math.PI / 2);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const step = 0.09;
  let rot = rng() * Math.PI;
  for (let y = 0.15; y < height; y += step) {
    const t = y / height;
    const size = 0.65 + 0.55 * Math.sin(Math.min(t * 1.6, 1) * Math.PI * 0.5) - 0.25 * Math.max(t - 0.85, 0) / 0.15;
    for (let k = 0; k < 2; k++) {
      const yaw = rot + k * Math.PI;
      e.set(0, yaw, 0.35 + 0.5 * t, 'YZX');
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(0, y, 0), q, new THREE.Vector3(size, size, size));
      b.add(leaf, m, (v, c) => c.copy(cL).lerp(cT, THREE.MathUtils.smoothstep(v.y / height, 0.55, 1.0)),
        (v) => v.y / height);
    }
    rot += Math.PI / 2 + (rng() - 0.5) * 0.3;
  }
  return b.build();
}

// ロゼット型（アマゾンソード／ミクロソリウム風）。葉柄から弧を描いて垂れる
function rosetteGeometry(leafCount, length, baseColor, tipColor, rng, wavy = 0) {
  const b = new PlantBuilder();
  const cA = new THREE.Color(baseColor), cB = new THREE.Color(tipColor);
  const segs = 14;
  for (let l = 0; l < leafCount; l++) {
    const yaw = (l / leafCount) * Math.PI * 2 + rng() * 0.4;
    const elev = rng.range(0.75, 1.35);
    const len = length * rng.range(0.7, 1.05);
    const width = len * rng.range(0.1, 0.14);
    const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const out = Math.cos(elev) * len * u + 0.35 * len * u * u * (1 - Math.cos(elev));
      const up = Math.sin(elev) * len * u - 0.3 * len * u * u * Math.cos(elev * 0.6);
      const center = dir.clone().multiplyScalar(out).setY(up);
      const w = u < 0.25 ? 0.012 : width * Math.sin(Math.PI * (u - 0.25) / 0.75 * 0.95 + 0.05);
      const wave = wavy * Math.sin(u * 25 + l) * width * 0.4;
      pts.push({ center, w, u, wave });
    }
    const verts = [], normals = [], colors = [], bends = [];
    const row = pts.map(({ center, w, wave }) => [
      center.clone().addScaledVector(side, -w).setY(center.y + wave),
      center.clone().addScaledVector(side, w).setY(center.y - wave),
    ]);
    const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const pushTri = (a, bb, c, ua, ub, uc) => {
      e1.subVectors(bb, a); e2.subVectors(c, a); n.crossVectors(e1, e2).normalize();
      for (const [v, u] of [[a, ua], [bb, ub], [c, uc]]) {
        verts.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        const col = cA.clone().lerp(cB, u);
        colors.push(col.r, col.g, col.b);
        bends.push(Math.min(1, u * 1.05));
      }
    };
    for (let i = 0; i < segs; i++) {
      const [a0, a1] = row[i], [b0, b1] = row[i + 1];
      const ua = pts[i].u, ub = pts[i + 1].u;
      pushTri(a0, b0, a1, ua, ub, ua);
      pushTri(a1, b0, b1, ua, ub, ub);
    }
    b.pushRaw(verts, normals, colors, bends);
  }
  return b.build();
}

// 1 種類のジオメトリを多数配置する InstancedMesh
function instanced(geo, material, placements) {
  const g = geo.clone();
  const n = placements.length;
  const phase = new Float32Array(n), len = new Float32Array(n), stiff = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(g, material, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  placements.forEach((p, i) => {
    e.set(p.tiltX ?? 0, p.rotY ?? 0, p.tiltZ ?? 0);
    q.setFromEuler(e);
    m.compose(p.pos, q, p.scale);
    mesh.setMatrixAt(i, m);
    phase[i] = p.phase;
    len[i] = p.len;
    stiff[i] = p.stiff;
  });
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  g.setAttribute('aLen', new THREE.InstancedBufferAttribute(len, 1));
  g.setAttribute('aStiff', new THREE.InstancedBufferAttribute(stiff, 1));
  mesh.frustumCulled = false;
  return mesh;
}

function scatterCluster(rng, cx, cz, radius, count, margin = 0.05) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (x < TANK.minX + 0.1 || x > TANK.maxX - 0.1 || z < TANK.minZ + 0.2 || z > TANK.maxZ - 0.15) continue;
    const y = sandHeight(x, z) - 0.04;
    const p = new THREE.Vector3(x, y, z);
    if (insideObstacle(p, margin)) continue;
    out.push(p);
  }
  return out;
}

export function buildPlants(scene) {
  const rng = makeRng(42);
  const mat = plantMaterial();
  const group = new THREE.Group();
  scene.add(group);

  // バリスネリア：水面近くまで伸びる細長い葉。左奥・右奥・中央奥に茂らせる
  const valGeo = ribbonGeometry(0x2f5d1c, 0x86b940, 2.4);
  const val = [];
  for (const [cx, cz, r, n] of [[-5.1, -0.9, 0.9, 70], [-0.3, -1.05, 1.0, 55], [5.2, -0.5, 0.75, 55], [1.6, -0.95, 0.6, 35]]) {
    for (const pos of scatterCluster(rng, cx, cz, r, n)) {
      const H = Math.min(rng.range(2.6, 4.6), TANK.waterY - pos.y - 0.15);
      const w = rng.range(0.045, 0.08);
      val.push({ pos, scale: new THREE.Vector3(w, H, w), rotY: rng() * Math.PI * 2,
        tiltX: rng.range(-0.08, 0.08), tiltZ: rng.range(-0.08, 0.08),
        phase: rng() * 10, len: H, stiff: rng.range(0.8, 1.2) });
    }
  }
  group.add(instanced(valGeo, mat, val));

  // ヘアーグラス：前景の短い草
  const hairGeo = ribbonGeometry(0x3d6e22, 0x9fd25a, 0.8);
  const hair = [];
  for (const [cx, cz, r, n] of [[-2.2, 1.6, 0.8, 220], [0.9, 1.75, 0.7, 180], [3.3, 1.5, 0.75, 200], [-4.9, 1.9, 0.5, 90]]) {
    for (const pos of scatterCluster(rng, cx, cz, r, n, 0.02)) {
      const H = rng.range(0.18, 0.45);
      const w = rng.range(0.012, 0.02);
      hair.push({ pos, scale: new THREE.Vector3(w, H, w), rotY: rng() * Math.PI * 2,
        tiltX: rng.range(-0.25, 0.25), tiltZ: rng.range(-0.25, 0.25),
        phase: rng() * 10, len: H, stiff: rng.range(1.4, 2.0) });
    }
  }
  group.add(instanced(hairGeo, mat, hair));

  // 有茎草：赤系（ロタラ）と緑系（ハイグロ）
  const stemKinds = [
    { color: 0x5f9a35, tip: 0xd0603a, clusters: [[-3.0, -0.3, 0.55, 22], [3.9, 0.35, 0.4, 12]] },
    { color: 0x4c9a2e, tip: 0xa6d84a, clusters: [[-3.9, -0.8, 0.5, 16], [0.8, -0.3, 0.45, 14], [2.6, -0.8, 0.45, 12]] },
  ];
  for (const kind of stemKinds) {
    const variants = [2.0, 2.6, 3.2, 3.8].map((h) => ({ h, geo: stemGeometry(h, kind.color, kind.tip, rng), list: [] }));
    for (const [cx, cz, r, n] of kind.clusters) {
      for (const pos of scatterCluster(rng, cx, cz, r, n)) {
        const v = rng.pick(variants);
        if (pos.y + v.h > TANK.waterY - 0.2) continue;
        const s = rng.range(0.85, 1.15);
        v.list.push({ pos, scale: new THREE.Vector3(s, 1, s), rotY: rng() * Math.PI * 2,
          tiltX: rng.range(-0.1, 0.1), tiltZ: rng.range(-0.1, 0.1),
          phase: rng() * 10, len: v.h, stiff: rng.range(1.2, 1.6) });
      }
    }
    for (const v of variants) if (v.list.length) group.add(instanced(v.geo, mat, v.list));
  }

  // アマゾンソード：中景の大きなロゼット
  const swordGeo = rosetteGeometry(16, 1.5, 0x2d6a22, 0x6fb33c, rng);
  const swords = [
    { pos: new THREE.Vector3(1.0, 0, 0.35), s: 1.0 },
    { pos: new THREE.Vector3(-0.3, 0, -0.35), s: 0.8 },
    { pos: new THREE.Vector3(4.6, 0, 0.1), s: 0.9 },
  ].map(({ pos, s }) => {
    pos.y = sandHeight(pos.x, pos.z) - 0.05;
    return { pos, scale: new THREE.Vector3(s, s, s), rotY: rng() * 6.28, phase: rng() * 10, len: 1.3 * s, stiff: 1.6 };
  });
  group.add(instanced(swordGeo, mat, swords));

  // ミクロソリウム：流木と岩に活着させた波打つ葉
  const fernGeo = rosetteGeometry(11, 0.8, 0x1f4a1a, 0x4f8a2e, rng, 0.8);
  const ferns = [
    [-3.3, 1.95, 0.05, 0.9], [-2.85, 3.05, -0.5, 0.8], [-3.95, 1.0, 0.65, 0.7],
    [3.4, 1.55, -0.35, 0.8], [-1.35, 0.9, 0.25, 0.65],
  ].map(([x, y, z, s]) => ({
    pos: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(s, s, s), rotY: rng() * 6.28,
    tiltX: rng.range(-0.3, 0.3), tiltZ: rng.range(-0.3, 0.3),
    phase: rng() * 10, len: 0.7 * s, stiff: 1.4,
  }));
  group.add(instanced(fernGeo, mat, ferns));

  return group;
}
