import * as THREE from 'three';
import { B, BLOCKS, isSolidId, faceTile, getAtlas, tileUV, crackTexture } from './blocks.js';

// ステージは 1m 四方のブロックを詰めた立方体（SX × SY × SZ）。
// 描画は 16³ のチャンクごとにまとめたメッシュ、当たり判定はグリッドを直接引く。
// 立方体の外側（側面・底・天井）は見えない壁で、壊せない。

export const GRAVITY = 26;
const CH = 16;
const AO = [0.42, 0.62, 0.8, 1.0];
const WATER_DROP = 0.12;
const FLOOD_LIMIT = 400;

// 面ごとの法線と 4 頂点（外から見て 左下・右下・右上・左上）
const FACES = [
  { n: [1, 0, 0], key: 'side', c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], key: 'side', c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], key: 'top', c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], key: 'bottom', c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], key: 'side', c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], key: 'side', c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

// カメラとキャラを結ぶ線の近くにある地形を描かず、キャラが隠れないようにする
export function applyCutaway(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCutWorld;
        uniform vec3 uCutPlayer;
        uniform vec3 uCutCam;
        uniform float uCutR;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uCutR > 0.0) {
          vec3 seg = uCutPlayer - uCutCam;
          float L = length(seg);
          vec3 dir = seg / L;
          vec3 rel = vCutWorld - uCutCam;
          float t = dot(rel, dir);
          float end = L - 1.1;
          if (t > 0.0 && t < end) {
            float r = uCutR * clamp((end - t) / 1.5, 0.35, 1.0);
            float d = length(rel - dir * t);
            float edge = (d - (r - 0.6)) / 0.6;
            float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            if (edge < 0.0 || (edge < 1.0 && n > edge)) discard;
          }
        }`);
  };
}

export class VoxelWorld {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cutUniforms = {
      uCutPlayer: { value: new THREE.Vector3() },
      uCutCam: { value: new THREE.Vector3() },
      uCutR: { value: 0 },
    };
    const atlas = getAtlas();
    this.solidMat = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.95 });
    applyCutaway(this.solidMat, this.cutUniforms);
    this.waterMat = new THREE.MeshStandardMaterial({
      map: atlas, vertexColors: true, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.1, depthWrite: false,
    });
    this.entityMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.95 });
    this.crackMats = [1, 2].map((l) => new THREE.MeshBasicMaterial({
      map: crackTexture(l), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.crackGeo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    this.flashGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    this.blockGeos = new Map();
    this.onBreak = null; // ({ x, y, z, def, dir }) => void
    this.onLand = null;  // ({ x, y, z, def, impact }) => void
    this.init(1, 1, 1);
  }

  init(SX, SY, SZ) {
    this.clearMeshes();
    this.SX = SX; this.SY = SY; this.SZ = SZ;
    this.types = new Uint8Array(SX * SY * SZ);
    this.damageTaken = new Uint8Array(SX * SY * SZ);
    this.chunks = new Map();
    this.dirty = new Set();
    this.falling = [];
    this.cracks = new Map();
    this.flashes = [];
    this.brokenCount = 0;
  }

  clearMeshes() {
    for (const c of this.chunks?.values() ?? []) {
      for (const m of [c.solid, c.water]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    }
    for (const e of this.falling ?? []) this.group.remove(e.mesh);
    for (const m of this.cracks?.values() ?? []) this.group.remove(m);
    for (const f of this.flashes ?? []) { this.group.remove(f.mesh); f.mesh.material.dispose(); }
  }

  // ---------- グリッド ----------
  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.SX && y < this.SY && z < this.SZ;
  }
  idx(x, y, z) { return x + this.SX * (z + this.SZ * y); }
  get(x, y, z) { return this.inBounds(x, y, z) ? this.types[this.idx(x, y, z)] : -1; }

  isSolid(x, y, z) {
    if (!this.inBounds(x, y, z)) return true;
    return isSolidId(this.types[this.idx(x, y, z)]);
  }
  isWater(x, y, z) { return this.get(x, y, z) === B.WATER; }
  isWaterAt(px, py, pz) { return this.isWater(Math.floor(px), Math.floor(py), Math.floor(pz)); }

  set(x, y, z, t) {
    if (!this.inBounds(x, y, z)) return;
    const i = this.idx(x, y, z);
    if (this.types[i] === t) return;
    this.types[i] = t;
    this.damageTaken[i] = 0;
    this.removeCrack(i);
    this.markDirty(x, y, z);
  }

  markDirty(x, y, z) {
    const cx = Math.floor(x / CH), cy = Math.floor(y / CH), cz = Math.floor(z / CH);
    // 境目のブロックは隣のチャンクの面や陰影にも影響する
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const lx = x - cx * CH, ly = y - cy * CH, lz = z - cz * CH;
      if ((dx === -1 && lx !== 0) || (dx === 1 && lx !== CH - 1)) continue;
      if ((dy === -1 && ly !== 0) || (dy === 1 && ly !== CH - 1)) continue;
      if ((dz === -1 && lz !== 0) || (dz === 1 && lz !== CH - 1)) continue;
      this.dirty.add(this.chunkKey(cx + dx, cy + dy, cz + dz));
    }
  }
  chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }

  // 列 (x, z) で一番上のブロックの上面の高さ
  surfaceTop(x, z) {
    for (let y = this.SY - 1; y >= 0; y--) if (isSolidId(this.types[this.idx(x, y, z)])) return y + 1;
    return 0;
  }

  // 点 (px, pz) の真下で、高さ py 以下にある一番高い面（立方体の外なら -Infinity）
  topBelow(px, pz, py) {
    const x = Math.floor(px), z = Math.floor(pz);
    if (x < 0 || z < 0 || x >= this.SX || z >= this.SZ) return -Infinity;
    for (let y = Math.min(this.SY - 1, Math.floor(py - 1 + 1e-6)); y >= 0; y--) {
      if (isSolidId(this.types[this.idx(x, y, z)])) return y + 1;
    }
    return 0;
  }

  // 範囲に重なる固いセルを箱として返す（キャラの当たり判定用）
  // kind: 'block' 壊せるブロック / 'bound' 立方体の見えない壁
  boxesIn(x0, y0, z0, x1, y1, z1) {
    const out = [];
    const ix0 = Math.max(-1, Math.floor(x0)), ix1 = Math.min(this.SX, Math.ceil(x1) - 1);
    const iy0 = Math.max(-1, Math.floor(y0)), iy1 = Math.min(this.SY, Math.ceil(y1) - 1);
    const iz0 = Math.max(-1, Math.floor(z0)), iz1 = Math.min(this.SZ, Math.ceil(z1) - 1);
    for (let y = iy0; y <= iy1; y++) {
      for (let z = iz0; z <= iz1; z++) {
        for (let x = ix0; x <= ix1; x++) {
          const inside = this.inBounds(x, y, z);
          if (inside && !isSolidId(this.types[this.idx(x, y, z)])) continue;
          out.push({ kind: inside ? 'block' : 'bound', x, y, z, min: { x, y, z }, max: { x: x + 1, y: y + 1, z: z + 1 } });
        }
      }
    }
    return out;
  }

  // 視線の先で最初に当たる固いブロック（立方体の中のものだけ）。
  // 返り値 { x, y, z, t, normal }（normal は当たった面の外向き）/ 当たらなければ null
  raycast(o, d, maxT) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const next = (p, c, s, dv) => (s > 0 ? (c + 1 - p) / dv : s < 0 ? (p - c) / -dv : Infinity);
    let tx = next(o.x, x, sx, d.x), ty = next(o.y, y, sy, d.y), tz = next(o.z, z, sz, d.z);
    const dx = sx ? Math.abs(1 / d.x) : Infinity, dy = sy ? Math.abs(1 / d.y) : Infinity, dz = sz ? Math.abs(1 / d.z) : Infinity;
    let t = 0, normal = [0, 0, 0];
    while (t <= maxT) {
      if (this.inBounds(x, y, z) && isSolidId(this.types[this.idx(x, y, z)])) return { x, y, z, t, normal };
      if (tx < ty && tx < tz) { t = tx; x += sx; tx += dx; normal = [-sx, 0, 0]; }
      else if (ty < tz) { t = ty; y += sy; ty += dy; normal = [0, -sy, 0]; }
      else { t = tz; z += sz; tz += dz; normal = [0, 0, -sz]; }
    }
    return null;
  }

  // ---------- 破壊 ----------
  // 殴った。壊せないもの（空気・水・立方体の壁）なら null
  damage(x, y, z, amount, dir) {
    const t = this.get(x, y, z);
    if (t <= 0 || t === B.WATER) return null;
    const d = BLOCKS[t];
    const i = this.idx(x, y, z);
    this.damageTaken[i] = Math.min(255, this.damageTaken[i] + amount);
    this.flash(x, y, z);
    if (this.damageTaken[i] >= d.hp) {
      this.breakBlock(x, y, z, dir);
      return { def: d, broken: true };
    }
    const ratio = 1 - this.damageTaken[i] / d.hp;
    this.setCrack(i, x, y, z, ratio <= 0.4 ? 2 : 1);
    return { def: d, broken: false };
  }

  breakBlock(x, y, z, dir) {
    const d = BLOCKS[this.get(x, y, z)];
    this.set(x, y, z, B.AIR);
    this.brokenCount++;
    this.onBreak?.({ x, y, z, def: d, dir });
    this.afterRemoved(x, y, z);
  }

  afterRemoved(x, y, z) {
    // 上に積もった砂や木箱は落ちてくる
    for (let j = y + 1; j < this.SY; j++) {
      const t = this.get(x, j, z);
      if (!BLOCKS[t]?.loose) break;
      this.set(x, j, z, B.AIR);
      this.spawnFalling(t, x, j, z);
    }
    this.flood(x, y, z);
  }

  // 空いた場所に隣（横か上）の水が流れ込む。下が空いていれば下へ、そうでなければ横へ広がる
  flood(x, y, z) {
    const queue = [[x, y, z]];
    let count = 0;
    while (queue.length && count < FLOOD_LIMIT) {
      const [cx, cy, cz] = queue.shift();
      if (this.get(cx, cy, cz) !== B.AIR) continue;
      const fed = this.isWater(cx, cy + 1, cz) || this.isWater(cx + 1, cy, cz) || this.isWater(cx - 1, cy, cz)
        || this.isWater(cx, cy, cz + 1) || this.isWater(cx, cy, cz - 1);
      if (!fed) continue;
      this.set(cx, cy, cz, B.WATER);
      count++;
      if (this.get(cx, cy - 1, cz) === B.AIR) queue.push([cx, cy - 1, cz]);
      else for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) queue.push([cx + dx, cy, cz + dz]);
    }
  }

  setCrack(i, x, y, z, level) {
    let m = this.cracks.get(i);
    if (!m) {
      m = new THREE.Mesh(this.crackGeo, this.crackMats[level - 1]);
      m.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.group.add(m);
      this.cracks.set(i, m);
    }
    m.material = this.crackMats[level - 1];
  }

  removeCrack(i) {
    const m = this.cracks.get(i);
    if (m) { this.group.remove(m); this.cracks.delete(i); }
  }

  flash(x, y, z) {
    const mesh = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({
      color: 0xfff4d8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.group.add(mesh);
    this.flashes.push({ mesh, life: 0.15 });
  }

  // ---------- 落ちてくるブロック ----------
  blockGeometry(t) {
    if (this.blockGeos.has(t)) return this.blockGeos.get(t);
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    const uv = g.attributes.uv;
    const keys = ['side', 'side', 'top', 'bottom', 'side', 'side'];
    for (let f = 0; f < 6; f++) {
      const [u0, v0, u1, v1] = tileUV(faceTile(t, keys[f]));
      for (let k = f * 4; k < f * 4 + 4; k++) {
        uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
      }
    }
    this.blockGeos.set(t, g);
    return g;
  }

  spawnFalling(t, x, y, z) {
    const mesh = new THREE.Mesh(this.blockGeometry(t), this.entityMat);
    mesh.castShadow = true;
    mesh.position.set(x + 0.5, y, z + 0.5);
    this.group.add(mesh);
    this.falling.push({ t, x, z, y, vy: 0, mesh });
  }

  updateFalling(dt) {
    this.falling.sort((a, b) => a.y - b.y);
    for (let i = 0; i < this.falling.length; i++) {
      const e = this.falling[i];
      e.vy = Math.max(e.vy - GRAVITY * dt, -30);
      e.y += e.vy * dt;
      const cell = Math.floor(e.y);
      if (e.y <= 0 || this.isSolid(e.x, cell, e.z)) {
        const landY = e.y <= 0 ? 0 : cell + 1;
        this.group.remove(e.mesh);
        this.falling.splice(i--, 1);
        if (landY < this.SY) {
          this.set(e.x, landY, e.z, e.t);
          this.onLand?.({ x: e.x, y: landY, z: e.z, def: BLOCKS[e.t], impact: -e.vy });
        }
        continue;
      }
      e.mesh.position.y = e.y;
    }
  }

  update(dt) {
    this.updateFalling(dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.group.remove(f.mesh);
        f.mesh.material.dispose();
        this.flashes.splice(i, 1);
      } else {
        f.mesh.material.opacity = 0.55 * (f.life / 0.15);
      }
    }
    this.rebuildDirty();
  }

  // ---------- メッシュ生成 ----------
  buildAll() {
    const nx = Math.ceil(this.SX / CH), ny = Math.ceil(this.SY / CH), nz = Math.ceil(this.SZ / CH);
    for (let cx = 0; cx < nx; cx++) for (let cy = 0; cy < ny; cy++) for (let cz = 0; cz < nz; cz++) {
      this.dirty.add(this.chunkKey(cx, cy, cz));
    }
    this.rebuildDirty();
  }

  rebuildDirty() {
    for (const key of this.dirty) {
      const [cx, cy, cz] = key.split(',').map(Number);
      if (cx < 0 || cy < 0 || cz < 0 || cx * CH >= this.SX || cy * CH >= this.SY || cz * CH >= this.SZ) continue;
      this.buildChunk(cx, cy, cz, key);
    }
    this.dirty.clear();
  }

  // 陰影（AO）用：その位置に光を遮るブロックがあるか
  occludes(x, y, z) {
    if (y < 0) return true;
    if (!this.inBounds(x, y, z)) return false;
    return isSolidId(this.types[this.idx(x, y, z)]);
  }

  buildChunk(cx, cy, cz, key) {
    const old = this.chunks.get(key);
    if (old) for (const m of [old.solid, old.water]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    const S = { pos: [], nor: [], uv: [], col: [], idx: [] };
    const W = { pos: [], nor: [], uv: [], col: [], idx: [] };
    const x1 = Math.min(this.SX, (cx + 1) * CH), y1 = Math.min(this.SY, (cy + 1) * CH), z1 = Math.min(this.SZ, (cz + 1) * CH);

    for (let y = cy * CH; y < y1; y++) {
      for (let z = cz * CH; z < z1; z++) {
        for (let x = cx * CH; x < x1; x++) {
          const t = this.types[this.idx(x, y, z)];
          if (t === B.AIR) continue;
          const water = t === B.WATER;
          const waterTop = water && !this.isWater(x, y + 1, z);
          for (const f of FACES) {
            const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
            if (ny < 0) continue;
            const nt = this.get(nx, ny, nz); // -1 は立方体の外（断面を見せる）
            if (water) {
              if (nt === B.WATER || (nt > 0 && isSolidId(nt))) continue;
            } else if (nt > 0 && isSolidId(nt)) {
              continue;
            }
            this.emitFace(water ? W : S, t, f, x, y, z, waterTop);
          }
        }
      }
    }
    const chunk = { solid: this.makeMesh(S, this.solidMat, false), water: this.makeMesh(W, this.waterMat, true) };
    this.chunks.set(key, chunk);
  }

  emitFace(buf, t, f, x, y, z, lowerTop) {
    const [u0, v0, u1, v1] = tileUV(faceTile(t, f.key));
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const na = f.n[0] ? 0 : f.n[1] ? 1 : 2;
    const ta = [0, 1, 2].filter((a) => a !== na);
    const base = [x + f.n[0], y + f.n[1], z + f.n[2]];
    const ao = [];
    const start = buf.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const c = f.c[k];
      let vy = y + c[1];
      if (lowerTop && c[1] === 1) vy -= WATER_DROP;
      buf.pos.push(x + c[0], vy, z + c[2]);
      buf.nor.push(f.n[0], f.n[1], f.n[2]);
      buf.uv.push(uvs[k][0], uvs[k][1]);
      // 頂点のまわり 3 マスの詰まり具合で暗くする
      const s1 = [0, 0, 0], s2 = [0, 0, 0];
      s1[ta[0]] = c[ta[0]] ? 1 : -1;
      s2[ta[1]] = c[ta[1]] ? 1 : -1;
      const a = this.occludes(base[0] + s1[0], base[1] + s1[1], base[2] + s1[2]) ? 1 : 0;
      const b = this.occludes(base[0] + s2[0], base[1] + s2[1], base[2] + s2[2]) ? 1 : 0;
      const d = this.occludes(base[0] + s1[0] + s2[0], base[1] + s1[1] + s2[1], base[2] + s1[2] + s2[2]) ? 1 : 0;
      const level = a && b ? 0 : 3 - (a + b + d);
      ao.push(level);
      const shade = AO[level] * (f.n[1] === -1 ? 0.7 : 1);
      buf.col.push(shade, shade, shade);
    }
    // 陰影の境目がきれいに見えるほうの対角線で三角形に分ける
    if (ao[0] + ao[2] > ao[1] + ao[3]) buf.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    else buf.idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
  }

  makeMesh(buf, mat, water) {
    if (!buf.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    g.setIndex(buf.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    if (water) {
      m.renderOrder = 1;
    } else {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.group.add(m);
    return m;
  }
}
