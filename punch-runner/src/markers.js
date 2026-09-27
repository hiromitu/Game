import * as THREE from 'three';
import { GRAVITY } from './world.js';

// ゴールのゲート。当たり判定のない目印で、下のブロックを壊すと落ちてくる
// （ゴールに届かなくなることはない）

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function swirlTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  rad.addColorStop(0, 'rgba(255,255,240,1)');
  rad.addColorStop(0.5, 'rgba(255,214,110,0.55)');
  rad.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 3;
  for (let arm = 0; arm < 3; arm++) {
    g.beginPath();
    for (let i = 0; i < 40; i++) {
      const t = i / 40, a = arm * (Math.PI * 2 / 3) + t * 4.2, r = 6 + t * 54;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 下に支えがなければ落ちる目印の共通処理
class Marker {
  // y を省略すると、その列の一番上に置く
  place(world, x, z, y) {
    this.x = x;
    this.z = z;
    this.y = y ?? world.surfaceTop(Math.floor(x), Math.floor(z));
    this.vy = 0;
  }

  settle(world, dt) {
    const sup = world.topBelow(this.x, this.z, this.y + 1e-3);
    if (sup === -Infinity) return;
    if (this.y > sup + 1e-3) {
      this.vy -= GRAVITY * dt;
      this.y = Math.max(sup, this.y + this.vy * dt);
    } else {
      this.vy = 0;
    }
  }
}

export class Goal extends Marker {
  constructor(scene) {
    super();
    this.group = new THREE.Group();
    scene.add(this.group);
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffa53a, emissiveIntensity: 0.55, metalness: 0.35, roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.12, 32), gold);
    base.position.y = 0.06;
    base.receiveShadow = true;
    this.portal = new THREE.Group();
    this.portal.position.y = 1.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.1, 12, 48), gold);
    ring.castShadow = true;
    this.swirl = new THREE.Mesh(new THREE.CircleGeometry(0.84, 48), new THREE.MeshBasicMaterial({
      map: swirlTexture(), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.portal.add(ring, this.swirl);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 40, 24, 1, true), new THREE.MeshBasicMaterial({
      map: gradientTexture(), color: 0xffe08a, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.beam.position.y = 20;
    const light = new THREE.PointLight(0xffd27a, 10, 9, 1.5);
    light.position.y = 1.3;
    this.group.add(base, this.portal, this.beam, light);
  }

  update(dt, world, time) {
    this.settle(world, dt);
    this.group.position.set(this.x, this.y, this.z);
    this.portal.rotation.y = time * 0.9;
    this.portal.position.y = 1.3 + Math.sin(time * 2) * 0.06;
    this.swirl.rotation.z = -time * 2.5;
    this.beam.material.opacity = 0.32 + Math.sin(time * 3) * 0.08;
  }

  contains(p) {
    return Math.hypot(p.x - this.x, p.z - this.z) < 1.0 && p.y > this.y - 0.6 && p.y < this.y + 2.2;
  }
}
