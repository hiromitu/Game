import * as THREE from 'three';
import { GRAVITY } from './world.js';

// 破片（壊れたオブジェクトのかけら）と、土ぼこり・火花のパフ

const DEBRIS_MAX = 260;
const PUFF_MAX = 80;

export class Effects {
  constructor(scene, world) {
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cube = new THREE.BoxGeometry(1, 1, 1);
    this.sphere = new THREE.IcosahedronGeometry(0.5, 1);
    this.matCache = new Map();
    this.debris = [];
    this.puffs = [];
    this.puffPool = [];
  }

  clear() {
    for (const d of this.debris) this.group.remove(d.mesh);
    for (const p of this.puffs) { p.mesh.visible = false; this.puffPool.push(p); }
    this.debris = [];
    this.puffs = [];
  }

  debrisMaterial(color) {
    if (!this.matCache.has(color)) this.matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    return this.matCache.get(color);
  }

  // 壊れたブロック (x, y, z) を破片にする。dir は殴った向き
  burstBlock(x, y, z, def, dir) {
    const n = 12;
    const colors = def.debris;
    for (let i = 0; i < n; i++) {
      if (this.debris.length >= DEBRIS_MAX) this.group.remove(this.debris.shift().mesh);
      const s = 0.14 + Math.random() * 0.2;
      const mesh = new THREE.Mesh(this.cube, this.debrisMaterial(colors[i % colors.length]));
      mesh.scale.setScalar(s);
      mesh.position.set(x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      mesh.castShadow = i < 3;
      this.group.add(mesh);
      let ox = mesh.position.x - (x + 0.5), oz = mesh.position.z - (z + 0.5);
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol; oz /= ol;
      const push = 2 + Math.random() * 3.5;
      const out = 1 + Math.random() * 2.5;
      this.debris.push({
        mesh, size: s,
        vel: new THREE.Vector3(
          ox * out + dir.x * push,
          2 + Math.random() * 4.5 + (dir.y ?? 0) * push,
          oz * out + dir.z * push,
        ),
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18),
        life: 1.3 + Math.random() * 1.1,
      });
    }
    this.puff(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), 0xf2efe8, 5, 2.2, 0.5);
  }

  splash(pos, strength = 1) {
    this.puff(pos, 0xcfe8ff, Math.round(5 + strength * 6), 2 + strength * 2, 0.3 + strength * 0.15);
  }

  puff(pos, color, count, speed, size) {
    for (let i = 0; i < count; i++) {
      let p = this.puffPool.pop();
      if (!p) {
        if (this.puffs.length >= PUFF_MAX) continue;
        const mesh = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
        this.group.add(mesh);
        p = { mesh, vel: new THREE.Vector3() };
      }
      p.mesh.visible = true;
      p.mesh.material.color.set(color);
      p.mesh.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4));
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      p.vel.set(Math.cos(a) * sp, speed * 0.35 * Math.random() + 0.3, Math.sin(a) * sp);
      p.size = size * (0.6 + Math.random() * 0.6);
      p.life = p.maxLife = 0.35 + Math.random() * 0.3;
      this.puffs.push(p);
    }
  }

  dust(pos, strength = 1) {
    this.puff(pos, 0xe8e0cf, Math.round(3 + strength * 5), 1.6 + strength * 1.5, 0.35 + strength * 0.2);
  }

  spark(pos, big = false) {
    this.puff(pos, 0xfff1a8, big ? 8 : 5, big ? 5 : 3.5, big ? 0.32 : 0.22);
  }

  update(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const p = this.debris[i];
      const m = p.mesh;
      p.life -= dt;
      if (p.life <= 0 || m.position.y < -40) {
        this.group.remove(m);
        this.debris.splice(i, 1);
        continue;
      }
      const half = p.size / 2;
      const prevBottom = m.position.y - half;
      p.vel.y -= GRAVITY * dt;
      m.position.addScaledVector(p.vel, dt);
      m.rotation.x += p.spin.x * dt;
      m.rotation.y += p.spin.y * dt;
      m.rotation.z += p.spin.z * dt;
      if (p.vel.y < 0) {
        const top = this.world.topBelow(m.position.x, m.position.z, prevBottom + 0.05);
        if (m.position.y - half < top) {
          m.position.y = top + half;
          p.vel.y = Math.abs(p.vel.y) < 1.2 ? 0 : -p.vel.y * 0.3;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
          p.spin.multiplyScalar(0.6);
        }
      }
      if (p.life < 0.5) m.scale.setScalar(p.size * (p.life / 0.5));
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        this.puffs.splice(i, 1);
        this.puffPool.push(p);
        continue;
      }
      const t = 1 - p.life / p.maxLife;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 4));
      p.mesh.scale.setScalar(p.size * (0.5 + t));
      p.mesh.material.opacity = 0.85 * (1 - t);
    }
  }
}
