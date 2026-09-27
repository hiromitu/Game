import * as THREE from 'three';
import { VoxelWorld } from './world.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { Goal } from './markers.js';
import { STAGES, THEMES, generateStage } from './stages.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Scenery } from './scenery.js';
import { B } from './blocks.js';

// ---------- レンダラー・シーン ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe6f2, 70, 220);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 100 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(9, 26, 12);

const scenery = new Scenery(scene);
const world = new VoxelWorld(scene);
const effects = new Effects(scene, world);
const sfx = new Sfx();
const input = new Input(canvas);
const goal = new Goal(scene);

// ステージの立方体の枠と土台
const cubeFrame = new THREE.Group();
scene.add(cubeFrame);
function buildCubeFrame(SX, SY, SZ) {
  cubeFrame.traverse((o) => { o.geometry?.dispose(); });
  cubeFrame.clear();
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(SX, SY, SZ)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  edges.position.set(SX / 2, SY / 2, SZ / 2);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(SX + 0.8, 1.4, SZ + 0.8),
    new THREE.MeshStandardMaterial({ color: 0x3a3440, roughness: 0.9 }),
  );
  base.position.set(SX / 2, -0.7, SZ / 2);
  base.receiveShadow = true;
  cubeFrame.add(edges, base);
}

// ---------- 画面要素 ----------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), stageNo: $('hud-stage-no'), stageName: $('hud-stage-name'),
  time: $('hud-time'), breaks: $('hud-breaks'), height: $('hud-height'),
  crosshair: $('crosshair'), lockHint: $('lock-hint'), sens: $('sens'), sensValue: $('sens-value'),
  hint: $('hint'), toast: $('toast'), flash: $('flash'), help: $('help'),
  overlay: $('overlay'), stageSelect: $('stage-select'),
  clearTime: $('clear-time'), clearBreaks: $('clear-breaks'), clearBest: $('clear-best'),
  clearTitle: $('clear-title'), btnNext: $('btn-next'),
  completeTime: $('complete-time'), completeBreaks: $('complete-breaks'),
  mute: $('btn-mute'),
};
const screens = ['title', 'pause', 'clear', 'complete'];

function showScreen(name) {
  ui.overlay.classList.toggle('show', !!name);
  document.body.classList.toggle('menu', !!name);
  for (const s of screens) $('screen-' + s).hidden = s !== name;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

// ---------- 記録（localStorage が使えなくても動く） ----------
const STORE_KEY = 'punch-runner-progress-v2';
function loadProgress() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (v && typeof v.unlocked === 'number' && Array.isArray(v.best)) return v;
  } catch { /* 読めなければ初期値 */ }
  return { unlocked: 0, best: [] };
}
function saveProgress() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch { /* 保存できなくても続行 */ }
}
const progress = loadProgress();

const SETTINGS_KEY = 'punch-runner-settings';
const settings = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (v && typeof v.sens === 'number') return v;
  } catch { /* 読めなければ初期値 */ }
  return { sens: 1 };
})();
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 保存できなくても続行 */ }
}

const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

// ---------- ゲーム状態 ----------
const game = {
  state: 'title', stage: 0, selected: 0,
  time: 0, hitstop: 0, winTimer: 0,
  hint: '', tip: 0, tipTimer: 0, toastTimer: 0,
  run: [], // 今回の挑戦で各ステージをクリアしたときの記録
};
// プレイ中：キャラの後ろから、マウスで決めた向き（yaw / pitch）を見るカメラ
// タイトル：立方体のまわりをゆっくり回る
const cam = {
  yaw: Math.PI, pitch: -0.25, dist: 5, distTarget: 5, curDist: 5,
  orbit: 0, target: new THREE.Vector3(), shake: 0,
};
const PITCH_MIN = -1.45, PITCH_MAX = 1.25;
const REACH = 3.2; // パンチが届く距離（頭から）

