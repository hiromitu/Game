import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { Goal, Checkpoint } from './markers.js';
import { STAGES, THEMES, buildStage } from './stages.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Scenery } from './scenery.js';

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
scene.fog = new THREE.Fog(0xcfe6f2, 45, 150);
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 900);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(9, 26, 12);

const scenery = new Scenery(scene);
const world = new World(scene);
const effects = new Effects(scene, world);
const sfx = new Sfx();
const input = new Input(canvas);
const goal = new Goal(scene);
let checkpoints = [];

// ---------- 画面要素 ----------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), stageNo: $('hud-stage-no'), stageName: $('hud-stage-name'),
  time: $('hud-time'), breaks: $('hud-breaks'), falls: $('hud-falls'),
  hint: $('hint'), toast: $('toast'), flash: $('flash'), help: $('help'),
  overlay: $('overlay'), stageSelect: $('stage-select'),
  clearTime: $('clear-time'), clearBreaks: $('clear-breaks'), clearFalls: $('clear-falls'), clearBest: $('clear-best'),
  clearTitle: $('clear-title'), btnNext: $('btn-next'),
  completeTime: $('complete-time'), completeBreaks: $('complete-breaks'), completeFalls: $('complete-falls'),
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
const STORE_KEY = 'punch-runner-progress';
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

const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

// ---------- ゲーム状態 ----------
const game = {
  state: 'title', stage: 0, selected: 0,
  time: 0, falls: 0, hitstop: 0, winTimer: 0,
  checkpoint: null, hint: '', toastTimer: 0,
  run: [], // 今回の挑戦で各ステージをクリアしたときの記録
};
const cam = { yaw: 0, yawTarget: 0, pitch: 0.86, dist: 14, distTarget: 14, target: new THREE.Vector3(), shake: 0 };

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
  onPunchHit: (results, point, dash) => {
    sfx.hit(results[0].obj.type.sound);
    effects.spark(point, dash);
    game.hitstop = Math.max(game.hitstop, dash ? 0.08 : 0.055);
    cam.shake = Math.max(cam.shake, dash ? 0.3 : 0.16);
  },
});

world.onBreak = (obj, dir) => {
  effects.burst(obj, dir);
  sfx.break(obj.type.sound);
  cam.shake = Math.max(cam.shake, 0.3 + Math.min(0.3, obj.size[0] * obj.size[1] * obj.size[2] * 0.05));
};
world.onLand = (obj, impact) => {
  const s = Math.min(1, impact / 14);
  const c = new THREE.Vector3((obj.min.x + obj.max.x) / 2, obj.min.y + 0.05, (obj.min.z + obj.max.z) / 2);
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
  const [x, z] = game.checkpoint ? [game.checkpoint.x, game.checkpoint.z] : STAGES[game.stage].start;
  const top = world.supportTop(x - 0.3, z - 0.3, x + 0.3, z + 0.3, Infinity);
  return new THREE.Vector3(x, (top === -Infinity ? 0 : top) + 0.01, z);
}

function loadStage(i) {
  game.stage = i;
  const st = STAGES[i];
  const theme = THEMES[st.theme];
  world.clear();
  effects.clear();
  for (const c of checkpoints) c.dispose();
  applyTheme(theme);
  buildStage(st, world, theme);
  world.settle();
  goal.place(world, st.goal[0], st.goal[1]);
  checkpoints = st.checkpoints.map(([x, z]) => new Checkpoint(scene, world, x, z));
  game.checkpoint = null;
  game.time = 0;
  game.falls = 0;
  game.hitstop = 0;
  game.hint = '';
  player.reset(spawnPoint());
  cam.yaw = cam.yawTarget = 0;
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
}

function toTitle() {
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
  showScreen('pause');
}
function resume() {
  if (game.state !== 'paused') return;
  game.state = 'play';
  showScreen(null);
}

function respawn() {
  game.falls++;
  sfx.fall();
  ui.flash.classList.remove('on');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('on');
  player.reset(spawnPoint());
  cam.target.copy(player.pos).add(new THREE.Vector3(0, 1, 0));
}

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  game.toastTimer = 1.6;
}

function win() {
  game.state = 'win';
  game.winTimer = 1.5;
  player.celebrate();
  sfx.clear();
  effects.spark(player.pos.clone().setY(player.pos.y + 1.2), true);
}

function showClear() {
  const i = game.stage;
  const breaks = world.brokenCount;
  game.run[i] = { time: game.time, breaks, falls: game.falls };
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
    ui.completeFalls.textContent = sum('falls');
    showScreen('complete');
    return;
  }
  game.state = 'clear';
  ui.clearTitle.textContent = `STAGE ${i + 1} CLEAR!`;
  ui.clearTime.textContent = fmtTime(game.time);
  ui.clearBreaks.textContent = breaks;
  ui.clearFalls.textContent = game.falls;
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
  const vals = { time: fmtTime(game.time), breaks: String(world.brokenCount), falls: String(game.falls) };
  for (const k in vals) {
    if (force || hudCache[k] !== vals[k]) ui[k].textContent = vals[k];
  }
  hudCache = vals;
}

