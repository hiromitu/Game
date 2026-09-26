import * as THREE from 'three';
import { TANK, sandHeight, makeRng } from './config.js';
import { flowAt } from './shaders.js';
import { obstacles } from './terrain.js';
import { createFishMesh } from './fishModels.js';

const V = THREE.Vector3;
const clamp = THREE.MathUtils.clamp;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 泳げる範囲（奥は岩と砂の斜面なので、それらは障害物と底床として避ける）
const ZONE = {
  minX: TANK.minX + 0.4, maxX: TANK.maxX - 0.4,
  minZ: TANK.minZ + 0.7, maxZ: TANK.maxZ - 0.3,
  top: TANK.waterY - 0.12,
};

const rng = makeRng(2024);

function randomPoint(yMin, yMax, zMin = -1.0, zMax = 1.9, xMin = -5.0, xMax = 5.0) {
  for (let i = 0; i < 30; i++) {
    const p = new V(rng.range(xMin, xMax), 0, rng.range(zMin, zMax));
    const floor = sandHeight(p.x, p.z);
    p.y = rng.range(Math.max(yMin, floor + 0.4), yMax);
    if (!insideAny(p, 0.25)) return p;
  }
  return new V(0, 3, 0.8);
}

function insideAny(p, margin) {
  for (const o of obstacles) {
    const dx = (p.x - o.center.x) / (o.radius.x + margin);
    const dy = (p.y - o.center.y) / (o.radius.y + margin);
    const dz = (p.z - o.center.z) / (o.radius.z + margin);
    if (dx * dx + dy * dy + dz * dz < 1) return true;
  }
  return false;
}

const SPECIES = {
  neon: { cruise: 0.7, max: 1.35, min: 0.2, force: 2.8, freq: 2.5, freqK: 5, amp: 0.1, waveK: 5.5, turn: 9, maxPitch: 0.5, floorClear: 0.45, drift: 0.12 },
  angel: { cruise: 0.38, max: 1.1, min: 0, force: 0.7, freq: 0.9, freqK: 2, amp: 0.06, waveK: 4, turn: 3, maxPitch: 0.22, floorClear: 0.9, drift: 0.05 },
  guppy: { cruise: 0.75, max: 2.6, min: 0, force: 5, freq: 3, freqK: 5, amp: 0.13, waveK: 6, turn: 11, maxPitch: 0.6, floorClear: 0.5, drift: 0.12 },
  cory: { cruise: 0.3, max: 1.7, min: 0, force: 2.5, freq: 2, freqK: 5, amp: 0.1, waveK: 4.5, turn: 6, maxPitch: 1.3, floorClear: 0.08, drift: 0.04 },
};

class Fish {
  constructor(kind, meshKind, variant, spec, scene, opts = {}) {
    this.kind = kind;
    this.spec = spec;
    const { group, uniforms, length } = createFishMesh(meshKind, variant, { waveK: spec.waveK, ...opts });
    this.mesh = group;
    this.u = uniforms;
    this.length = length;
    const s = opts.scale ?? rng.range(0.9, 1.1);
    this.mesh.scale.setScalar(s);
    scene.add(this.mesh);
    this.pos = new V();
    this.vel = new V(rng.range(-1, 1), 0, rng.range(-0.3, 0.3)).setLength(spec.cruise);
    this.yaw = Math.atan2(-this.vel.z, this.vel.x);
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.bend = 0;
    this.ampBoost = 1;
    this.pitchOverride = null;
    this.maxSpeed = spec.max;
    this.state = 'idle';
    this.timer = rng.range(0, 3);
    this.target = new V();
    this.acc = new V();
    this.tmp = new V();
    this.flow = new V();
  }

  seek(target, speed, weight = 1, arrive = 0.6) {
    const d = this.tmp.subVectors(target, this.pos);
    const dist = d.length();
    if (dist < 1e-4) return;
    const s = speed * Math.min(1, dist / arrive);
    d.multiplyScalar(s / dist).sub(this.vel).multiplyScalar(weight * 2);
    this.acc.add(d);
  }

