import * as THREE from 'three';

// ブロックの種類と、全ブロックの見た目をまとめたテクスチャアトラス（16px のドット絵）。

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, CRATE: 7,
  BRICK: 8, SNOW: 9, WATER: 10, COBBLE: 11, PLANK: 12,
};

// hp: パンチ何発で壊れるか（ダッシュパンチ・急降下パンチは 2 ダメージ）
// loose: 下が空くと落ちてくる / debris: 破片の色 / sound: 効果音の種類
export const BLOCKS = [];
const def = (id, o) => { BLOCKS[id] = { id, ...o }; };
def(B.GRASS,  { name: '草',   top: 'grassTop', side: 'grassSide', bottom: 'dirt', hp: 1, sound: 'dirt', debris: [0x68ac4a, 0x86603e, 0x5a8f3c] });
def(B.DIRT,   { name: '土',   all: 'dirt', hp: 1, sound: 'dirt', debris: [0x86603e, 0x6f4e31, 0x9a7250] });
def(B.STONE,  { name: '石',   all: 'stone', hp: 3, sound: 'stone', debris: [0x8a8a90, 0x6e6e74, 0xa2a2a8] });
def(B.SAND,   { name: '砂',   all: 'sand', hp: 1, sound: 'sand', loose: true, debris: [0xdccb92, 0xc9b67c, 0xeadba8] });
def(B.LOG,    { name: '木',   top: 'logTop', side: 'logSide', bottom: 'logTop', hp: 2, sound: 'wood', debris: [0x7a5434, 0x5e3f25, 0xb08a56] });
def(B.LEAVES, { name: '葉',   all: 'leaves', hp: 1, sound: 'leaf', debris: [0x5aa046, 0x3f8034, 0x78bb5c] });
def(B.CRATE,  { name: '木箱', all: 'crate', hp: 1, sound: 'wood', loose: true, debris: [0xb57b3e, 0x8a5a2b, 0xd49a58] });
def(B.BRICK,  { name: 'レンガ', all: 'brick', hp: 2, sound: 'stone', debris: [0xb2553b, 0x8e3f2c, 0xcfc3b0] });
def(B.SNOW,   { name: '雪',   top: 'snowTop', side: 'snowSide', bottom: 'dirt', hp: 1, sound: 'sand', debris: [0xf2f6fa, 0xdfe7ee, 0x86603e] });
def(B.WATER,  { name: '水',   all: 'water', hp: Infinity, water: true });
def(B.COBBLE, { name: '石畳', all: 'cobble', hp: 2, sound: 'stone', debris: [0x8d8f98, 0x6d6f78, 0xa7a9b2] });
def(B.PLANK,  { name: '板',   all: 'plank', hp: 1, sound: 'wood', debris: [0xbe8e58, 0x94683a] });

export const isSolidId = (t) => t !== B.AIR && t !== B.WATER;

export function faceTile(t, face) {
  const d = BLOCKS[t];
  return d.all ?? (face === 'top' ? d.top : face === 'bottom' ? d.bottom : d.side);
}

// ---------- アトラス ----------
const T = 16, COLS = 8, ROWS = 2;
const TILE_ORDER = ['grassTop', 'grassSide', 'dirt', 'stone', 'sand', 'logSide', 'logTop', 'leaves',
  'crate', 'brick', 'snowTop', 'snowSide', 'water', 'cobble', 'plank'];

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (c, k = 1) => `rgb(${clamp255(c[0] * k)},${clamp255(c[1] * k)},${clamp255(c[2] * k)})`;