const player = new Player(scene, world, {
  onJump: () => sfx.jump(),
  onLand: (speed) => {
    const s = Math.min(1, speed / 16);
    sfx.land(0.5 + s);
    effects.dust(player.pos.clone().setY(player.pos.y + 0.05), s);
  },
  onGrab: () => sfx.grab(),
  onMantle: () => sfx.grab(),
  onSwing: (dash) => sfx.swing(dash),
  onSplash: (speed) => {
    sfx.splash(Math.min(1, speed / 12));
    effects.splash(player.pos.clone().setY(player.pos.y + 0.8), Math.min(1, speed / 12));
  },
  onPound: (results, point) => {
    sfx.pound();
    if (results[0]) sfx.hit(results[0].def.sound);
    effects.dust(point, 1);
    game.hitstop = Math.max(game.hitstop, 0.08);
    cam.shake = Math.max(cam.shake, 0.45);
  },
  onPunchHit: (results, point, dash) => {
    sfx.hit(results[0].def.sound);
    effects.spark(point, dash);
    game.hitstop = Math.max(game.hitstop, dash ? 0.08 : 0.055);
    cam.shake = Math.max(cam.shake, dash ? 0.3 : 0.16);
  },
});

world.onBreak = ({ x, y, z, def, dir }) => {
  effects.burstBlock(x, y, z, def, dir);
  sfx.break(def.sound);
  cam.shake = Math.max(cam.shake, 0.3);
};
// 砂や木箱が落ちて着地した
world.onLand = ({ x, y, z, impact }) => {
  const s = Math.min(1, impact / 14);
  const c = new THREE.Vector3(x + 0.5, y + 0.05, z + 0.5);
  const near = c.distanceTo(player.pos) < 14;
  if (near) sfx.thud(s);
  effects.dust(c, s);
  if (near) cam.shake = Math.max(cam.shake, 0.12 * s);
};

// ---------- ステージ ----------
function applyTheme(theme) {
  scenery.applyTheme(theme);
  scene.fog.color.set(theme.fog);
  hemi.color.set(theme.hemiSky);
  hemi.groundColor.set(theme.hemiGround);
  sun.color.set(theme.sun);
}

function spawnPoint() {
  const [x, z] = STAGES[game.stage].start;
  return new THREE.Vector3(x + 0.5, world.surfaceTop(x, z) + 0.01, z + 0.5);
}

function loadStage(i) {
  game.stage = i;
  const st = STAGES[i];
  const theme = THEMES[st.theme];
  effects.clear();
  applyTheme(theme);
  generateStage(st, world);
  buildCubeFrame(world.SX, world.SY, world.SZ);
  // goal は [x, z]（地表に置く）か [x, y, z]（地中など高さを指定）
  const [gx, a, b] = st.goal;
  if (b === undefined) goal.place(world, gx + 0.5, a + 0.5);
  else goal.place(world, gx + 0.5, b + 0.5, a);
  game.time = 0;
  game.hitstop = 0;
  game.hint = '';
  game.tip = 0;
  game.tipTimer = 0;
  player.reset(spawnPoint());
  cam.yaw = Math.atan2(goal.x - player.pos.x, goal.z - player.pos.z);
  cam.pitch = -0.25;
  cam.curDist = cam.distTarget;
  player.facing = cam.yaw;
  cam.target.copy(player.pos).add(new THREE.Vector3(0, 1, 0));
  ui.stageNo.textContent = `STAGE ${i + 1}`;
  ui.stageName.textContent = st.name;
  ui.hint.classList.remove('show');
  updateHud(true);
}

function startStage(i) {
  sfx.unlock();
  if (game.state === 'title') game.run = [];
  loadStage(i);
  game.state = 'play';
  ui.hud.hidden = false;
  showScreen(null);
  input.lock();
}

function toTitle() {
  input.unlock();
  game.state = 'title';
  ui.hud.hidden = true;
  ui.hint.classList.remove('show');
  renderStageSelect();
  loadStage(game.selected);
  showScreen('title');
}

function pause() {
  if (game.state !== 'play') return;
  game.state = 'paused';
  input.unlock();
  showScreen('pause');
}
function resume() {
  if (game.state !== 'paused') return;
  game.state = 'play';
  showScreen(null);
  input.lock();
}

// Esc などでマウスのロックが外れたらポーズする
input.onLockChange = (locked) => {
  if (!locked && game.state === 'play') pause();
  updateLockUi();
};
function updateLockUi() {
  const playing = game.state === 'play' || game.state === 'win';
  ui.crosshair.hidden = !(playing && input.locked);
  ui.lockHint.hidden = !(game.state === 'play' && !input.locked);
}
// ロックが取れなかったときは、画面をクリックして取り直す
canvas.addEventListener('mousedown', () => { if (game.state === 'play' && !input.locked) input.lock(); });

