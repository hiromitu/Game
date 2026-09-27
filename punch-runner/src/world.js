import * as THREE from 'three';
import { OBJECT_TYPES, buildObject, buildFloor, crackMaterial } from './objects.js';

// 当たり判定はすべて軸平行の箱（AABB）。
// floor: 壊れない地面の島 / object: 殴ると壊れるオブジェクト（支えを失うと落ちる）

export const GRAVITY = 26;
const XZ_EPS = 0.02;
const SUPPORT_EPS = 0.02;

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m?.userData.owned) m.dispose();
  });
}

export class World {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.boxes = [];
    this.objects = [];
    this.brokenCount = 0;
    this.silent = false;
    this.onBreak = null; // (obj, dir) => void
    this.onLand = null;  // (obj, impactSpeed) => void
  }

  clear() {
    disposeTree(this.root);
    this.root.clear();
    this.boxes = [];
    this.objects = [];
    this.brokenCount = 0;
  }

  addFloor(x0, z0, x1, z1, top = 0, theme = 'grass') {
    const depth = 4;
    const mesh = buildFloor(x1 - x0, depth, z1 - z0, theme);
    mesh.position.set((x0 + x1) / 2, top - depth, (z0 + z1) / 2);
    this.root.add(mesh);
    const box = {
      kind: 'floor', mesh,
      min: new THREE.Vector3(x0, top - depth, z0),
      max: new THREE.Vector3(x1, top, z1),
    };
    this.boxes.push(box);
    return box;
  }

  // y を省略すると、その場所で一番高い面の上に置く（積み上げが楽になる）
  addObject(typeKey, x, z, opts = {}) {
    const type = OBJECT_TYPES[typeKey];
    const [w, h, d] = opts.size ?? type.size;
    let y = opts.y;
    if (y === undefined) {
      const s = this.supportTop(x - w / 2, z - d / 2, x + w / 2, z + d / 2, Infinity);
      y = s === -Infinity ? 0 : s;
    }
    const mesh = buildObject(typeKey, w, h, d);
    mesh.position.set(x, y, z);
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.root.add(mesh);
    const obj = {
      kind: 'object', type, typeKey, mesh, size: [w, h, d],
      min: new THREE.Vector3(x - w / 2, y, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
      hp: type.hp, maxHp: type.hp,
      fixed: opts.fixed ?? !!type.fixed,
      resting: false, vy: 0,
      flash: 0, wobble: 0, fade: 1, fadeTarget: 1,
      mats: null, crack: 0, crackMesh: null, removed: false,
    };
    this.boxes.push(obj);
    this.objects.push(obj);
    return obj;
  }

  // 範囲 (x0..x1, z0..z1) の真下にある面のうち、maxY 以下で一番高いものの高さ
  supportTop(x0, z0, x1, z1, maxY, exclude = null) {
    return this.supportBox(x0, z0, x1, z1, maxY, exclude)?.max.y ?? -Infinity;
  }

  supportBox(x0, z0, x1, z1, maxY, exclude = null) {
    let best = null;
    for (const b of this.boxes) {
      if (b === exclude) continue;
      if (b.max.x <= x0 + XZ_EPS || b.min.x >= x1 - XZ_EPS || b.max.z <= z0 + XZ_EPS || b.min.z >= z1 - XZ_EPS) continue;
      if (b.max.y <= maxY + SUPPORT_EPS && (!best || b.max.y > best.max.y)) best = b;
    }
    return best;
  }

  // 点 (x, z) の真下で、高さ y 以下の一番高い面
  topBelow(x, z, y) {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      if (b.max.y <= y && b.max.y > best) best = b.max.y;
    }
    return best;
  }

  objectsIn(x0, y0, z0, x1, y1, z1) {
    const out = [];
    for (const o of this.objects) {
      if (o.max.x > x0 && o.min.x < x1 && o.max.y > y0 && o.min.y < y1 && o.max.z > z0 && o.min.z < z1) out.push(o);
    }
    return out;
  }

  // 殴られた。壊れたら true
  damage(obj, amount, dir) {
    if (obj.removed) return false;
    obj.hp -= amount;
    obj.flash = 1;
    obj.wobble = 1;
    if (obj.hp <= 0) {
      this.destroy(obj, dir);
      return true;
    }
    const ratio = obj.hp / obj.maxHp;
    const level = ratio <= 0.4 ? 2 : ratio <= 0.76 ? 1 : 0;
    if (!obj.type.noCrack && level > obj.crack) this.setCrack(obj, level);
    return false;
  }

  setCrack(obj, level) {
    obj.crack = level;
    const mat = crackMaterial(level);
    if (obj.crackMesh) {
      obj.crackMesh.material.dispose();
      obj.crackMesh.material = mat;
    } else {
      const [w, h, d] = obj.size;
      const g = new THREE.BoxGeometry(w + 0.02, h + 0.02, d + 0.02);
      g.translate(0, h / 2, 0);
      obj.crackMesh = new THREE.Mesh(g, mat);
      obj.crackMesh.userData.isCrack = true;
      obj.mesh.add(obj.crackMesh);
    }
  }

  destroy(obj, dir) {
    this.removeObject(obj);
    this.brokenCount++;
    this.onBreak?.(obj, dir);
  }

  removeObject(obj) {
    if (obj.removed) return;
    obj.removed = true;
    this.boxes.splice(this.boxes.indexOf(obj), 1);
    this.objects.splice(this.objects.indexOf(obj), 1);
    this.root.remove(obj.mesh);
    disposeTree(obj.mesh);
    this.wakeAll();
  }

  wakeAll() {
    for (const o of this.objects) if (!o.fixed) o.resting = false;
  }

  // 置いた直後に一度落ち着かせる（効果音なし）
  settle() {
    this.silent = true;
    this.wakeAll();
    for (let i = 0; i < 300 && this.objects.some((o) => !o.resting && !o.fixed); i++) this.update(1 / 60);
    this.silent = false;
  }

  moveObjectY(o, dy) {
    o.min.y += dy;
    o.max.y += dy;
    o.mesh.position.y += dy;
  }

  update(dt) {
    // 支えを失ったオブジェクトを落とす（下にあるものから順に）
    const awake = this.objects.filter((o) => !o.resting && !o.fixed).sort((a, b) => a.min.y - b.min.y);
    for (const o of awake) {
      if (o.removed) continue;
      const supBox = this.supportBox(o.min.x, o.min.z, o.max.x, o.max.z, o.min.y, o);
      const sup = supBox ? supBox.max.y : -Infinity;
      o.vy = Math.max(o.vy - GRAVITY * dt, -40);
      const ny = o.min.y + o.vy * dt;
      if (ny <= sup) {
        // 下の物がまだ落下中なら、一緒に落ち続ける
        const riding = supBox.kind === 'object' && !supBox.resting && !supBox.fixed;
        const impact = riding ? 0 : -o.vy;
        this.moveObjectY(o, sup - o.min.y);
        o.vy = riding ? supBox.vy : 0;
        o.resting = !riding;
        if (impact > 6 && !this.silent) this.onLand?.(o, impact);
      } else {
        this.moveObjectY(o, ny - o.min.y);
      }
      if (o.min.y < -40) this.removeObject(o);
    }

    // 見た目：殴られたときの白フラッシュ・揺れ、カメラとの間に入ったときの半透明
    const k = Math.min(1, dt * 10);
    for (const o of this.objects) {
      if (o.wobble > 0) {
        o.wobble = Math.max(0, o.wobble - dt * 4.5);
        const s = Math.sin((1 - o.wobble) * 22) * o.wobble * 0.08;
        o.mesh.scale.set(1 + s, 1 - s, 1 + s);
      }
      if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 6);
      o.fade += (o.fadeTarget - o.fade) * k;
      if (Math.abs(o.fade - 1) < 0.005) o.fade = 1;
      if (o.mats || o.flash > 0 || o.fade < 1) this.applyMaterialState(o);
    }
  }

  // 共有マテリアルを使っているので、変化させるときだけ個別に複製する
  applyMaterialState(o) {
    if (!o.mats) {
      o.mats = [];
      o.mesh.traverse((m) => {
        if (!m.isMesh || m.userData.isCrack) return;
        const clone = (src) => {
          const c = src.clone();
          c.userData.owned = true;
          c.userData.baseOpacity = src.opacity;
          c.userData.baseTransparent = src.transparent;
          if (c.emissive) c.userData.baseEmissive = c.emissive.clone();
          o.mats.push(c);
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
      });
    }
    const all = o.crackMesh ? [...o.mats, o.crackMesh.material] : o.mats;
    const faded = o.fade < 0.999;
    for (const c of all) {
      if (c.emissive && c.userData.baseEmissive) {
        const f = o.flash * 0.75;
        const b = c.userData.baseEmissive;
        c.emissive.setRGB(b.r + f, b.g + f * 0.92, b.b + f * 0.75);
      }
      const transparent = faded || c.userData.baseTransparent;
      if (c.transparent !== transparent) {
        c.transparent = transparent;
        c.needsUpdate = true;
      }
      c.opacity = (c.userData.baseOpacity ?? 1) * o.fade;
      c.depthWrite = !faded && !c.userData.baseTransparent;
    }
    if (o.crackMesh) o.crackMesh.material.depthWrite = false;
  }
}
