import * as THREE from 'three';
import { GRAVITY } from './world.js';

// 自キャラ：歩く・走る・ジャンプ・パンチ・よじ登り。
// 当たり判定は足元中心の AABB（幅 HW*2、高さ HEIGHT）。

const HW = 0.32;
const HEIGHT = 1.8;
const STEP = 0.45;          // 自動で乗り越える段差
const WALK = 4.5;
const RUN = 8.0;
const JUMP_V = 8.4;          // 最高到達 約 1.36m
const CLIMB_SPEED = 3.0;
const CLIMB_LATERAL = 1.8;
const MANTLE_REACH = 1.3;    // 足元からこの高さまでの縁なら上に乗り上がる
const EPS = 1e-3;
const CORNER_SLIDE = 0.12;  // この幅以下の引っかかりは横へ逃がす
const PUNCH_TIME = 0.3;
const PUNCH_HIT_AT = 0.085;
const PUNCH_CHAIN_AT = 0.2;  // この時点以降なら次のパンチを出せる

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function buildModel() {
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
  const skin = mat(0xf1c7a0), shirt = mat(0x2f7fd8), pants = mat(0x2b2f3d), glove = mat(0xe23b3b, { roughness: 0.45 });
  const shoe = mat(0x1f1f24), band = mat(0xe23b3b), eye = mat(0x1a1a1a), belt = mat(0x1e1e22), hair = mat(0x3b2a20);
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.74;
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(box(0.56, 0.56, 0.34, shirt, 0, 0.3, 0));
  torso.add(box(0.58, 0.09, 0.36, belt, 0, 0.04, 0));
  torso.add(box(0.18, 0.18, 0.02, mat(0xffd166), 0, 0.34, 0.175));

  const head = new THREE.Group();
  head.position.y = 0.58;
  torso.add(head);
  head.add(box(0.5, 0.48, 0.48, skin, 0, 0.24, 0));
  head.add(box(0.52, 0.12, 0.5, hair, 0, 0.44, -0.01));
  head.add(box(0.53, 0.08, 0.51, band, 0, 0.35, 0));
  for (const s of [-1, 1]) {
    head.add(box(0.07, 0.11, 0.02, eye, s * 0.11, 0.22, 0.245));
    const tail = box(0.06, 0.05, 0.26, band, s * 0.07, 0.33, -0.36);
    tail.rotation.set(0.35, s * 0.3, 0);
    head.add(tail);
  }

  const arm = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.37, 0.5, 0);
    g.add(box(0.18, 0.2, 0.18, shirt, 0, -0.08, 0));
    g.add(box(0.15, 0.24, 0.15, skin, 0, -0.28, 0));
    const fist = box(0.25, 0.25, 0.27, glove, 0, -0.46, 0);
    g.add(fist);
    g.userData.fist = fist;
    torso.add(g);
    return g;
  };
  const leg = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.14, 0, 0);
    g.add(box(0.21, 0.58, 0.23, pants, 0, -0.3, 0));
    g.add(box(0.24, 0.15, 0.32, shoe, 0, -0.665, 0.04));
    hips.add(g);
    return g;
  };

  return { root, hips, torso, head, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1) };
}

export class Player {
  constructor(scene, world, hooks = {}) {
    this.world = world;
    this.hooks = hooks;
    this.model = buildModel();
    scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.contacts = [];
    this.moveDir = { x: 0, z: 0, len: 0 };
    this.pose = { aLx: 0, aLz: 0, aRx: 0, aRz: 0, lLx: 0, lRx: 0, lean: 0, bob: 0, twist: 0, headX: 0 };
    this.reset(new THREE.Vector3());
  }

