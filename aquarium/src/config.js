import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

// 1 unit = 10 cm。幅120 x 高さ62 x 奥行50 cm の水槽
export const TANK = {
  minX: -6, maxX: 6,
  minZ: -2.5, maxZ: 2.5,
  floorY: 0,
  glassTop: 6.2,
  waterY: 5.6,
};

// ポンプ吐出口から落ちた水が水面に当たる位置
export const PUMP = {
  lip: new THREE.Vector3(4.3, 6.34, -1.62),
  impact: new THREE.Vector3(4.3, TANK.waterY, -1.2),
  width: 0.9,
};

// すべてのシェーダーで共有するユニフォーム（値の参照を共有する）
export const shared = {
  uTime: { value: 0 },
  uPump: { value: 1 },
  uImpact: { value: PUMP.impact },
  uTankMin: { value: new THREE.Vector3(TANK.minX, TANK.floorY, TANK.minZ) },
  uTankMax: { value: new THREE.Vector3(TANK.maxX, TANK.waterY, TANK.maxZ) },
  uWaterColor: { value: new THREE.Color(0x1f6f78) },
  uWaterDensity: { value: 0.085 },
  uCaustic: { value: 1.0 },
  uLightLevel: { value: 1.0 },
};

const perlin = new ImprovedNoise();
export function noise3(x, y, z) {
  return perlin.noise(x, y, z);
}

export function fbm3(x, y, z, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin.noise(x * freq, y * freq, z * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// 決定的な乱数（毎回同じレイアウトになる）
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}

const smooth = THREE.MathUtils.smoothstep;

// 底床の高さ。手前は低く、奥に向かって砂が盛り上がる
export function sandHeight(x, z) {
  const back = smooth(-z, -1.0, 2.4);
  let h = 0.35 + 1.5 * Math.pow(back, 1.5);
  h += (0.1 + 0.15 * back) * noise3(x * 0.55, 3.1, z * 0.55);
  h += 0.04 * noise3(x * 2.1, 7.7, z * 2.1);
  // 左側の小山（有茎草を植える場所）
  h += 0.35 * Math.exp(-((x + 3.0) ** 2 + (z + 0.3) ** 2) / 1.6);
  return h;
}