// 念のため：立方体の外へ出てしまったらスタートに戻す
function respawn() {
  sfx.fall();
  ui.flash.classList.remove('on');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('on');
  player.reset(spawnPoint());
  cam.target.copy(player.pos).add(new THREE.Vector3(0, 1, 0));
}

function win() {
  game.state = 'win';
  game.winTimer = 1.5;
  player.celebrate();
  sfx.clear();
  effects.spark(player.pos.clone().setY(player.pos.y + 1.2), true);
}

function showClear() {
  input.unlock();
  const i = game.stage;
  const breaks = world.brokenCount;
  game.run[i] = { time: game.time, breaks };
  const prevBest = progress.best[i];
  const isBest = prevBest == null || game.time < prevBest;
  if (isBest) progress.best[i] = game.time;
  progress.unlocked = Math.max(progress.unlocked, Math.min(STAGES.length - 1, i + 1));
  saveProgress();

  const last = i === STAGES.length - 1;
  if (last) {
    game.state = 'complete';
    const sum = (k) => game.run.reduce((a, r) => a + (r ? r[k] : 0), 0);
    ui.completeTime.textContent = fmtTime(sum('time'));
    ui.completeBreaks.textContent = sum('breaks');
    showScreen('complete');
    return;
  }
  game.state = 'clear';
  ui.clearTitle.textContent = `STAGE ${i + 1} CLEAR!`;
  ui.clearTime.textContent = fmtTime(game.time);
  ui.clearBreaks.textContent = breaks;
  ui.clearBest.textContent = isBest ? '新記録！' : fmtTime(prevBest);
  showScreen('clear');
}

function renderStageSelect() {
  ui.stageSelect.replaceChildren();
  STAGES.forEach((st, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage-btn';
    const locked = i > progress.unlocked;
    b.disabled = locked;
    b.setAttribute('aria-pressed', String(i === game.selected));
    const best = progress.best[i];
    b.innerHTML = `<span class="no">STAGE ${i + 1}</span><span class="nm">${locked ? '？？？' : st.name}</span>`
      + `<span class="bt">${best != null ? 'ベスト ' + fmtTime(best) : locked ? 'ロック中' : '—'}</span>`;
    b.addEventListener('click', () => {
      game.selected = i;
      renderStageSelect();
      loadStage(i);
    });
    ui.stageSelect.append(b);
  });
}

let hudCache = {};
function updateHud(force = false) {
  const vals = { time: fmtTime(game.time), breaks: String(world.brokenCount), height: `${Math.max(0, Math.floor(player.pos.y))}m` };
  for (const k in vals) {
    if (force || hudCache[k] !== vals[k]) ui[k].textContent = vals[k];
  }
  hudCache = vals;
}

// ステージのヒントを順番に表示する（2 周したら消す）。水中では泳ぎ方を出す
const TIP_TIME = 7;
function updateHint(dt) {
  const tips = STAGES[game.stage].tips;
  game.tipTimer += dt;
  if (game.tipTimer > TIP_TIME) {
    game.tipTimer = 0;
    game.tip++;
  }
  let text = game.tip < tips.length * 2 ? tips[game.tip % tips.length] : '';
  if (player.inWater) text = '右クリック長押しで浮上。岸に向かって進むと登れる';
  if (text !== game.hint) {
    game.hint = text;
    if (text) ui.hint.textContent = text;
    ui.hint.classList.toggle('show', !!text);
  }
}

// ---------- カメラ ----------
const _dir = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _right = new THREE.Vector3();

// マウスの移動量でキャラの向き（左右・上下）を変える
function updateLook() {
  if (!input.locked) return;
  const k = 0.0024 * settings.sens;
  cam.yaw -= input.lookX * k;
  cam.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, cam.pitch - input.lookY * k));
}

function lookDir(out) {
  const cp = Math.cos(cam.pitch);
  return out.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
}

// その点がブロックの中か（カメラのめり込み判定。立方体の外は空いているものとする）
function blockedAt(x, y, z) {
  if (y < 0) return true;
  const t = world.get(Math.floor(x), Math.floor(y), Math.floor(z));
  return t > 0 && t !== B.WATER;
}

