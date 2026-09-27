import { OBJECT_TYPES } from './objects.js';

// ステージ定義。奥（-Z 方向）へ進む。
// 地面（floor）以外はすべて殴って壊せる。壊しても詰まないよう、ゴールは下に落ちてくる。

export const THEMES = {
  meadow: { skyTop: 0x4d9be6, skyBottom: 0xd6ecf7, fog: 0xcfe6f2, hemiSky: 0xdff1ff, hemiGround: 0x5b6b3a, sun: 0xfff1d6, floor: 'grass', clouds: 16 },
  fort:   { skyTop: 0x3f5f9e, skyBottom: 0xf4c89a, fog: 0xe8c29c, hemiSky: 0xffe2c4, hemiGround: 0x4a4038, sun: 0xffd2a1, floor: 'stone', clouds: 12 },
  sky:    { skyTop: 0x2a5bd7, skyBottom: 0xe9dcff, fog: 0xdcd6fa, hemiSky: 0xe8e4ff, hemiGround: 0x6a6a8a, sun: 0xffffff, floor: 'grass', clouds: 30 },
};

export const STAGES = [
  {
    name: 'はじまりの草原',
    theme: 'meadow',
    start: [0, 3],
    goal: [0, -46],
    checkpoints: [[0, -29]],
    hints: [
      { z: [8, -2], text: 'WASD / 矢印キーで移動　Shift を押しながらで走る　Q / E でカメラ回転' },
      { z: [-2, -7.5], text: 'J キー / 左クリックでパンチ！ 木箱を壊して進もう' },
      { z: [-7.5, -12], text: 'Space でジャンプ。低い段差は跳び越えられる' },
      { z: [-12, -18.5], text: '壁に向かって押し続けるとよじ登れる（Space で壁から跳び離れる）' },
      { z: [-18.5, -24], text: '穴は歩きジャンプでは届かない。Shift で走りながらジャンプ！' },
      { z: [-26, -33], text: '落ちてもチェックポイント（光る輪）から再開できる' },
      { z: [-40, -52], text: '光るゲートに入るとステージクリア！' },
    ],
    build(b) {
      b.floor(-4, 7, 4, -22);
      b.obj('tree', -3.2, 5);
      b.obj('bush', 3.4, 5.5);
      b.obj('rock', 3.1, 1.5);
      b.obj('bush', -3.4, -1);
      // 木箱の壁（2 段）
      for (let x = -3.5; x <= 3.5; x += 1) { b.obj('crate', x, -5); b.obj('crate', x, -5); }
      // 低い石の段
      b.row('stone', -4, 4, -10);
      // 3 段のレンガ壁
      b.wall('brick', -4, 4, -15, 3);
      b.obj('tree', -3.2, -19.5);
      b.obj('bush', 3.3, -20.5);

      // 幅 4m の穴
      b.floor(-4.5, -26, 4.5, -52);
      b.obj('barrel', -2.6, -31);
      b.obj('barrel', -1.6, -31.5);
      b.obj('barrel', 2.8, -31.8);
      b.row('fence', -4, 4, -34);
      // 木箱のピラミッド
      b.row('crate', -2, 2, -38);
      b.row('crate', -1.5, 1.5, -38);
      b.row('crate', -1, 1, -38);
      b.obj('crate', 0, -38);
      b.obj('tree', 3.6, -37);
      b.obj('tree', -3.6, -41);
      b.obj('rock', 3.4, -42);
      b.stack('crate', -3.5, -44.5, 2);
      b.obj('bush', 3.6, -48.5);
      b.obj('tree', -3.4, -50);
    },
  },
  {
    name: '石の砦',
    theme: 'fort',
    start: [0, 4],
    goal: [0, -67],
    checkpoints: [[0, -26.5], [0, -47]],
    hints: [
      { z: [8, -6], text: '門の大きな木箱を壊すか、石壁をよじ登って砦に入ろう（走りながらのパンチは 2 倍の威力）' },
      { z: [-24, -31], text: '浮かぶ足場を跳び移ろう（足場も壊せるので注意）' },
      { z: [-60, -76], text: 'ゴールは石の台の上！' },
    ],
    build(b) {
      b.floor(-6, 7, 6, -30);
      b.obj('rock', -4.6, 4.5);
      b.obj('rock', 4.8, 2.2);
      b.obj('bush', -5, 0.5);
      b.obj('barrel', 3.2, -5.5);
      b.obj('barrel', 4.1, -6);
      // 正面の城壁（4 段）と、大きな木箱の門
      b.wall('fortWall', -6, -1, -8, 4);
      b.wall('fortWall', 1, 6, -8, 4);
      b.stack('bigCrate', 0, -8.5, 2);
      // 中庭
      for (const [x, z] of [[-4.5, -12], [4.5, -12], [-4.5, -19], [4.5, -19]]) b.obj('pillar', x, z);
      b.obj('barrel', -2, -13);
      b.obj('barrel', -1.1, -13.6);
      b.obj('barrel', -2.3, -14.3);
      b.stack('crate', 2.5, -15, 3);
      b.stack('crate', 1.5, -15, 2);
      b.obj('crate', 3.5, -16);
      b.obj('stone', -1, -18);
      b.stack('stone', -2, -18, 2);
      // 内側の城壁（3 段）と、脇の石段
      b.wall('fortWall', -6, 6, -22.5, 3);
      b.obj('stone', 5.5, -20.5);
      b.stack('stone', 5.5, -21.5, 2);
      b.obj('barrel', -3.5, -26);
      b.row('fence', -6, -2, -28);

      // 穴の上の浮き足場（固定）
      b.obj('platform', 0, -33, { y: 0 });
      b.obj('platform', 2.2, -37, { y: 0.5 });
      b.obj('platform', -0.5, -41, { y: 1 });

      b.floor(-6, -44, 6, -76);
      b.obj('rock', 4.6, -45.5);
      b.obj('bush', -5, -46);
      // 迷路のようなレンガ壁。抜け道は木箱でふさがっている
      b.wall('brick', -6, 2, -51, 2);
      b.row('crate', 2, 6, -51);
      b.row('crate', 2, 6, -51);
      b.wall('brick', -2, 6, -57, 2);
      b.row('crate', -6, -2, -57);
      b.row('crate', -6, -2, -57);
      b.obj('barrel', -4, -61);
      b.obj('barrel', 4.2, -62);
      // ゴールの石の台（2 段）
      for (let x = -1.5; x <= 1.5; x++) for (let z = -65.5; z >= -68.5; z--) b.stack('stone', x, z, 2);
      b.obj('pillar', -4.5, -70);
      b.obj('pillar', 4.5, -70);
    },
  },
  {
    name: '天空の回廊',
    theme: 'sky',
    start: [0, 3],
    goal: [0, -54],
    checkpoints: [[0, -22.8], [0, -33], [0, -40.5]],
    hints: [
      { z: [8, -9], text: '浮き足場を渡って空の回廊へ' },
      { z: [-28, -39], text: '大きな谷は助走をつけて大ジャンプ！（Shift + Space）' },
      { z: [-48, -60], text: '塔を登ってゴールへ！' },
    ],
    build(b) {
      b.floor(-4, 6, 4, -8);
      b.obj('tree', -3, 4);
      b.obj('bush', 3.2, 4.5);
      b.obj('tree', 3, -6.2);
      b.obj('crate', -3.4, -6.8);

      b.obj('platform', 0, -11, { y: 0 });
      b.obj('platform', 2.6, -15, { y: 0.5 });
      b.obj('platform', 0, -19, { y: 1 });

      // 一段高い島
      b.floor(-5, -21.5, 5, -34.5, 1);
      for (const [x, z] of [[-3.5, -24.5], [3.5, -24.5], [0, -27], [-3.5, -29]]) b.obj('pillar', x, z);
      b.stack('crate', 2.5, -28.5, 2);
      b.obj('barrel', 3.8, -29.3);
      // 5 段の大城壁
      b.wall('fortWall', -5, 5, -31, 5);

      // 5m の谷（走りジャンプが必要）
      b.floor(-4, -39.5, 4, -60, 1);
      b.obj('bush', 3.3, -41);
      b.row('fence', -4, 4, -43);
      b.obj('barrel', -2.5, -45.5);
      b.obj('barrel', 2, -46.5);
      b.row('fence', -4, 4, -48.5);
      b.obj('tree', -3.3, -52);
      b.obj('tree', 3.3, -56.5);
      // ゴールの塔：大きな木箱 2 段 + 木箱
      b.stack('bigCrate', 0, -54, 2);
      b.obj('crate', 0, -54);
      // 塔の横に階段がわりの木箱
      b.stack('crate', -1.5, -54, 2);
    },
  },
];

// ステージ定義の build(b) から呼ばれる配置ヘルパー
export function buildStage(stage, world, theme) {
  const obj = (type, x, z, opts) => world.addObject(type, x, z, opts);
  const b = {
    floor(x0, z0, x1, z1, top = 0) {
      world.addFloor(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), top, theme.floor);
    },
    obj,
    stack(type, x, z, n, opts) {
      for (let i = 0; i < n; i++) obj(type, x, z, opts);
    },
    // x0..x1 を種類の幅で埋める
    row(type, x0, x1, z, opts) {
      const w = OBJECT_TYPES[type].size[0];
      for (let x = x0 + w / 2; x <= x1 - w / 2 + 1e-6; x += w) obj(type, x, z, opts);
    },
    // 2m のブロックを互い違いに積んだ壁
    wall(type, x0, x1, z, rows) {
      for (let r = 0; r < rows; r++) {
        let x = x0;
        const place = (len) => { obj(type, x + len / 2, z, { size: [len, 1, 1] }); x += len; };
        if (r % 2 === 1) place(1);
        while (x + 2 <= x1 + 1e-6) place(2);
        if (x < x1 - 1e-6) place(x1 - x);
      }
    },
  };
  stage.build(b);
}