  brake(weight = 1) {
    this.acc.addScaledVector(this.vel, -2 * weight);
  }

  // 壁・水面・底床・岩を先読みして避ける
  avoid() {
    const look = this.tmp.copy(this.pos).addScaledVector(this.vel, 0.45);
    const k = this.spec.force * 2.2;
    const m = 0.5;
    if (look.x < ZONE.minX + m) this.acc.x += k * (ZONE.minX + m - look.x) / m;
    if (look.x > ZONE.maxX - m) this.acc.x -= k * (look.x - ZONE.maxX + m) / m;
    if (look.z < ZONE.minZ + m) this.acc.z += k * (ZONE.minZ + m - look.z) / m;
    if (look.z > ZONE.maxZ - m) this.acc.z -= k * (look.z - ZONE.maxZ + m) / m;
    // 水面へ向かう行動中は上端の回避を切る（位置は integrate でクランプする）
    if (!this.surfaceOK && look.y > ZONE.top - 0.15) this.acc.y -= k * (look.y - ZONE.top + 0.15) / 0.15;
    const floor = sandHeight(look.x, look.z) + this.spec.floorClear;
    if (look.y < floor + 0.2) this.acc.y += k * (floor + 0.2 - look.y) / 0.2;

    const r = this.length * 0.5;
    for (const o of obstacles) {
      const dx = (look.x - o.center.x) / (o.radius.x + r);
      const dy = (look.y - o.center.y) / (o.radius.y + r);
      const dz = (look.z - o.center.z) / (o.radius.z + r);
      const q2 = dx * dx + dy * dy + dz * dz;
      if (q2 > 1.69) continue;
      const q = Math.sqrt(q2) + 1e-4;
      const push = (1.3 - q) / 0.3;
      const n = new V(dx / (o.radius.x + r), dy / (o.radius.y + r), dz / (o.radius.z + r)).normalize();
      // 真っ直ぐ突っ込むと止まってしまうので、少し横へ流す
      const side = new V(-n.z, 0, n.x).multiplyScalar(Math.sign(this.vel.dot(new V(-n.z, 0, n.x)) || 1) * 0.4);
      this.acc.addScaledVector(n.add(side), k * push);
    }
  }

  integrate(dt, world) {
    this.avoid();
    const maxF = this.spec.force * (this.forceBoost ?? 1);
    if (this.acc.length() > maxF * 3) this.acc.setLength(maxF * 3);
    this.vel.addScaledVector(this.acc, dt);
    const sp = this.vel.length();
    if (sp > this.maxSpeed) this.vel.multiplyScalar(this.maxSpeed / sp);
    else if (sp < this.spec.min && sp > 1e-5) this.vel.multiplyScalar(this.spec.min / sp);
    this.pos.addScaledVector(this.vel, dt);
    flowAt(this.pos, world.time, world.pump, this.flow);
    this.pos.addScaledVector(this.flow, this.spec.drift * dt);

    // 念のため水槽の外に出ないようにする
    this.pos.x = clamp(this.pos.x, TANK.minX + 0.15, TANK.maxX - 0.15);
    this.pos.z = clamp(this.pos.z, TANK.minZ + 0.3, TANK.maxZ - 0.12);
    const floor = sandHeight(this.pos.x, this.pos.z) + Math.min(this.spec.floorClear, 0.12);
    this.pos.y = clamp(this.pos.y, floor, ZONE.top);
    this.acc.set(0, 0, 0);
    this.animate(dt);
  }