function updateCamera(dt) {
  if (game.state === 'title') {
    // 立方体全体を見せる
    cam.orbit += dt * 0.12;
    const dist = Math.max(world.SX, world.SZ) * 1.05;
    const c = new THREE.Vector3(world.SX / 2, world.SY * 0.2, world.SZ / 2);
    camera.position.set(c.x + Math.sin(cam.orbit) * Math.cos(0.62) * dist, c.y + Math.sin(0.62) * dist, c.z + Math.cos(cam.orbit) * Math.cos(0.62) * dist);
    camera.lookAt(c);
    player.model.root.visible = true;
    sun.position.copy(c).add(SUN_OFFSET);
    sun.target.position.copy(c);
    return;
  }

  // 肩越し（右肩）の少し後ろ。真上・真下を向くときは肩のずれをなくす
  lookDir(_dir);
  _right.set(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw));
  const shoulder = 0.8 * Math.max(0, 1 - Math.abs(cam.pitch) / 1.2);
  const ky = 1 - Math.exp(-dt * 14);
  cam.target.x = player.pos.x;
  cam.target.z = player.pos.z;
  cam.target.y += (player.pos.y + 1.75 - cam.target.y) * ky; // 段差を登るときにカメラが跳ねないよう高さだけなめらかに
  _pivot.copy(cam.target).addScaledVector(_right, shoulder);

  // 後ろにブロックがあればカメラを手前に寄せる
  cam.dist += (cam.distTarget - cam.dist) * Math.min(1, dt * 8);
  let free = cam.dist;
  for (let t = 0.3; t <= cam.dist; t += 0.1) {
    if (blockedAt(_pivot.x - _dir.x * t, _pivot.y - _dir.y * t, _pivot.z - _dir.z * t)) { free = Math.max(0.35, t - 0.3); break; }
  }
  cam.curDist = free < cam.curDist ? free : cam.curDist + (free - cam.curDist) * Math.min(1, dt * 5);
  camera.position.copy(_pivot).addScaledVector(_dir, -cam.curDist);
  camera.lookAt(_pivot.x + _dir.x * 10, _pivot.y + _dir.y * 10, _pivot.z + _dir.z * 10);
  player.model.root.visible = cam.curDist > 1.1; // 近すぎるとキャラで画面がふさがるので隠す

  if (cam.shake > 0.001) {
    const sh = cam.shake * 0.12;
    camera.position.x += (Math.random() - 0.5) * sh;
    camera.position.y += (Math.random() - 0.5) * sh;
    camera.position.z += (Math.random() - 0.5) * sh;
    cam.shake *= Math.exp(-dt * 10);
  }

  sun.position.copy(player.pos).add(SUN_OFFSET);
  sun.target.position.copy(player.pos);
}

// 画面中央（照準）の先にあるブロックを探す。頭から REACH 以内のものだけ
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)),
  new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }),
);
highlight.visible = false;
scene.add(highlight);

function updateAim() {
  const aim = player.aim;
  aim.yaw = cam.yaw;
  aim.pitch = cam.pitch;
  const d = lookDir(aim.dir);
  const head = new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z);
  const rel = head.clone().sub(camera.position);
  const t0 = Math.max(0, rel.dot(d) - 0.6);
  const origin = camera.position.clone().addScaledVector(d, t0);
  const hit = world.raycast(origin, d, REACH + 0.6);
  let ok = false;
  if (hit) {
    const center = new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    ok = center.distanceTo(head) <= REACH + 0.5;
  }
  aim.target = ok ? hit : null;

  // 真下／真上を向いたときは、足元・頭上のブロックを狙う（掘り下げ・掘り上げがしやすいように）
  if (cam.pitch < -1.1 && (player.grounded || player.state === 'ground')) {
    const c = player.cellUnderFeet();
    if (c) { aim.target = { x: c[0], y: c[1], z: c[2], normal: [0, 1, 0] }; ok = true; }
  } else if (cam.pitch > 1.0) {
    const x = Math.floor(player.pos.x), y = Math.floor(player.pos.y + 2.1), z = Math.floor(player.pos.z);
    const t = world.get(x, y, z);
    if (t > 0 && t !== B.WATER) { aim.target = { x, y, z, normal: [0, -1, 0] }; ok = true; }
  }
  const cell = aim.target;
  highlight.visible = ok && game.state === 'play';
  if (ok) highlight.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
}

// カメラとキャラを結ぶ線のまわりの地形を描かないようにする（山の陰や穴の中でもキャラが見える）
function updateCutaway() {
  const u = world.cutUniforms;
  const on = game.state === 'play' || game.state === 'win' || game.state === 'paused';
  u.uCutR.value = on ? 1.2 : 0;
  u.uCutPlayer.value.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
  u.uCutCam.value.copy(camera.position);
}

