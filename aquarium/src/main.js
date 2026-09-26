import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TANK, shared } from './config.js';
import { buildTerrain } from './terrain.js';
import { buildPlants } from './plants.js';
import { buildTank } from './tank.js';
import { Pump } from './pump.js';
import { FishTank } from './fish.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.4, 14.5);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2.9, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 4;
controls.maxDistance = 22;
// 水槽の裏側へは回り込めないようにする
controls.minAzimuthAngle = -1.05;
controls.maxAzimuthAngle = 1.05;
controls.minPolarAngle = 0.95;
controls.maxPolarAngle = 1.72;
controls.autoRotateSpeed = 0.35;
controls.update();

// 照明
const hemi = new THREE.HemisphereLight(0xbfe8ff, 0x3a3020, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6e8, 2.6);
sun.position.set(1.5, 14, 3);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -7;
sun.shadow.camera.right = 7;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.camera.near = 5;
sun.shadow.camera.far = 18;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0x9fd0ff, 0.5);
fill.position.set(-4, 3, 10);
scene.add(fill);

buildTerrain(scene);
buildPlants(scene);
const tank = buildTank(scene);
const pump = new Pump(scene);
const fishTank = new FishTank(scene);

// ---------------------------------------------------------------- UI
const state = { pumpOn: true, pumpLevel: 1, pumpEff: 1, night: false, lightLevel: 1 };
const $ = (id) => document.getElementById(id);
$('pump-level').addEventListener('input', (e) => {
  state.pumpLevel = Number(e.target.value) / 100;
  $('pump-value').textContent = `${e.target.value}%`;
});
$('pump-toggle').addEventListener('click', (e) => {
  state.pumpOn = !state.pumpOn;
  e.currentTarget.setAttribute('aria-pressed', String(state.pumpOn));
  e.currentTarget.textContent = state.pumpOn ? 'ポンプ ON' : 'ポンプ OFF';
});
$('light-toggle').addEventListener('click', (e) => {
  state.night = !state.night;
  e.currentTarget.setAttribute('aria-pressed', String(state.night));
  e.currentTarget.textContent = state.night ? '夜モード' : '昼モード';
});
$('rotate-toggle').addEventListener('click', (e) => {
  controls.autoRotate = !controls.autoRotate;
  e.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate));
});
$('panel-toggle').addEventListener('click', () => {
  document.body.classList.toggle('panel-hidden');
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 60 : 42;
  camera.updateProjectionMatrix();
  pump.bubbles.setViewport(h * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);
resize();

const dayWater = new THREE.Color(0x1f6f78), nightWater = new THREE.Color(0x0a2a4a);
const daySun = new THREE.Color(0xfff6e8), nightSun = new THREE.Color(0x7fa6ff);

const clock = new THREE.Clock();
let time = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  time += dt;
  shared.uTime.value = time;

  // ポンプの強さは急に変えず、水流がなじむように追従させる
  const pumpTarget = state.pumpOn ? state.pumpLevel : 0;
  state.pumpEff += (pumpTarget - state.pumpEff) * Math.min(1, dt * 0.8);
  shared.uPump.value = state.pumpEff;

  const lightTarget = state.night ? 0.28 : 1;
  state.lightLevel += (lightTarget - state.lightLevel) * Math.min(1, dt * 1.5);
  const n = (1 - state.lightLevel) / 0.72;
  shared.uLightLevel.value = state.lightLevel;
  shared.uWaterColor.value.copy(dayWater).lerp(nightWater, n);
  sun.intensity = 2.6 * state.lightLevel;
  sun.color.copy(daySun).lerp(nightSun, n);
  hemi.intensity = 0.9 * (0.3 + 0.7 * state.lightLevel);
  tank.lampGlow.color.setRGB(0.95 - 0.5 * n, 0.98 - 0.4 * n, 1.0);

  fishTank.update(dt, time, state.pumpEff);
  pump.update(dt, time, state.pumpEff);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

document.body.classList.add('ready');
requestAnimationFrame(frame);

window.__aquarium = { scene, camera, controls, state, fishTank, TANK };