  animate(dt) {
    const v = this.vel;
    const sp = v.length();
    let pitchT = 0;
    if (sp > 0.03) {
      const yawT = Math.atan2(-v.z, v.x);
      const k = 1 - Math.exp(-dt * this.spec.turn * Math.min(1, sp / 0.2));
      const step = wrapAngle(yawT - this.yaw) * k;
      this.yaw = wrapAngle(this.yaw + step);
      this.yawRate += (step / Math.max(dt, 1e-4) - this.yawRate) * Math.min(1, dt * 8);
      pitchT = clamp(Math.asin(clamp(v.y / sp, -1, 1)), -this.spec.maxPitch, this.spec.maxPitch);
    } else {
      this.yawRate *= Math.exp(-dt * 4);
    }
    if (this.pitchOverride !== null) pitchT = this.pitchOverride;
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 4);
    const rollT = clamp(-this.yawRate * 0.1, -0.45, 0.45);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 5);
    const bendT = clamp(-this.yawRate * 0.12, -0.5, 0.5);
    this.bend += (bendT - this.bend) * Math.min(1, dt * 6);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.roll, this.yaw, this.pitch, 'YZX');

    const rel = Math.min(1.6, sp / this.spec.cruise);
    const freq = this.spec.freq + sp * this.spec.freqK + Math.abs(this.yawRate) * 0.8;
    this.u.uPhase.value += dt * Math.PI * 2 * freq;
    const amp = this.spec.amp * (0.3 + 0.7 * Math.min(rel, 1.2) + Math.min(Math.abs(this.yawRate) * 0.15, 0.4)) * this.ampBoost;
    this.u.uAmp.value += (amp - this.u.uAmp.value) * Math.min(1, dt * 6);
    this.u.uBend.value = this.bend;
  }
}

// ネオンテトラ：群れで泳ぎ（ボイド）、エンゼルフィッシュが近づくと散る
class Neon extends Fish {
  update(dt, world) {
    const sep = new V(), ali = new V(), coh = new V();
    let n = 0;
    for (const o of world.neons) {
      if (o === this) continue;
      const d = this.tmp.subVectors(this.pos, o.pos);
      const dist = d.length();
      if (dist > 1.1) continue;
      n++;
      ali.add(o.vel);
      coh.add(o.pos);
      if (dist < 0.3) sep.addScaledVector(d, (0.3 - dist) / (dist * 0.3 + 1e-3));
    }
    if (n > 0) {
      ali.divideScalar(n).sub(this.vel).multiplyScalar(1.1);
      coh.divideScalar(n).sub(this.pos).multiplyScalar(0.9);
      this.acc.add(ali).add(coh);
    }
    this.acc.addScaledVector(sep, 3.2);
    this.seek(world.neonGoal, this.spec.cruise, 0.35, 2);

    let fear = 0;
    this.maxSpeed = this.spec.max;
    for (const a of world.angels) {
      const d = this.tmp.subVectors(this.pos, a.pos);
      const dist = d.length();
      if (dist < 1.3) {
        fear = Math.max(fear, 1 - dist / 1.3);
        this.acc.addScaledVector(d.normalize(), 6 * (1 - dist / 1.3));
      }
    }
    if (fear > 0) this.maxSpeed = this.spec.max * 1.8;
    this.forceBoost = 1 + fear * 2;
    // 常に少しは前へ泳ぐ
    if (this.vel.lengthSq() < this.spec.cruise ** 2 * 0.5) this.acc.addScaledVector(this.vel.clone().normalize(), 0.8);
    this.integrate(dt, world);
  }
}

