import * as THREE from 'three';

// ステージに置くオブジェクトの種類・見た目・テクスチャ。
// 見た目はすべて「底面中央が原点」になるように作る（当たり判定の AABB と揃えるため）。

// ---------- 乱数・色 ----------
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
function hashStr(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (c, k = 1) => `rgb(${clamp255(c[0] * k)},${clamp255(c[1] * k)},${clamp255(c[2] * k)})`;
function noiseRect(g, r, x, y, w, h, base, v) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      g.fillStyle = rgb(base, 1 + (r() - 0.5) * v);
      g.fillRect(i, j, 1, 1);
    }
  }
}

// ---------- テクスチャ（32px = 1m のドット絵） ----------
const texCache = new Map();
function canvasTexture(name, w, h, draw, { clampV = false, smooth = false } = {}) {
  if (texCache.has(name)) return texCache.get(name);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, makeRng(hashStr(name)), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = clampV ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 8;
  texCache.set(name, t);
  return t;
}

// レンガ状の目地を描く（rowH: 段の高さ, brickW: 1 個の幅）
function drawBricks(g, r, w, h, rowH, brickW, mortar, brick, v) {
  noiseRect(g, r, 0, 0, w, h, mortar, 0.12);
  for (let row = 0; row * rowH < h; row++) {
    const off = row % 2 ? brickW / 2 : 0;
    for (let x = -off; x < w; x += brickW) {
      const k = 1 + (r() - 0.5) * 0.18;
      const base = brick.map((c) => c * k);
      const x0 = Math.max(0, x + 1), x1 = Math.min(w, x + brickW);
      noiseRect(g, r, x0, row * rowH + 1, x1 - x0, rowH - 1, base, v);
      g.fillStyle = rgb(base, 1.18);
      g.fillRect(x0, row * rowH + 1, x1 - x0, 1);
    }
  }
}

