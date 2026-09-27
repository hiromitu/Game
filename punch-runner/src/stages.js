import { B } from './blocks.js';

// ステージ定義。立方体の中に、ノイズで起伏をつけた地形（丘・山・谷）と水を作る。
// 水以外のブロックはすべて殴って壊せる。

export const THEMES = {
  meadow: { skyTop: 0x4d9be6, skyBottom: 0xd6ecf7, fog: 0xcfe6f2, hemiSky: 0xdff1ff, hemiGround: 0x5b6b3a, sun: 0xfff1d6, clouds: 16 },
  alpine: { skyTop: 0x3f5f9e, skyBottom: 0xf4c89a, fog: 0xe8c29c, hemiSky: 0xffe2c4, hemiGround: 0x4a4038, sun: 0xffd2a1, clouds: 12 },
  dusk:   { skyTop: 0x2a3f8a, skyBottom: 0xe9b8d8, fog: 0xd8b6d6, hemiSky: 0xe8dcff, hemiGround: 0x5a4a6a, sun: 0xffe0c0, clouds: 20 },
};

// ---------- ノイズ ----------
function makeNoise(seed) {
  const hash = (ix, iz) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 144269);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const value = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // -1..1 のフラクタルノイズ
  return (x, z, oct = 4) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += (value(x * freq, z * freq) * 2 - 1) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bump = (x, z, cx, cz, h, r) => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------- ステージ ----------
export const STAGES = [
  {
    name: '丘と小川',
    theme: 'meadow',
    size: [40, 24, 40],
    seed: 11,
    water: 5,
    snowLine: 99,
    stoneLine: 99,
    start: [5, 35],
    goal: [31, 8],
    trees: 16,
    tips: [
      'マウスで向きを変え、WASD で移動。Shift で走る',
      '左クリックで照準のブロックをパンチ。水以外は何でも壊せる',
      '右クリックでジャンプ。段差や壁に向かって進み続けるとよじ登れる',
      '小川は泳いで渡れる（右クリック長押しで浮上）。橋を渡ってもいい',
      '光の柱が立っている丘の上がゴール！',
    ],
    height(x, z, n) {
      let h = 6.5 + n(x / 13, z / 13) * 2.6;
      h += bump(x, z, 31, 8, 6.5, 6) + bump(x, z, 9, 11, 3.5, 6) + bump(x, z, 34, 32, 3, 5);
      // 小川：z ≈ 21 を蛇行して横切る谷
      const zr = 21 + Math.sin(x / 6.5) * 3;
      const d = Math.abs(z - zr);
      if (d < 3.2) h -= 3.6 * (1 - (d / 3.2) ** 2);
      return h;
    },
    decorate(g) {
      // ゴールの台座と、小川にかかる橋
      g.fill(29, g.top(31, 8) - 1, 6, 33, g.top(31, 8) - 1, 10, B.COBBLE);
      for (let z = 16; z <= 26; z++) {
        g.fill(19, 6, z, 20, 6, z, B.PLANK);
        g.clearAbove(19, 7, z, 20, 9, z);
      }
      // 木箱の山とレンガの廃墟
      g.stack(9, 30, B.CRATE, 2); g.stack(10, 30, B.CRATE, 1); g.stack(9, 31, B.CRATE, 1);
      g.stack(27, 29, B.CRATE, 3); g.stack(28, 29, B.CRATE, 1);
      g.ruin(14, 7, 5, 3, B.BRICK);
      g.stack(24, 12, B.SAND, 2); g.stack(25, 12, B.SAND, 1);
    },
  },
  {
    name: '双子山と湖',
    theme: 'alpine',
    size: [40, 30, 40],
    seed: 29,
    water: 6,
    snowLine: 19,
    stoneLine: 14,
    start: [5, 35],
    goal: [29, 12],
    trees: 22,
    tips: [
      '雪をかぶった高い山の頂上がゴール',
      '崖は登れる。途中で右クリックすると壁ジャンプで離れる',
      '山に穴を掘って、中を登っていくのもあり（上を向いてパンチ）',
      '湖の岸を壊すと水が流れ込む',
    ],
    height(x, z, n) {
      let h = 5.5 + n(x / 11, z / 11) * 2;
      const rug = 1 + n(x / 5 + 40, z / 5) * 0.25;
      h += bump(x, z, 11, 14, 11, 7.5) * rug;
      h += bump(x, z, 29, 12, 18, 7.5) * rug;
      h += bump(x, z, 33, 33, 5, 5);
      // 2 つの山の間から南へのびる湖
      h -= bump(x, z, 20, 24, 5, 6.5) + bump(x, z, 15, 31, 3, 5);
      return h;
    },
    decorate(g) {
      g.stack(10, 33, B.CRATE, 2); g.stack(11, 33, B.CRATE, 1);
      g.ruin(24, 33, 4, 3, B.COBBLE);
      g.stack(21, 17, B.SAND, 2);
    },
  },
  {
    name: '地底の宝',
    theme: 'dusk',
    size: [40, 26, 40],
    seed: 47,
    water: 6,
    snowLine: 99,
    stoneLine: 99,
    start: [5, 35],
    goal: [22, 3, 17],
    trees: 14,
    tips: [
      'ゴールは台地の地下深く！ 光の柱の真下を目指そう',
      '下を向いてパンチで足元を掘れる。ジャンプして真下へパンチすると急降下パンチ（2 ダメージ）',
      '掘った穴の壁はよじ登って出られる',
      '横からトンネルを掘ってもいい',
    ],
    height(x, z, n) {
      let h = 6.8 + n(x / 12, z / 12) * 1.8;
      // 切り立った台地
      const dx = Math.max(13 - x, x - 30, 0), dz = Math.max(8 - z, z - 27, 0);
      const out = Math.hypot(dx, dz) + n(x / 4, z / 4 + 30) * 1.2;
      h += 9 * (1 - smooth(0, 2.2, out));
      h -= bump(x, z, 7, 12, 4.5, 5);
      h += bump(x, z, 34, 34, 3, 5);
      return h;
    },
    // 台地の中は土と石の縞（石ばかりだと掘るのが大変なので）
    layer(y, h) {
      if (y >= h - 4) return B.DIRT;
      return y % 3 === 0 ? B.STONE : B.DIRT;
    },
    decorate(g) {
      const [gx, gy, gz] = STAGES[2].goal;
      g.fill(gx - 2, gy - 1, gz - 2, gx + 2, gy - 1, gz + 2, B.COBBLE);
      g.fill(gx - 2, gy, gz - 2, gx + 2, gy + 2, gz + 2, B.AIR);
      g.stack(gx + 2, gz + 2, B.CRATE, 1, gy);
      g.stack(gx - 2, gz + 2, B.CRATE, 2, gy);
      g.ruin(8, 26, 4, 2, B.BRICK);
      g.stack(26, 34, B.CRATE, 2); g.stack(27, 34, B.CRATE, 1);
    },
  },
];