// エンゼルフィッシュ：ゆったり移動しては水草の間で長く静止する。ときどき小魚を追い払う
class Angel extends Fish {
  update(dt, world) {
    this.timer -= dt;
    this.maxSpeed = this.spec.max;
    this.ampBoost = 1;
    this.forceBoost = 1;
    switch (this.state) {
      case 'idle':
      case 'hover':
        this.brake(0.8);
        // 静止中も胸びれで姿勢を保つように、尾をゆっくり動かす
        this.ampBoost = 1.6;
        if (this.timer <= 0) {
          if (rng() < 0.18 && world.neons.length) {
            this.state = 'chase';
            this.chaseTarget = world.neons[Math.floor(rng() * world.neons.length)];
            this.timer = rng.range(1.2, 2.2);
          } else {
            this.state = 'glide';
            this.target.copy(randomPoint(2.4, 4.9, -0.9, 1.7));
            this.timer = 12;
          }
        }
        break;
      case 'glide':
        this.seek(this.target, this.spec.cruise, 1, 1.2);
        if (this.pos.distanceTo(this.target) < 0.35 || this.timer <= 0) {
          this.state = 'hover';
          this.timer = rng.range(2.5, 7);
        }
        break;
      case 'chase':
        this.maxSpeed = 1.1;
        this.forceBoost = 2.5;
        this.seek(this.chaseTarget.pos, 1.0, 1, 0.1);
        if (this.timer <= 0) {
          this.state = 'hover';
          this.timer = rng.range(2, 4);
        }
        break;
    }
    // 仲間とは距離を取る
    for (const o of world.angels) {
      if (o === this) continue;
      const d = this.tmp.subVectors(this.pos, o.pos);
      const dist = d.length();
      if (dist < 1.0) this.acc.addScaledVector(d.normalize(), (1 - dist) * 1.5);
    }
    this.integrate(dt, world);
  }
}

// グッピー：水面近くをせわしなく泳ぎ、急発進したり水面をついばんだりする。
// オスはメスを追いかけて体をくねらせる求愛ディスプレイをする
class Guppy extends Fish {
  constructor(...args) {
    super(...args);
    this.heading = new V(1, 0, 0);
    this.female = false;
  }

  update(dt, world) {
    this.timer -= dt;
    this.maxSpeed = this.spec.cruise * 1.5;
    this.ampBoost = 1;
    this.forceBoost = 1;
    this.pitchOverride = null;
    this.surfaceOK = this.state === 'peck';
    switch (this.state) {
      case 'idle':
      case 'cruise': {
        const h = this.heading;
        this.target.copy(this.pos).addScaledVector(h, 1.2);
        this.target.y = THREE.MathUtils.lerp(this.target.y, this.prefY ?? 4.8, 0.5);
        this.seek(this.target, this.spec.cruise, 1, 0.3);
        if (this.timer <= 0) this.nextAction(world);
        break;
      }
      case 'dart':
        this.maxSpeed = this.spec.max;
        this.forceBoost = 4;
        this.acc.addScaledVector(this.heading, 14);
        if (this.timer <= 0) { this.state = 'pause'; this.timer = rng.range(0.3, 1.0); }
        break;
      case 'pause':
        this.brake(1.5);
        if (this.timer <= 0) this.nextAction(world);
        break;
      case 'peck':
        this.seek(this.target, 0.5, 1, 0.2);
        if (this.pos.distanceTo(this.target) < 0.15) {
          this.brake(3);
          this.pitchOverride = 0.5;
          if (this.timer > 0.8) this.timer = 0.8;
        }
        if (this.timer <= 0) { this.state = 'dart'; this.heading.set(rng.range(-1, 1), -0.4, rng.range(-1, 1)).normalize(); this.timer = 0.25; }
        break;
      case 'court': {
        const f = this.mate;
        const side = new V(-f.vel.z, 0, f.vel.x);
        if (side.lengthSq() < 1e-4) side.set(0, 0, 1);
        side.normalize().multiplyScalar(0.18);
        this.target.copy(f.pos).add(side).addScaledVector(f.vel, 0.1);
        this.maxSpeed = this.spec.max * 0.8;
        this.forceBoost = 2;
        this.seek(this.target, 1.4, 1, 0.3);
        this.ampBoost = 2.4;
        if (this.timer <= 0) this.nextAction(world);
        break;
      }
    }
    this.integrate(dt, world);
  }