const T = {
  grass: () => canvasTexture('grass', 32, 32, (g, r) => {
    noiseRect(g, r, 0, 0, 32, 32, [104, 172, 74], 0.18);
    for (let i = 0; i < 46; i++) {
      g.fillStyle = rgb([72, 138, 56], 1 + (r() - 0.5) * 0.2);
      g.fillRect((r() * 32) | 0, (r() * 32) | 0, 1, 2);
    }
    for (let i = 0; i < 18; i++) {
      g.fillStyle = rgb([152, 208, 106]);
      g.fillRect((r() * 32) | 0, (r() * 32) | 0, 1, 1);
    }
  }),
  // 側面は上端から 4m ぶん。下は ClampToEdge で最下段の色が伸びる
  grassSide: () => canvasTexture('grassSide', 32, 128, (g, r) => {
    noiseRect(g, r, 0, 0, 32, 128, [132, 95, 62], 0.22);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = rgb([124, 118, 112], 1 + (r() - 0.5) * 0.3);
      g.fillRect((r() * 30) | 0, 10 + ((r() * 110) | 0), 2 + ((r() * 2) | 0), 2);
    }
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(25,12,5,0.5)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 128);
    for (let x = 0; x < 32; x++) noiseRect(g, r, x, 0, 1, 4 + ((r() * 4) | 0), [96, 164, 68], 0.2);
  }, { clampV: true }),
  stoneFloor: () => canvasTexture('stoneFloor', 32, 32, (g, r) => {
    drawBricks(g, r, 32, 32, 16, 16, [96, 94, 100], [156, 154, 160], 0.14);
  }),
  stoneSide: () => canvasTexture('stoneSide', 32, 128, (g, r) => {
    drawBricks(g, r, 32, 128, 16, 32, [70, 68, 74], [124, 122, 128], 0.16);
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(10,10,20,0.5)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 128);
  }, { clampV: true }),
  crate: () => canvasTexture('crate', 32, 32, (g, r) => {
    noiseRect(g, r, 0, 0, 32, 32, [182, 126, 64], 0.12);
    g.fillStyle = rgb([118, 78, 38]);
    for (const x of [8, 16, 24]) g.fillRect(x, 0, 1, 32);
    const frame = [142, 94, 46];
    noiseRect(g, r, 0, 0, 32, 3, frame, 0.12);
    noiseRect(g, r, 0, 29, 32, 3, frame, 0.12);
    noiseRect(g, r, 0, 0, 3, 32, frame, 0.12);
    noiseRect(g, r, 29, 0, 3, 32, frame, 0.12);
    for (let i = 3; i < 27; i++) noiseRect(g, r, i, 28 - i - 1, 3, 3, frame, 0.12);
    g.fillStyle = rgb([70, 60, 55]);
    for (const [x, y] of [[1, 1], [30, 1], [1, 30], [30, 30]]) g.fillRect(x, y, 1, 1);
  }),
  barrel: () => canvasTexture('barrel', 32, 32, (g, r) => {
    for (let x = 0; x < 32; x += 4) {
      const k = 1 + (r() - 0.5) * 0.2;
      noiseRect(g, r, x, 0, 4, 32, [150, 86, 46].map((c) => c * k), 0.1);
      g.fillStyle = rgb([92, 52, 28]);
      g.fillRect(x, 0, 1, 32);
    }
  }),
  plank: () => canvasTexture('plank', 32, 32, (g, r) => {
    noiseRect(g, r, 0, 0, 32, 32, [188, 140, 86], 0.14);
    g.fillStyle = rgb([140, 98, 56]);
    for (const y of [0, 11, 22]) g.fillRect(0, y, 32, 1);
  }),
  brick: () => canvasTexture('brick', 32, 32, (g, r) => {
    drawBricks(g, r, 32, 32, 8, 16, [200, 188, 170], [176, 78, 56], 0.12);
  }),
  fortWall: () => canvasTexture('fortWall', 32, 32, (g, r) => {
    drawBricks(g, r, 32, 32, 16, 32, [72, 74, 82], [140, 142, 152], 0.16);
  }),
  cobble: () => canvasTexture('cobble', 32, 32, (g, r) => {
    noiseRect(g, r, 0, 0, 32, 32, [132, 132, 138], 0.2);
    g.fillStyle = rgb([92, 92, 98]);
    for (let i = 0; i < 7; i++) {
      let x = r() * 32, y = r() * 32;
      for (let s = 0; s < 6; s++) {
        g.fillRect(x | 0, y | 0, 1, 1);
        x = (x + (r() - 0.5) * 4 + 32) % 32;
        y = (y + (r() - 0.5) * 4 + 32) % 32;
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, 0, 32, 1);
    g.fillRect(0, 0, 1, 32);
  }),
  marble: () => canvasTexture('marble', 32, 32, (g, r) => {
    noiseRect(g, r, 0, 0, 32, 32, [228, 224, 214], 0.06);
    g.fillStyle = 'rgba(120,112,100,0.45)';
    for (let v = 0; v < 3; v++) {
      let x = r() * 32;
      for (let y = 0; y < 32; y++) {
        g.fillRect(x | 0, y, 1, 1);
        x = (x + (r() - 0.5) * 2.5 + 32) % 32;
      }
    }
  }),
  bark: () => canvasTexture('bark', 16, 16, (g, r) => {
    noiseRect(g, r, 0, 0, 16, 16, [112, 80, 50], 0.18);
    g.fillStyle = rgb([80, 56, 34]);
    for (let i = 0; i < 6; i++) g.fillRect((r() * 16) | 0, (r() * 12) | 0, 1, 4);
  }),
  leaves: () => canvasTexture('leaves', 16, 16, (g, r) => {
    noiseRect(g, r, 0, 0, 16, 16, [76, 152, 64], 0.3);
    g.fillStyle = rgb([128, 196, 96]);
    for (let i = 0; i < 10; i++) g.fillRect((r() * 16) | 0, (r() * 16) | 0, 1, 1);
  }),
  crack: (level) => canvasTexture('crack' + level, 64, 64, (g, r) => {
    g.strokeStyle = 'rgba(28,20,14,0.85)';
    g.lineWidth = 2;
    g.lineCap = 'round';
    const branches = level === 1 ? 4 : 9;
    for (let b = 0; b < branches; b++) {
      let x = 32 + (r() - 0.5) * 18, y = 32 + (r() - 0.5) * 18;
      let a = r() * Math.PI * 2;
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
  }, { smooth: true }),
};

// ---------- マテリアル（共有） ----------
const matCache = new Map();
function shared(name, make) {
  if (!matCache.has(name)) matCache.set(name, make());
  return matCache.get(name);
}
const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts });

const M = {
  crate: () => shared('crate', () => std({ map: T.crate() })),
  barrel: () => shared('barrel', () => std({ map: T.barrel() })),
  barrelLid: () => shared('barrelLid', () => std({ color: 0x6d3f22 })),
  metal: () => shared('metal', () => std({ color: 0x3a3d44, metalness: 0.6, roughness: 0.45 })),
  plank: () => shared('plank', () => std({ map: T.plank() })),
  brick: () => shared('brick', () => std({ map: T.brick() })),
  fortWall: () => shared('fortWall', () => std({ map: T.fortWall() })),
  cobble: () => shared('cobble', () => std({ map: T.cobble() })),
  marble: () => shared('marble', () => std({ map: T.marble(), roughness: 0.6 })),
  bark: () => shared('bark', () => std({ map: T.bark() })),
  leaves: () => shared('leaves', () => std({ map: T.leaves() })),
  rock: () => shared('rock', () => std({ color: 0x8b8a86, flatShading: true })),
  glow: () => shared('glow', () => new THREE.MeshBasicMaterial({
    color: 0x7ff6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
  })),
};

export function floorMaterials(theme) {
  return shared('floor-' + theme, () => {
    const stone = theme === 'stone';
    const top = std({ map: stone ? T.stoneFloor() : T.grass() });
    const side = std({ map: stone ? T.stoneSide() : T.grassSide() });
    return [side, side, top, side, side, side];
  });
}

export function crackMaterial(level) {
  const m = new THREE.MeshBasicMaterial({
    map: T.crack(level), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.userData.owned = true;
  m.userData.baseOpacity = 1;
  m.userData.baseTransparent = true;
  return m;
}

// ---------- ジオメトリ ----------
// 面ごとに UV を実寸（m）倍して、テクスチャが 1m ごとに繰り返されるようにする
function scaleBoxUV(g, w, h, d) {
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
}

function boxMesh(w, h, d, material, worldUV = false, y = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2 + y, 0);
  if (worldUV) scaleBoxUV(g, w, h, d);
  return new THREE.Mesh(g, material);
}

// 地面の島。側面テクスチャは上端が v=1、下へ 4m で v=0（それより下はクランプ）
export function buildFloor(w, h, d, theme) {
  const group = new THREE.Group();
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u = uv.getX(k), v = uv.getY(k);
      if (f === 2 || f === 3) uv.setXY(k, u * w, v * d);
      else uv.setXY(k, u * (f < 2 ? d : w), 1 - (1 - v) * h / 4);
    }
  }
  const slab = new THREE.Mesh(g, floorMaterials(theme));
  slab.receiveShadow = true;
  slab.castShadow = true;
  group.add(slab);

  // 浮島らしく、底に逆四角錐の岩をつける（当たり判定なし）
  const coneH = Math.min(14, 3 + Math.sqrt(w * d) * 0.9);
  const cg = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
  cg.rotateY(Math.PI / 4);
  cg.rotateX(Math.PI);
  cg.translate(0, -0.5, 0);
  cg.scale(w * 0.96, coneH, d * 0.96);
  const under = new THREE.Mesh(cg, shared('under-' + theme, () => std({
    color: theme === 'stone' ? 0x5d5b64 : 0x6e5440, flatShading: true,
  })));
  group.add(under);
  return group;
}