function drawTile(g, name, r) {
  const px = (x, y, c, k = 1) => { g.fillStyle = rgb(c, k); g.fillRect(x, y, 1, 1); };
  const noise = (x0, y0, w, h, c, v) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, c, 1 + (r() - 0.5) * v);
  };
  const DIRT = [134, 96, 62], GRASS = [100, 170, 72];
  switch (name) {
    case 'grassTop':
      noise(0, 0, T, T, GRASS, 0.2);
      for (let i = 0; i < 14; i++) px((r() * T) | 0, (r() * T) | 0, [70, 136, 54]);
      for (let i = 0; i < 6; i++) px((r() * T) | 0, (r() * T) | 0, [150, 206, 104]);
      break;
    case 'grassSide':
      noise(0, 0, T, T, DIRT, 0.22);
      for (let x = 0; x < T; x++) noise(x, 0, 1, 3 + ((r() * 3) | 0), GRASS, 0.2);
      break;
    case 'dirt':
      noise(0, 0, T, T, DIRT, 0.22);
      for (let i = 0; i < 5; i++) px((r() * T) | 0, (r() * T) | 0, [110, 104, 98]);
      break;
    case 'stone':
      noise(0, 0, T, T, [128, 128, 134], 0.16);
      for (let i = 0; i < 3; i++) {
        let x = r() * T, y = r() * T;
        for (let s = 0; s < 5; s++) {
          px(x | 0, y | 0, [92, 92, 98]);
          x = (x + (r() - 0.5) * 3 + T) % T;
          y = (y + (r() - 0.5) * 3 + T) % T;
        }
      }
      break;
    case 'sand':
      noise(0, 0, T, T, [220, 204, 148], 0.1);
      break;
    case 'logSide':
      for (let x = 0; x < T; x++) noise(x, 0, 1, T, [112, 80, 50], x % 4 === 0 ? 0.1 : 0.25);
      for (let x = 0; x < T; x += 4) for (let y = 0; y < T; y++) px(x, y, [84, 58, 36]);
      break;
    case 'logTop':
      noise(0, 0, T, T, [178, 140, 88], 0.1);
      g.strokeStyle = rgb([140, 104, 62]);
      g.lineWidth = 1;
      for (const rad of [2.5, 5]) { g.beginPath(); g.arc(8, 8, rad, 0, Math.PI * 2); g.stroke(); }
      for (let i = 0; i < T; i++) { px(i, 0, [96, 68, 42]); px(i, T - 1, [96, 68, 42]); px(0, i, [96, 68, 42]); px(T - 1, i, [96, 68, 42]); }
      break;
    case 'leaves':
      noise(0, 0, T, T, [72, 148, 62], 0.35);
      for (let i = 0; i < 10; i++) px((r() * T) | 0, (r() * T) | 0, [126, 194, 94]);
      for (let i = 0; i < 8; i++) px((r() * T) | 0, (r() * T) | 0, [44, 96, 40]);
      break;
    case 'crate': {
      noise(0, 0, T, T, [182, 126, 64], 0.12);
      const frame = [140, 92, 44];
      noise(0, 0, T, 2, frame, 0.1); noise(0, T - 2, T, 2, frame, 0.1);
      noise(0, 0, 2, T, frame, 0.1); noise(T - 2, 0, 2, T, frame, 0.1);
      for (let i = 2; i < T - 2; i++) noise(i, T - 1 - i - 1, 2, 2, frame, 0.1);
      for (const x of [5, 10]) for (let y = 2; y < T - 2; y++) px(x, y, [120, 80, 38]);
      break;
    }
    case 'brick':
      noise(0, 0, T, T, [200, 188, 170], 0.1);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 4 : 0;
        for (let x = -off; x < T; x += 8) {
          const k = 1 + (r() - 0.5) * 0.18;
          const x0 = Math.max(0, x + 1), x1 = Math.min(T, x + 8);
          noise(x0, row * 4 + 1, x1 - x0, 3, [176 * k, 78 * k, 56 * k], 0.1);
        }
      }
      break;
    case 'snowTop':
      noise(0, 0, T, T, [240, 246, 250], 0.05);
      break;
    case 'snowSide':
      noise(0, 0, T, T, DIRT, 0.22);
      for (let x = 0; x < T; x++) noise(x, 0, 1, 4 + ((r() * 3) | 0), [238, 244, 248], 0.05);
      break;
    case 'water':
      noise(0, 0, T, T, [70, 146, 224], 0.08);
      for (let i = 0; i < 5; i++) {
        const x = (r() * 12) | 0, y = (r() * T) | 0;
        for (let k = 0; k < 4; k++) px(x + k, y, [150, 200, 245]);
      }
      break;
    case 'cobble':
      noise(0, 0, T, T, [72, 74, 82], 0.1);
      for (const [x, y, w, h] of [[1, 1, 6, 4], [8, 1, 7, 3], [1, 6, 4, 4], [6, 5, 5, 5], [12, 5, 3, 5], [1, 11, 7, 4], [9, 11, 6, 4]]) {
        noise(x, y, w, h, [140 * (0.9 + r() * 0.2), 142, 152], 0.12);
      }
      break;
    case 'plank':
      noise(0, 0, T, T, [190, 142, 88], 0.14);
      for (const y of [0, 5, 10, 15]) for (let x = 0; x < T; x++) px(x, y, [140, 98, 56]);
      break;
  }
}

let atlas = null;
export function getAtlas() {
  if (atlas) return atlas;
  const c = document.createElement('canvas');
  c.width = COLS * T;
  c.height = ROWS * T;
  const g = c.getContext('2d');
  TILE_ORDER.forEach((name, i) => {
    g.save();
    g.translate((i % COLS) * T, Math.floor(i / COLS) * T);
    g.beginPath();
    g.rect(0, 0, T, T);
    g.clip();
    drawTile(g, name, makeRng(i * 7919 + 17));
    g.restore();
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  return atlas;
}

// タイルの UV 範囲 [u0, v0(下), u1, v1(上)]。隣のタイルがにじまないよう少し内側を使う
const uvCache = new Map();
export function tileUV(name) {
  if (uvCache.has(name)) return uvCache.get(name);
  const i = TILE_ORDER.indexOf(name);
  const W = COLS * T, H = ROWS * T, e = 0.02;
  const col = i % COLS, row = Math.floor(i / COLS);
  const uv = [(col * T + e) / W, 1 - ((row + 1) * T - e) / H, ((col + 1) * T - e) / W, 1 - (row * T + e) / H];
  uvCache.set(name, uv);
  return uv;
}

// ひび割れの重ね表示
const crackTex = [];
export function crackTexture(level) {
  if (crackTex[level]) return crackTex[level];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = makeRng(level * 131 + 7);
  g.strokeStyle = 'rgba(28,20,14,0.85)';
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  const branches = level === 1 ? 4 : 9;
  for (let b = 0; b < branches; b++) {
    let x = 32 + (r() - 0.5) * 18, y = 32 + (r() - 0.5) * 18, a = r() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 3 + ((r() * 4) | 0) + level * 2;
    for (let s = 0; s < steps; s++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * 5;
      y += Math.sin(a) * 5;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  crackTex[level] = t;
  return t;
}