  nextAction(world) {
    const r = rng();
    const females = world.guppies.filter((g) => g.female);
    if (!this.female && r < 0.2 && females.length) {
      this.state = 'court';
      this.mate = females[Math.floor(rng() * females.length)];
      this.timer = rng.range(2.5, 5);
    } else if (r < 0.4) {
      this.state = 'dart';
      this.heading.set(rng.range(-1, 1), rng.range(-0.3, 0.3), rng.range(-1, 1)).normalize();
      this.timer = rng.range(0.2, 0.4);
    } else if (r < 0.52) {
      this.state = 'peck';
      this.target.set(this.pos.x + rng.range(-0.5, 0.5), ZONE.top - 0.02, clamp(this.pos.z + rng.range(-0.5, 0.5), -0.8, 2.0));
      this.timer = 3;
    } else {
      this.state = 'cruise';
      const turn = rng.range(-1.1, 1.1);
      const c = Math.cos(turn), s = Math.sin(turn);
      const h = this.heading;
      h.set(h.x * c - h.z * s, 0, h.x * s + h.z * c).normalize();
      this.prefY = rng.range(3.6, 5.3);
      this.timer = rng.range(0.5, 1.6);
    }
  }
}

// コリドラス：底砂の上をひげで探りながら移動し、時々休む。
// まれに水面まで一気に泳ぎ上がって空気を吸い、また底へ戻る
class Cory extends Fish {
  update(dt, world) {
    this.timer -= dt;
    this.maxSpeed = this.spec.cruise * 1.4;
    this.forceBoost = 1;
    this.ampBoost = 1;
    this.pitchOverride = null;
    const floor = sandHeight(this.pos.x, this.pos.z) + 0.13;
    const onBottom = this.state !== 'surface' && this.state !== 'descend';
    this.surfaceOK = this.state === 'surface';
    switch (this.state) {
      case 'idle':
      case 'forage':
        this.target.y = sandHeight(this.target.x, this.target.z) + 0.13;
        this.seek(this.target, this.spec.cruise, 1, 0.3);
        this.pitchOverride = -0.3;
        if (this.pos.distanceTo(this.target) < 0.15 || this.timer <= 0) {
          this.state = 'root';
          this.timer = rng.range(1.5, 4);
        }
        break;
      case 'root':
        // 頭を下げて砂を探る
        this.brake(2);
        this.pitchOverride = -0.45 + Math.sin(world.time * 9 + this.u.uPhase.value * 0.1) * 0.08;
        this.ampBoost = 0.9;
        this.acc.x += Math.sin(world.time * 7 + this.pos.z * 10) * 0.2;
        if (this.timer <= 0) this.nextAction(world);
        break;
      case 'rest':
        this.brake(3);
        this.ampBoost = 0.3;
        this.pitchOverride = -0.1;
        if (this.timer <= 0) this.nextAction(world);
        break;
      case 'surface':
        this.maxSpeed = this.spec.max;
        this.forceBoost = 3;
        this.acc.set(0, 0, 0);
        this.seek(this.target, this.spec.max, 1, 0.3);
        this.pitchOverride = 1.25;
        this.ampBoost = 1.6;
        if (this.pos.y > ZONE.top - 0.12 || this.timer <= 0) {
          this.state = 'descend';
          this.target.copy(randomBottomPoint(this.pos, 1.5));
          this.timer = 6;
        }
        break;
      case 'descend':
        this.maxSpeed = this.spec.max * 0.8;
        this.forceBoost = 2.5;
        this.seek(this.target, this.spec.max * 0.8, 1, 0.5);
        this.pitchOverride = -1.1;
        if (this.pos.y < floor + 0.25 || this.timer <= 0) {
          this.state = 'root';
          this.timer = rng.range(1, 2);
        }
        break;
    }
    if (onBottom) {
      // 底に張り付く
      this.acc.y += (floor - this.pos.y) * 20 - this.vel.y * 4;
      for (const o of world.corys) {
        if (o === this) continue;
        const d = this.tmp.subVectors(this.pos, o.pos);
        const dist = d.length();
        if (dist < 0.35) this.acc.addScaledVector(d.normalize(), (0.35 - dist) * 6);
      }
    }
    this.integrate(dt, world);
    if (onBottom && this.pos.y < floor) this.pos.y = floor;
  }