  reset(p) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.state = 'air';
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.punchBuffer = 0;
    this.punchT = -1;
    this.punchArm = 0;
    this.punchDash = false;
    this.pushTimer = 0;
    this.regrab = 0;
    this.running = false;
    this.facing = Math.PI; // -Z 向き（奥へ進む）
    this.phase = 0;
    this.climbPhase = 0;
    this.t = 0;
    this.wall = null;
    this.mantle = null;
    this.animate(0, true);
  }

  get forward() {
    return { x: Math.sin(this.facing), z: Math.cos(this.facing) };
  }

  update(dt, input, camYaw) {
    this.jumpBuffer = input.jumpPressed ? 0.13 : Math.max(0, this.jumpBuffer - dt);
    this.punchBuffer = input.punchPressed ? 0.18 : Math.max(0, this.punchBuffer - dt);
    this.regrab = Math.max(0, this.regrab - dt);

    // 入力をカメラの向き基準のワールド方向へ
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let mx = rx * input.x + fx * input.y;
    let mz = rz * input.x + fz * input.y;
    let ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; ml = 1; }
    this.moveDir.x = mx; this.moveDir.z = mz; this.moveDir.len = ml;

    if (this.state === 'win') this.updateWin(dt, camYaw);
    else if (this.state === 'mantle') this.updateMantle(dt);
    else if (this.state === 'climb') this.updateClimb(dt);
    else this.updateMove(dt, input);

    this.updatePunch(dt);
    this.animate(dt);
  }

  // ---------- 地上・空中 ----------
  updateMove(dt, input) {
    const md = this.moveDir;
    const wasGrounded = this.grounded;
    this.running = input.run && md.len > 0.1;
    let speed = this.running ? RUN : WALK;
    if (this.punchT >= 0 && this.grounded && !this.punchDash) speed *= 0.3;
    const acc = (this.grounded ? 60 : 16) * dt;
    this.vel.x += clamp(md.x * speed - this.vel.x, -acc, acc);
    this.vel.z += clamp(md.z * speed - this.vel.z, -acc, acc);

    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = JUMP_V;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.jumpCut = true;
      this.hooks.onJump?.();
    }
    // ボタンを早く離すと低いジャンプ
    if (this.jumpCut && !input.jumpHeld && this.vel.y > 2) { this.vel.y *= 0.5; this.jumpCut = false; }
    if (this.vel.y <= 0) this.jumpCut = false;

    this.contacts.length = 0;
    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -32);
    const fallSpeed = -this.vel.y;
    this.moveVertical(this.vel.y * dt);
    this.depenetrate();
    if (this.grounded && !wasGrounded && fallSpeed > 5) this.hooks.onLand?.(fallSpeed);
    this.state = this.grounded ? 'ground' : 'air';

    this.tryStartClimb(dt);
    if (this.state !== 'climb' && md.len > 0.1 && this.punchT < 0) this.turnToward(Math.atan2(md.x, md.z), dt, 14);
  }

  overlaps(b, x = this.pos.x, y = this.pos.y, z = this.pos.z) {
    return x - HW < b.max.x && x + HW > b.min.x && z - HW < b.max.z && z + HW > b.min.z
      && y < b.max.y - 1e-4 && y + HEIGHT > b.min.y + 1e-4;
  }

  fitsAt(x, y, z) {
    for (const b of this.world.boxes) if (this.overlaps(b, x, y, z)) return false;
    return true;
  }

  moveAxis(axis, d) {
    if (d === 0) return;
    this.pos[axis] += d;
    for (const b of this.world.boxes) {
      if (!this.overlaps(b)) continue;
      const rise = b.max.y - this.pos.y;
      if (this.grounded && rise > 0 && rise <= STEP && this.fitsAt(this.pos.x, b.max.y, this.pos.z)) {
        this.pos.y = b.max.y;
        continue;
      }
      // 角にわずかに引っかかっただけなら横へずらして回り込む
      const side = axis === 'x' ? 'z' : 'x';
      const pushNeg = this.pos[side] + HW - b.min[side], pushPos = b.max[side] - (this.pos[side] - HW);
      const slide = pushNeg < pushPos ? -(pushNeg + EPS) : pushPos + EPS;
      if (Math.abs(slide) < CORNER_SLIDE && this.state !== 'climb') {
        const at = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
        at[side] += slide;
        if (this.fitsAt(at.x, at.y, at.z)) { this.pos[side] = at[side]; continue; }
      }
      this.pos[axis] = d > 0 ? b.min[axis] - HW - EPS : b.max[axis] + HW + EPS;
      this.vel[axis] = 0;
      this.contacts.push({ box: b, axis, sign: d > 0 ? -1 : 1 });
    }
  }

  moveVertical(dy) {
    const prevY = this.pos.y;
    this.pos.y += dy;
    this.grounded = false;
    let landTop = -Infinity, ceil = Infinity;
    for (const b of this.world.boxes) {
      if (!(this.pos.x - HW < b.max.x && this.pos.x + HW > b.min.x && this.pos.z - HW < b.max.z && this.pos.z + HW > b.min.z)) continue;
      if (dy <= 0) {
        if (prevY + EPS >= b.max.y && this.pos.y <= b.max.y && b.max.y > landTop) landTop = b.max.y;
      } else if (prevY + HEIGHT <= b.min.y + EPS && this.pos.y + HEIGHT > b.min.y && this.pos.y < b.max.y) {
        ceil = Math.min(ceil, b.min.y);
      }
    }
    if (landTop > -Infinity) {
      this.pos.y = landTop;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    }
    if (ceil < Infinity) {
      this.pos.y = ceil - HEIGHT;
      if (this.vel.y > 0) this.vel.y = 0;
    }
  }

  // 落ちてきたオブジェクトなどにめり込んだら押し出す
  depenetrate() {
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.world.boxes) {
        if (!this.overlaps(b)) continue;
        const up = b.max.y - this.pos.y;
        if (up <= 0.6 && this.fitsAt(this.pos.x, b.max.y, this.pos.z)) {
          this.pos.y = b.max.y;
          this.vel.y = Math.max(0, this.vel.y);
          this.grounded = true;
          continue;
        }
        const px1 = b.max.x - (this.pos.x - HW), px2 = this.pos.x + HW - b.min.x;
        const pz1 = b.max.z - (this.pos.z - HW), pz2 = this.pos.z + HW - b.min.z;
        const m = Math.min(px1, px2, pz1, pz2);
        if (m === px1) this.pos.x += px1 + EPS;
        else if (m === px2) this.pos.x -= px2 + EPS;
        else if (m === pz1) this.pos.z += pz1 + EPS;
        else this.pos.z -= pz2 + EPS;
      }
    }
  }

  turnToward(target, dt, rate) {
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * rate);
  }

  // ---------- よじ登り ----------
  // 壁（オブジェクトの側面）に向かって押し続けると張り付く。空中なら即座に掴む
  tryStartClimb(dt) {
    const md = this.moveDir;
    if (this.regrab > 0 || this.punchT >= 0 || md.len < 0.5) { this.pushTimer = 0; return; }
    let hit = null;
    for (const c of this.contacts) {
      if (c.box.kind !== 'object') continue;
      const nx = c.axis === 'x' ? c.sign : 0, nz = c.axis === 'z' ? c.sign : 0;
      const into = -(md.x * nx + md.z * nz) / md.len;
      if (into > 0.7 && c.box.max.y > this.pos.y + STEP) { hit = { x: nx, z: nz }; break; }
    }
    if (!hit) { this.pushTimer = 0; return; }
    this.pushTimer += dt;
    if (this.pushTimer < (this.grounded ? 0.22 : 0)) return;
    // 掴める壁が正面にあるか確かめてから張り付く
    this.wall = hit;
    if (this.probeWall()) this.startClimb(hit);
    else this.pushTimer = 0;
  }

  startClimb(normal) {
    this.state = 'climb';
    this.wall = normal;
    this.vel.set(0, 0, 0);
    this.facing = Math.atan2(-normal.x, -normal.z);
    this.pushTimer = 0;
    this.grounded = false;
    this.hooks.onGrab?.();
  }

  // 目の前の壁の、足元から連続して積み上がっている部分の上端を調べる
  probeWall() {
    const { x: nx, z: nz } = this.wall;
    const D = 0.15, T = HW * 0.8;
    let x0, x1, z0, z1;
    if (nx !== 0) {
      const face = this.pos.x - nx * HW;
      x0 = Math.min(face, face - nx * D); x1 = Math.max(face, face - nx * D);
      z0 = this.pos.z - T; z1 = this.pos.z + T;
    } else {
      const face = this.pos.z - nz * HW;
      z0 = Math.min(face, face - nz * D); z1 = Math.max(face, face - nz * D);
      x0 = this.pos.x - T; x1 = this.pos.x + T;
    }
    const list = [];
    for (const b of this.world.objects) {
      if (b.max.x > x0 && b.min.x < x1 && b.max.z > z0 && b.min.z < z1 && b.max.y > this.pos.y + 0.02) list.push(b);
    }
    if (!list.length) return null;
    list.sort((a, b) => a.min.y - b.min.y);
    if (list[0].min.y > this.pos.y + 1.6) return null;
    let top = list[0].max.y, box = list[0];
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      if (b.min.y > top + 0.05) break;
      if (b.max.y > top) { top = b.max.y; box = b; }
    }
    return { top, box };
  }

  updateClimb(dt) {
    const { x: nx, z: nz } = this.wall;
    const md = this.moveDir;
    const into = -(md.x * nx + md.z * nz);
    const tx = -nz, tz = nx;
    const lat = md.x * tx + md.z * tz;

    if (this.jumpBuffer > 0) { // 壁ジャンプで離れる
      this.jumpBuffer = 0;
      this.state = 'air';
      this.vel.set(nx * 4.5, JUMP_V * 0.9, nz * 4.5);
      this.facing = Math.atan2(nx, nz);
      this.regrab = 0.35;
      this.jumpCut = false;
      this.hooks.onJump?.();
      return;
    }
    if (into < -0.5) { // 後ろに入力で手を離す
      this.state = 'air';
      this.vel.set(nx * 2, 0, nz * 2);
      this.regrab = 0.35;
      return;
    }

    if (Math.abs(lat) > 0.3) {
      this.grounded = false;
      const axis = nx !== 0 ? 'z' : 'x';
      this.moveAxis(axis, lat * (axis === 'z' ? tz : tx) * CLIMB_LATERAL * dt);
    }
    const climbV = into > 0.3 ? CLIMB_SPEED : 0;
    this.vel.set(0, climbV, 0);
    this.moveVertical(climbV * dt);
    if (climbV > 0 || Math.abs(lat) > 0.3) this.climbPhase += dt * 8;

    const probe = this.probeWall();
    if (!probe) { // 壁がなくなった（横に外れた・壊れた）
      this.state = 'air';
      this.vel.set(0, 0, 0);
      this.regrab = 0.25;
      return;
    }
    if (probe.top <= this.pos.y + MANTLE_REACH) {
      const target = this.mantleTarget(probe);
      if (target) this.startMantle(target);
      else { this.state = 'air'; this.vel.set(nx * 1.5, 0, nz * 1.5); this.regrab = 0.4; }
    }
  }

  mantleTarget(probe) {
    const { x: nx, z: nz } = this.wall;
    const b = probe.box;
    const depth = nx !== 0 ? b.max.x - b.min.x : b.max.z - b.min.z;
    // 縁のすぐ奥に別の物があるときは、乗れるところまで手前にずらす
    for (let d = Math.min(HW + 0.15, depth / 2); d > 0; d -= 0.1) {
      const tx = this.pos.x - nx * (HW + d), tz = this.pos.z - nz * (HW + d);
      if (this.fitsAt(tx, probe.top + 0.01, tz)) return new THREE.Vector3(tx, probe.top, tz);
    }
    return null;
  }

  startMantle(target) {
    this.state = 'mantle';
    const rise = clamp((target.y - this.pos.y) / MANTLE_REACH, 0, 1);
    this.mantle = { from: this.pos.clone(), to: target, t: 0, dur: 0.16 + 0.14 * rise };
    this.hooks.onMantle?.();
  }

  updateMantle(dt) {
    const m = this.mantle;
    m.t += dt / m.dur;
    const t = Math.min(1, m.t);
    const ty = 1 - (1 - Math.min(1, t / 0.6)) ** 2;
    const s = clamp((t - 0.35) / 0.65, 0, 1);
    const th = s * s * (3 - 2 * s);
    this.pos.set(
      m.from.x + (m.to.x - m.from.x) * th,
      m.from.y + (m.to.y - m.from.y) * ty,
      m.from.z + (m.to.z - m.from.z) * th,
    );
    if (t >= 1) {
      this.pos.copy(m.to);
      this.state = 'ground';
      this.grounded = true;
      this.vel.set(0, 0, 0);
      this.regrab = 0.15;
    }
  }

  // ---------- パンチ ----------
  updatePunch(dt) {
    const canPunch = this.state === 'ground' || this.state === 'air';
    const ready = this.punchT < 0 || this.punchT >= PUNCH_CHAIN_AT;
    if (this.punchBuffer > 0 && ready && canPunch) {
      this.punchBuffer = 0;
      this.punchT = 0;
      this.punchHit = false;
      this.punchArm ^= 1;
      this.punchDash = this.running && Math.hypot(this.vel.x, this.vel.z) > 6;
      this.regrab = Math.max(this.regrab, 0.45);
      if (this.moveDir.len > 0.1) this.facing = Math.atan2(this.moveDir.x, this.moveDir.z);
      if (this.punchDash) {
        const f = this.forward;
        this.vel.x += f.x * 2;
        this.vel.z += f.z * 2;
      }
      this.hooks.onSwing?.(this.punchDash);
    }
    if (this.punchT >= 0) {
      this.punchT += dt;
      if (!this.punchHit && this.punchT >= PUNCH_HIT_AT) {
        this.punchHit = true;
        this.doHit();
      }
      if (this.punchT >= PUNCH_TIME) this.punchT = -1;
    }
  }

  doHit() {
    const f = this.forward;
    const cx = this.pos.x + f.x * 0.8, cz = this.pos.z + f.z * 0.8;
    const R = 0.45;
    const hits = this.world.objectsIn(cx - R, this.pos.y + 0.1, cz - R, cx + R, this.pos.y + 1.7, cz + R);
    const point = new THREE.Vector3(cx, this.pos.y + 1.05, cz);
    if (!hits.length) return;
    const dist = (o) => Math.hypot((o.min.x + o.max.x) / 2 - this.pos.x, (o.min.z + o.max.z) / 2 - this.pos.z);
    hits.sort((a, b) => dist(a) - dist(b));
    // 当たった面の上に火花を出す
    const first = hits[0];
    point.set(
      clamp(point.x, first.min.x, first.max.x),
      clamp(point.y, first.min.y, first.max.y),
      clamp(point.z, first.min.z, first.max.z),
    );
    const dmg = this.punchDash ? 2 : 1;
    const results = hits.slice(0, this.punchDash ? 3 : 2).map((o) => ({ obj: o, broken: this.world.damage(o, dmg, f) }));
    this.hooks.onPunchHit?.(results, point, this.punchDash);
  }

  // ---------- クリア時 ----------
  celebrate() {
    this.state = 'win';
    this.punchT = -1;
    this.t = 0;
  }

  updateWin(dt, camYaw) {
    this.vel.x = 0;
    this.vel.z = 0;
    this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -32);
    this.moveVertical(this.vel.y * dt);
    this.turnToward(camYaw, dt, 6);
  }

  // ---------- アニメーション ----------
  animate(dt, snap = false) {
    const m = this.model, p = this.pose;
    const tgt = { aLx: 0, aLz: 0.12, aRx: 0, aRz: -0.12, lLx: 0, lRx: 0, lean: 0, bob: 0, twist: 0, headX: 0 };
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.t += dt;

    switch (this.state) {
      case 'ground':
        if (hs > 0.4) {
          const run = hs > 5.8;
          this.phase += dt * (run ? 11.5 : 8.5) * Math.min(1, hs / (run ? RUN : WALK) + 0.25);
          const s = Math.sin(this.phase), amp = run ? 1.05 : 0.65;
          tgt.lLx = s * amp;
          tgt.lRx = -s * amp;
          tgt.aLx = -s * amp * 0.9 - (run ? 0.35 : 0);
          tgt.aRx = s * amp * 0.9 - (run ? 0.35 : 0);
          tgt.bob = Math.abs(Math.cos(this.phase)) * (run ? 0.09 : 0.05);
          tgt.lean = run ? 0.28 : 0.08;
        } else {
          // ファイティングポーズで待機
          const b = Math.sin(this.t * 2.4);
          tgt.bob = b * 0.012;
          tgt.aLx = -0.55 + b * 0.05;
          tgt.aRx = -0.55 - b * 0.05;
          tgt.aLz = 0.22;
          tgt.aRz = -0.22;
          tgt.lLx = 0.12;
          tgt.lRx = -0.12;
        }
        break;
      case 'air':
        tgt.lLx = -0.7;
        tgt.lRx = 0.35;
        tgt.aLx = this.vel.y > 0 ? -2.2 : -0.5;
        tgt.aRx = this.vel.y > 0 ? 0.3 : -0.5;
        tgt.aLz = 0.7;
        tgt.aRz = -0.7;
        tgt.lean = 0.12;
        break;
      case 'climb': {
        const s = Math.sin(this.climbPhase);
        tgt.aLx = -2.7 + s * 0.35;
        tgt.aRx = -2.7 - s * 0.35;
        tgt.aLz = 0.15;
        tgt.aRz = -0.15;
        tgt.lLx = -0.5 - s * 0.45;
        tgt.lRx = -0.5 + s * 0.45;
        tgt.lean = -0.05;
        tgt.headX = -0.35;
        break;
      }
      case 'mantle':
        tgt.aLx = -1.3;
        tgt.aRx = -1.3;
        tgt.lLx = -1.2;
        tgt.lRx = -0.5;
        tgt.lean = 0.4;
        break;
      case 'win': {
        const s = Math.sin(this.t * 10);
        tgt.aLx = -2.9;
        tgt.aRx = -2.9;
        tgt.aLz = 0.35 + s * 0.2;
        tgt.aRz = -0.35 - s * 0.2;
        tgt.bob = Math.abs(Math.sin(this.t * 6)) * 0.15;
        tgt.headX = -0.2;
        break;
      }
    }

    const k = snap ? 1 : 1 - Math.exp(-dt * 16);
    for (const key in tgt) p[key] += (tgt[key] - p[key]) * k;

    let fistScale = 1;
    if (this.punchT >= 0) {
      const t = this.punchT;
      let ext;
      if (t < 0.05) ext = -0.3 * (t / 0.05);
      else if (t < 0.1) ext = -0.3 + 1.3 * ((t - 0.05) / 0.05);
      else if (t < 0.17) ext = 1;
      else ext = Math.max(0, 1 - (t - 0.17) / 0.13);
      const right = this.punchArm === 1;
      p[right ? 'aRx' : 'aLx'] = -0.45 - 1.15 * ext;
      p[right ? 'aRz' : 'aLz'] = 0;
      const other = right ? 'aLx' : 'aRx';
      p[other] += (-0.9 - p[other]) * k;
      p.twist = (right ? 1 : -1) * 0.45 * ext;
      p.lean += (0.15 * ext - p.lean) * k;
      fistScale = 1 + 0.35 * Math.max(0, ext);
    }

    m.root.position.copy(this.pos);
    m.root.rotation.y = this.facing;
    m.hips.position.y = 0.74 + p.bob;
    m.torso.rotation.set(p.lean, p.twist, 0);
    m.head.rotation.x = p.headX;
    m.armL.rotation.set(p.aLx, 0, p.aLz);
    m.armR.rotation.set(p.aRx, 0, p.aRz);
    m.legL.rotation.x = p.lLx;
    m.legR.rotation.x = p.lRx;
    const punchFist = (this.punchArm === 1 ? m.armR : m.armL).userData.fist;
    const idleFist = (this.punchArm === 1 ? m.armL : m.armR).userData.fist;
    punchFist.scale.setScalar(fistScale);
    idleFist.scale.setScalar(1);
  }
}