function updateHint() {
  const z = player.pos.z;
  const h = STAGES[game.stage].hints.find((x) => z <= x.z[0] && z > x.z[1]);
  const text = h ? h.text : '';
  if (text !== game.hint) {
    game.hint = text;
    if (text) ui.hint.textContent = text;
    ui.hint.classList.toggle('show', !!text);
  }
}

// ---------- カメラ ----------
function updateCamera(dt) {
  cam.yaw += (cam.yawTarget - cam.yaw) * Math.min(1, dt * 8);
  cam.dist += (cam.distTarget - cam.dist) * Math.min(1, dt * 8);
  if (game.state === 'title') cam.yawTarget += dt * 0.12;

  const desired = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z);
  const kxz = 1 - Math.exp(-dt * 8), ky = 1 - Math.exp(-dt * 4);
  cam.target.x += (desired.x - cam.target.x) * kxz;
  cam.target.z += (desired.z - cam.target.z) * kxz;
  cam.target.y += (desired.y - cam.target.y) * ky;

  const cp = Math.cos(cam.pitch) * cam.dist;
  camera.position.set(
    cam.target.x + Math.sin(cam.yaw) * cp,
    cam.target.y + Math.sin(cam.pitch) * cam.dist,
    cam.target.z + Math.cos(cam.yaw) * cp,
  );
  camera.lookAt(cam.target);
  if (cam.shake > 0.001) {
    const s = cam.shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
    cam.shake *= Math.exp(-dt * 10);
  }

  sun.position.copy(cam.target).add(SUN_OFFSET);
  sun.target.position.copy(cam.target);
}

// カメラとキャラの間にあるオブジェクトを半透明にする
const _dir = new THREE.Vector3();
function rayHitsBox(o, d, maxT, b) {
  let t0 = 0, t1 = maxT;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return false;
      continue;
    }
    let ta = (b.min[a] - o[a]) / d[a], tb = (b.max[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t1 < t0) return false;
  }
  return true;
}
function updateOcclusion() {
  for (const o of world.objects) o.fadeTarget = 1;
  if (game.state === 'title') return;
  const from = camera.position;
  for (const h of [0.5, 1.6]) {
    _dir.set(player.pos.x - from.x, player.pos.y + h - from.y, player.pos.z - from.z);
    const len = _dir.length();
    _dir.divideScalar(len);
    for (const o of world.objects) if (rayHitsBox(from, _dir, len - 0.5, o)) o.fadeTarget = 0.25;
  }
}

// ---------- メインループ ----------
const clock = new THREE.Clock();
let elapsed = 0;

function handleKeys() {
  if (input.hit('mute')) toggleMute();
  if (input.hit('help')) ui.help.classList.toggle('collapsed');
  if (input.wheel) cam.distTarget = Math.min(24, Math.max(8, cam.distTarget + input.wheel * 0.01));
  switch (game.state) {
    case 'title':
      if (input.hit('confirm')) startStage(game.selected);
      break;
    case 'play':
      if (input.hit('pause')) pause();
      else if (input.hit('restart')) loadStage(game.stage);
      if (input.hit('camLeft')) cam.yawTarget -= Math.PI / 4;
      if (input.hit('camRight')) cam.yawTarget += Math.PI / 4;
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
    }, cam.yaw);
    world.update(dt);
    effects.update(dt);
    goal.update(dt, world, elapsed);
    for (const c of checkpoints) c.update(dt, world, elapsed);

    if (game.state === 'play') {
      game.time += rawDt;
      if (player.pos.y < -14) respawn();
      for (const c of checkpoints) {
        if (!c.active && c.contains(player.pos)) {
          c.activate();
          game.checkpoint = c;
          sfx.checkpoint();
          showToast('チェックポイント！');
        }
      }
      if (goal.contains(player.pos)) win();
      updateHint();
      updateHud();
    } else {
      game.winTimer -= rawDt;
      if (game.winTimer <= 0) showClear();
    }
  } else {
    // タイトル・ポーズ中も見た目だけは動かす
    player.animate(game.state === 'paused' ? 0 : rawDt);
    goal.update(0, world, elapsed);
    for (const c of checkpoints) c.update(0, world, elapsed);
  }

  if (game.toastTimer > 0) {
    game.toastTimer -= rawDt;
    if (game.toastTimer <= 0) ui.toast.classList.remove('show');
  }

  updateCamera(rawDt);
  updateOcclusion();
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
}

window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// デバッグ用（ブラウザのコンソールから状態を確認できる）
window.__punchRunner = { game, player, world, cam, input, tick };

toTitle();
document.body.classList.add('ready');
frame();