  nextAction(world) {
    const r = rng();
    if (r < 0.07) {
      this.state = 'surface';
      this.target.set(this.pos.x + rng.range(-0.4, 0.4), ZONE.top, clamp(this.pos.z + 0.4, -0.5, 2.0));
      this.timer = 8;
    } else if (r < 0.25) {
      this.state = 'rest';
      this.timer = rng.range(2.5, 6);
    } else {
      this.state = 'forage';
      // 仲間の近くを探す（ゆるい群れ）
      const c = new V();
      for (const o of world.corys) c.add(o.pos);
      c.divideScalar(world.corys.length);
      const base = rng() < 0.5 ? c : this.pos;
      this.target.copy(randomBottomPoint(base, 1.1));
      this.timer = 10;
    }
  }
}

function randomBottomPoint(around, radius) {
  for (let i = 0; i < 30; i++) {
    const x = clamp(around.x + rng.range(-radius, radius), ZONE.minX + 0.2, ZONE.maxX - 0.2);
    const z = clamp(around.z + rng.range(-radius, radius), -0.6, ZONE.maxZ - 0.2);
    const p = new V(x, sandHeight(x, z) + 0.13, z);
    if (!insideAny(p, 0.15)) return p;
  }
  return new V(0, sandHeight(0, 1.5) + 0.13, 1.5);
}

export class FishTank {
  constructor(scene) {
    this.scene = scene;
    this.neons = [];
    this.angels = [];
    this.guppies = [];
    this.corys = [];
    this.neonGoal = new V(0, 3.2, 0.5);
    this.goalTimer = 0;
    this.time = 0;
    this.pump = 1;

    for (let i = 0; i < 26; i++) {
      const f = new Neon('neon', 'neon', 0, SPECIES.neon, scene, { roughness: 0.3, metalness: 0.35, finOpacity: 0.45 });
      f.pos.copy(this.neonGoal).add(new V(rng.range(-0.8, 0.8), rng.range(-0.4, 0.4), rng.range(-0.5, 0.5)));
      this.neons.push(f);
    }
    for (let i = 0; i < 3; i++) {
      const f = new Angel('angel', 'angel', 0, SPECIES.angel, scene, { roughness: 0.3, metalness: 0.3, finOpacity: 0.6, scale: rng.range(0.9, 1.15) });
      f.pos.copy(randomPoint(2.6, 4.6, -0.6, 1.5));
      f.timer = rng.range(0.5, 3);
      this.angels.push(f);
    }
    for (let i = 0; i < 9; i++) {
      const female = i >= 6;
      const f = new Guppy('guppy', female ? 'guppyF' : 'guppyM', i % 5, SPECIES.guppy, scene, { finOpacity: female ? 0.5 : 0.85 });
      f.female = female;
      f.pos.copy(randomPoint(4.0, 5.2, -0.5, 1.8));
      f.heading.set(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize();
      this.guppies.push(f);
    }
    for (let i = 0; i < 6; i++) {
      const panda = i % 2 === 0;
      const f = new Cory('cory', panda ? 'coryPanda' : 'coryBronze', 0, SPECIES.cory, scene, { roughness: 0.4, metalness: panda ? 0.1 : 0.35, finOpacity: 0.6 });
      f.pos.copy(randomBottomPoint(new V(rng.range(-2, 2), 0, 1.2), 1.0));
      f.target.copy(randomBottomPoint(f.pos, 1));
      f.state = 'forage';
      this.corys.push(f);
    }
    this.all = [...this.neons, ...this.angels, ...this.guppies, ...this.corys];
  }

  update(dt, time, pump) {
    this.time = time;
    this.pump = pump;
    this.goalTimer -= dt;
    if (this.goalTimer <= 0) {
      this.neonGoal.copy(randomPoint(2.0, 4.4, -0.6, 1.8, -4.6, 4.6));
      this.goalTimer = rng.range(6, 11);
    }
    for (const f of this.all) f.update(dt, this);
  }
}