// ---------- メインループ ----------
const clock = new THREE.Clock();
let elapsed = 0;

function handleKeys() {
  if (input.hit('mute')) toggleMute();
  if (input.hit('help')) ui.help.classList.toggle('collapsed');
  if (input.wheel) cam.distTarget = Math.min(9, Math.max(2.5, cam.distTarget + input.wheel * 0.004));
  switch (game.state) {
    case 'title':
      if (input.hit('confirm')) startStage(game.selected);
      break;
    case 'play':
      if (input.hit('pause')) pause();
      else if (input.hit('restart')) loadStage(game.stage);
      break;
    case 'paused':
      if (input.hit('pause') || input.hit('confirm')) resume();
      break;
    case 'clear':
      if (input.hit('confirm')) startStage(game.stage + 1);
      break;
    case 'complete':
      if (input.hit('confirm')) toTitle();
      break;
  }
}

function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(clock.getDelta(), 1 / 20));
}

function tick(rawDt) {
  elapsed += rawDt;
  handleKeys();

  if (game.state === 'play') updateLook();
  if (game.state === 'play' || game.state === 'win') {
    let dt = rawDt;
    if (game.hitstop > 0) { // ヒットストップ：当たった瞬間だけ時間をほぼ止める
      game.hitstop -= rawDt;
      dt = rawDt * 0.08;
    }
    player.update(dt, {
      x: input.x, y: input.y, run: input.held('run'),
      jumpPressed: input.hit('jump'), jumpHeld: input.held('jump'),
      punchPressed: input.hit('punch'),
    });
    world.update(dt);
    effects.update(dt);
    goal.update(dt, world, elapsed);

    if (game.state === 'play') {
      game.time += rawDt;
      if (player.pos.y < -2) respawn();
      if (goal.contains(player.pos)) win();
      updateHint(rawDt);
      updateHud();
    } else {
      game.winTimer -= rawDt;
      if (game.winTimer <= 0) showClear();
    }
  } else {
    // タイトル・ポーズ中も見た目だけは動かす
    player.animate(game.state === 'paused' ? 0 : rawDt);
    goal.update(0, world, elapsed);
  }

  if (game.toastTimer > 0) {
    game.toastTimer -= rawDt;
    if (game.toastTimer <= 0) ui.toast.classList.remove('show');
  }

  updateCamera(rawDt);
  updateAim();
  updateCutaway();
  updateLockUi();
  scenery.update(rawDt, camera);
  renderer.render(scene, camera);
  input.endFrame();
}

// ---------- ボタン ----------
function toggleMute() {
  sfx.setMuted(!sfx.muted);
  ui.mute.textContent = sfx.muted ? '音 OFF' : '音 ON';
  ui.mute.setAttribute('aria-pressed', String(!sfx.muted));
}
$('btn-start').addEventListener('click', () => startStage(game.selected));
$('btn-resume').addEventListener('click', resume);
$('btn-restart').addEventListener('click', () => startStageKeepRun(game.stage));
$('btn-title').addEventListener('click', toTitle);
$('btn-next').addEventListener('click', () => startStage(game.stage + 1));
$('btn-retry').addEventListener('click', () => startStageKeepRun(game.stage));
$('btn-again').addEventListener('click', toTitle);
$('btn-pause').addEventListener('click', (e) => { e.currentTarget.blur(); pause(); });
ui.mute.addEventListener('click', (e) => { e.currentTarget.blur(); sfx.unlock(); toggleMute(); });
$('btn-help').addEventListener('click', (e) => { e.currentTarget.blur(); ui.help.classList.toggle('collapsed'); });

function startStageKeepRun(i) {
  sfx.unlock();
  loadStage(i);
  game.state = 'play';
  ui.hud.hidden = false;
  showScreen(null);
  input.lock();
}

// マウス感度（ポーズ画面）
ui.sens.value = String(settings.sens);
ui.sensValue.textContent = `${settings.sens.toFixed(1)}x`;
ui.sens.addEventListener('input', () => {
  settings.sens = Number(ui.sens.value);
  ui.sensValue.textContent = `${settings.sens.toFixed(1)}x`;
  saveSettings();
});

window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// デバッグ用（ブラウザのコンソールから状態を確認できる）
window.__punchRunner = { game, player, world, cam, input, tick, camera };

toTitle();
document.body.classList.add('ready');
frame();