// ---------- 地形の生成 ----------
export function generateStage(stage, world) {
  const [SX, SY, SZ] = stage.size;
  world.init(SX, SY, SZ);
  const noise = makeNoise(stage.seed);
  const rnd = makeRng(stage.seed * 101 + 3);
  const W = stage.water;
  const heights = [];

  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      const h = Math.max(1, Math.min(SY - 4, Math.round(stage.height(x + 0.5, z + 0.5, noise))));
      heights[x + z * SX] = h;
      for (let y = 0; y < h; y++) {
        let t;
        if (y === h - 1) {
          if (y >= stage.snowLine) t = B.SNOW;
          else if (y >= stage.stoneLine) t = B.STONE;
          else if (y < W) t = B.SAND; // 水底は砂
          else t = B.GRASS;
        } else {
          t = stage.layer ? stage.layer(y, h) : y >= h - 4 ? (y >= stage.stoneLine ? B.STONE : B.DIRT) : B.STONE;
        }
        world.types[world.idx(x, y, z)] = t;
      }
      for (let y = h; y < W; y++) world.types[world.idx(x, y, z)] = B.WATER;
    }
  }

  // 水から 2 マス以内の低い草地は砂浜にする
  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      const y = heights[x + z * SX] - 1;
      if (y > W + 1 || world.types[world.idx(x, y, z)] !== B.GRASS) continue;
      let near = false;
      for (let dx = -2; dx <= 2 && !near; dx++) for (let dz = -2; dz <= 2 && !near; dz++) {
        near = world.get(x + dx, W - 1, z + dz) === B.WATER;
      }
      if (near) world.types[world.idx(x, y, z)] = B.SAND;
    }
  }

  const g = {
    top: (x, z) => world.surfaceTop(x, z),
    set: (x, y, z, t) => { if (world.inBounds(x, y, z)) world.types[world.idx(x, y, z)] = t; },
    fill(x0, y0, z0, x1, y1, z1, t) {
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g.set(x, y, z, t);
    },
    clearAbove(x0, y0, z0, x1, y1, z1) {
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        if (world.get(x, y, z) !== B.WATER) g.set(x, y, z, B.AIR);
      }
    },
    // 列の一番上（y を指定したらそこから）に積む
    stack(x, z, t, n, y) {
      let y0 = y ?? g.top(x, z);
      for (let i = 0; i < n; i++) g.set(x, y0++, z, t);
    },
    // 崩れかけた四角い壁
    ruin(x0, z0, w, h, t) {
      for (let x = x0; x < x0 + w; x++) {
        for (let z = z0; z < z0 + w; z++) {
          if (x !== x0 && x !== x0 + w - 1 && z !== z0 && z !== z0 + w - 1) continue;
          const top = g.top(x, z);
          const hh = Math.max(1, h - Math.floor(rnd() * 2.2));
          if (rnd() < 0.15) continue;
          for (let y = top; y < top + hh; y++) g.set(x, y, z, t);
        }
      }
    },
  };

  stage.decorate?.(g);

  // 木（スタートとゴールの近くには生やさない）
  const trees = [];
  const [sx, sz] = stage.start;
  const [gx, gz] = [stage.goal[0], stage.goal.length === 3 ? stage.goal[2] : stage.goal[1]];
  for (let tries = 0; trees.length < stage.trees && tries < 600; tries++) {
    const x = 2 + Math.floor(rnd() * (SX - 4)), z = 2 + Math.floor(rnd() * (SZ - 4));
    const top = g.top(x, z);
    if (world.get(x, top - 1, z) !== B.GRASS || top + 7 >= SY) continue;
    if (Math.hypot(x - sx, z - sz) < 4 || Math.hypot(x - gx, z - gz) < 4) continue;
    if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 4)) continue;
    trees.push([x, z]);
    const hgt = 3 + Math.floor(rnd() * 2);
    for (let y = top; y < top + hgt; y++) g.set(x, y, z, B.LOG);
    const lt = top + hgt;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy <= -1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && rnd() < 0.7) continue;
        if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
        const px = x + dx, py = lt + dy, pz = z + dz;
        if (world.get(px, py, pz) === B.AIR) g.set(px, py, pz, B.LEAVES);
      }
    }
  }

  // スタート地点の上は空けておく
  for (let y = g.top(sx, sz); y < SY; y++) g.set(sx, y, sz, B.AIR);
  world.buildAll();
}