// ---------- オブジェクトの見た目 ----------
const BUILD = {
  crate: (w, h, d) => boxMesh(w, h, d, M.crate()),
  barrel: (w, h) => {
    const g = new THREE.Group();
    const r = w / 2;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, h, 14), M.barrel());
    body.position.y = h / 2;
    g.add(body);
    for (const y of [0.2, 0.8]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.08, 14), M.metal());
      band.position.y = h * y;
      g.add(band);
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.02, 14), M.barrelLid());
    lid.position.y = h + 0.005;
    g.add(lid);
    return g;
  },
  brick: (w, h, d) => boxMesh(w, h, d, M.brick(), true),
  fortWall: (w, h, d) => boxMesh(w, h, d, M.fortWall(), true),
  stone: (w, h, d) => boxMesh(w, h, d, M.cobble(), true),
  pillar: (w, h, d) => {
    const g = new THREE.Group();
    g.add(boxMesh(w, 0.22, d, M.marble(), true));
    g.add(boxMesh(w * 0.78, h - 0.44, d * 0.78, M.marble(), true, 0.22));
    g.add(boxMesh(w, 0.22, d, M.marble(), true, h - 0.22));
    return g;
  },
  tree: (w, h, d) => {
    const g = new THREE.Group();
    g.add(boxMesh(w * 0.32, h * 0.45, d * 0.32, M.bark(), true));
    g.add(boxMesh(w, h * 0.36, d, M.leaves(), true, h * 0.4));
    g.add(boxMesh(w * 0.62, h * 0.24, d * 0.62, M.leaves(), true, h * 0.76));
    return g;
  },
  rock: (w, h, d) => {
    const geo = new THREE.DodecahedronGeometry(0.5, 0);
    geo.scale(w, h, d);
    geo.translate(0, h / 2, 0);
    return new THREE.Mesh(geo, M.rock());
  },
  bush: (w, h, d) => {
    const g = new THREE.Group();
    g.add(boxMesh(w * 0.8, h * 0.8, d * 0.8, M.leaves(), true));
    const a = boxMesh(w * 0.5, h * 0.5, d * 0.5, M.leaves(), true, h * 0.5);
    a.position.set(w * 0.2, 0, -d * 0.12);
    const b = boxMesh(w * 0.45, h * 0.55, d * 0.45, M.leaves(), true);
    b.position.set(-w * 0.26, 0, d * 0.25);
    g.add(a, b);
    return g;
  },
  fence: (w, h, d) => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const post = boxMesh(0.16, h, 0.16, M.plank(), true);
      post.position.x = s * (w / 2 - 0.08);
      g.add(post);
    }
    for (const y of [0.32, 0.72]) g.add(boxMesh(w, 0.13, d * 0.4, M.plank(), true, h * y));
    return g;
  },
  platform: (w, h, d) => {
    const g = new THREE.Group();
    g.add(boxMesh(w, h, d, M.cobble(), true));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, d * 0.8), M.glow());
    glow.rotation.x = Math.PI / 2;
    glow.position.y = -0.02;
    g.add(glow);
    return g;
  },
};

// hp: パンチ何発で壊れるか（ダッシュパンチは 2 ダメージ）
// debris: 壊れたときの破片の色 / sound: 効果音の種類 / noCrack: ひび割れ表示をしない形
export const OBJECT_TYPES = {
  crate:    { size: [1, 1, 1], hp: 1, sound: 'wood', debris: [0xb57b3e, 0x8a5a2b, 0xd49a58] },
  bigCrate: { size: [2, 2, 2], hp: 3, sound: 'wood', debris: [0xb57b3e, 0x8a5a2b, 0xd49a58], look: 'crate' },
  barrel:   { size: [0.9, 1.15, 0.9], hp: 2, sound: 'wood', debris: [0x9b5a31, 0x6d3f22, 0x3a3d44], noCrack: true },
  brick:    { size: [2, 1, 1], hp: 2, sound: 'stone', debris: [0xb2553b, 0x8e3f2c, 0xcfc3b0] },
  fortWall: { size: [2, 1, 1], hp: 3, sound: 'stone', debris: [0x8d8f98, 0x6d6f78, 0xa7a9b2] },
  stone:    { size: [1, 1, 1], hp: 3, sound: 'stone', debris: [0x8a8a90, 0x6e6e74, 0xa2a2a8] },
  pillar:   { size: [1, 4, 1], hp: 4, sound: 'stone', debris: [0xe4e0d6, 0xc9c4b8, 0xa9a49a] },
  tree:     { size: [1.4, 3.1, 1.4], hp: 3, sound: 'wood', debris: [0x5c9e48, 0x417d36, 0x7a5434], noCrack: true },
  rock:     { size: [1.3, 0.9, 1.1], hp: 3, sound: 'stone', debris: [0x8b8a86, 0x6f6e6a], noCrack: true },
  bush:     { size: [1, 0.75, 1], hp: 1, sound: 'leaf', debris: [0x5aa046, 0x3f8034, 0x78bb5c], noCrack: true },
  fence:    { size: [2, 1, 0.24], hp: 1, sound: 'wood', debris: [0xb98a52, 0x8f6536], noCrack: true },
  platform: { size: [2, 0.5, 2], hp: 4, sound: 'stone', debris: [0x8a8a90, 0x6e6e74, 0x7ff6ff], fixed: true },
};

export function buildObject(typeKey, w, h, d) {
  const type = OBJECT_TYPES[typeKey];
  return BUILD[type.look ?? typeKey](w, h, d);
}
