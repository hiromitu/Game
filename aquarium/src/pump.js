import * as THREE from 'three';
import { TANK, PUMP, sandHeight, makeRng } from './config.js';
import { NOISE_GLSL, WATER_GLSL, waterUniforms, flowAt } from './shaders.js';
import { obstacles } from './terrain.js';

// 外掛けフィルター本体・吸水パイプ・落水・泡をまとめて管理する
export class Pump {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildHousing();
    this.buildIntake();
    this.buildStream();
    this.buildFoam();
    this.bubbles = new BubbleSystem(this.group);
  }

  buildHousing() {
    const plastic = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.45, metalness: 0.1 });
    const lid = new THREE.MeshStandardMaterial({ color: 0x3b4247, roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.1, 0.75), plastic);
    body.position.set(4.6, 5.85, TANK.minZ - 0.45);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 0.85), lid);
    top.position.set(4.6, 6.95, TANK.minZ - 0.45);
    this.group.add(body, top);

    // 吐出口のトレイ（水槽の縁をまたいで手前へ張り出す）
    const w = PUMP.width + 0.1;
    const trayLen = PUMP.lip.z - (TANK.minZ - 0.1);
    const trayZ = (PUMP.lip.z + TANK.minZ - 0.1) / 2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, trayLen), plastic);
    floor.position.set(PUMP.lip.x, PUMP.lip.y - 0.03, trayZ);
    const wallGeo = new THREE.BoxGeometry(0.04, 0.2, trayLen);
    const wl = new THREE.Mesh(wallGeo, plastic);
    wl.position.set(PUMP.lip.x - w / 2, PUMP.lip.y + 0.07, trayZ);
    const wr = wl.clone();
    wr.position.x = PUMP.lip.x + w / 2;
    this.group.add(floor, wl, wr);

    // トレイ上を流れる水
    this.trayWater = new THREE.Mesh(
      new THREE.PlaneGeometry(PUMP.width, trayLen - 0.05),
      new THREE.MeshStandardMaterial({ color: 0xbfe6f0, transparent: true, opacity: 0.55, roughness: 0.1 }),
    );
    this.trayWater.rotation.x = -Math.PI / 2;
    this.trayWater.position.set(PUMP.lip.x, PUMP.lip.y + 0.005, trayZ);
    this.group.add(this.trayWater);
  }

  buildIntake() {
    const x = 5.45, z = -1.3;
    const bottom = sandHeight(x, z) + 0.45;
    const path = new THREE.CurvePath();
    const p0 = new THREE.Vector3(x, bottom + 0.55, z);
    const p1 = new THREE.Vector3(x, 6.35, z);
    const p2 = new THREE.Vector3(x, 6.6, z - 0.3);
    const p3 = new THREE.Vector3(x, 6.6, TANK.minZ - 0.15);
    const p4 = new THREE.Vector3(x, 6.35, TANK.minZ - 0.4);
    path.add(new THREE.LineCurve3(p0, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, new THREE.Vector3(x, 6.6, z), p2));
    path.add(new THREE.LineCurve3(p2, p3));
    path.add(new THREE.QuadraticBezierCurve3(p3, new THREE.Vector3(x, 6.6, TANK.minZ - 0.4), p4));
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x9fbfb0, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0,
    });
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(path, 80, 0.065, 12, false), pipeMat);
    this.group.add(pipe);

    // ストレーナー（縦スリット入り）
    const c = document.createElement('canvas');
    c.width = 64; c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#6f8a7e'; g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#10181a';
    for (let i = 0; i < 16; i++) g.fillRect(i * 4 + 1, 2, 2, 12);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const strainer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.6, 16),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }),
    );
    strainer.position.set(x, bottom + 0.25, z);
    this.group.add(strainer);
    obstacles.push({ center: new THREE.Vector3(x, 3.5, z), radius: new THREE.Vector3(0.3, 3.2, 0.3) });
  }

  // 吐出口から放物線を描いて水面へ落ちる水の膜
  buildStream() {
    const along = 28, across = 10;
    const verts = [], uvs = [], idx = [];
    const fallH = PUMP.lip.y - TANK.waterY + 0.08;
    const g = 9.0;
    const tFall = Math.sqrt((2 * fallH) / g);
    const vz = (PUMP.impact.z - PUMP.lip.z) / tFall;
    for (let i = 0; i <= along; i++) {
      const u = i / along;
      const t = u * tFall;
      const y = PUMP.lip.y - 0.5 * g * t * t;
      const z = PUMP.lip.z + vz * t;
      const width = PUMP.width * (1 - 0.18 * u);
      for (let j = 0; j <= across; j++) {
        const v = j / across;
        const s = v * 2 - 1;
        const bulge = 0.035 * (1 - s * s);
        verts.push(PUMP.lip.x + s * width / 2, y, z + bulge);
        uvs.push(v, u);
        if (i < along && j < across) {
          const a = i * (across + 1) + j;
          idx.push(a, a + across + 1, a + 1, a + 1, a + across + 1, a + across + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);

    this.streamMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms({ uFlow: { value: 1 } }),
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${WATER_GLSL}
        ${NOISE_GLSL}
        uniform float uFlow;
        varying vec2 vUv;
        varying vec3 vWPos;
        void main() {
          float scroll = uTime * 3.2;
          float streak = vnoise(vec2(vUv.x * 22.0, vUv.y * 3.0 - scroll));
          streak = streak * 0.6 + 0.4 * vnoise(vec2(vUv.x * 55.0, vUv.y * 7.0 - scroll * 1.4));
          float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
          float breakup = smoothstep(0.25, 0.6, vnoise(vec2(vUv.x * 9.0, vUv.y * 2.0 - scroll)) + (1.0 - vUv.y) * 0.5);
          float a = (0.25 + 0.55 * streak) * edge * mix(1.0, breakup, vUv.y * 0.7) * clamp(uFlow, 0.0, 1.0);
          vec3 col = mix(vec3(0.55, 0.78, 0.86), vec3(1.0), smoothstep(0.45, 0.9, streak));
          col *= uLightLevel;
          col = applyWater(col, vWPos);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.stream = new THREE.Mesh(geo, this.streamMat);
    this.stream.renderOrder = 3;
    this.group.add(this.stream);
  }

  // 落水点の白い泡立ち
  buildFoam() {
    this.foamMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms({ uFlow: { value: 1 } }),
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${WATER_GLSL}
        ${NOISE_GLSL}
        uniform float uFlow;
        varying vec2 vUv;
        varying vec3 vWPos;
        void main() {
          vec2 c = vUv * 2.0 - 1.0;
          c.x *= 0.8;
          float r = length(c);
          float ang = atan(c.y, c.x);
          float n = vnoise(vec2(ang * 3.0, r * 6.0 - uTime * 2.5)) * 0.6
                  + vnoise(c * 9.0 + uTime * 1.3) * 0.4;
          float a = smoothstep(1.0, 0.1, r + (n - 0.5) * 0.5) * (0.35 + 0.65 * n);
          a *= clamp(uFlow, 0.0, 1.0) * 0.85;
          vec3 col = vec3(0.92, 0.97, 1.0) * uLightLevel;
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.4), this.foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(PUMP.impact.x, TANK.waterY + 0.012, PUMP.impact.z + 0.1);
    foam.renderOrder = 4;
    this.group.add(foam);
  }

  update(dt, t, pump) {
    const on = Math.min(pump, 1);
    this.streamMat.uniforms.uFlow.value = on;
    this.foamMat.uniforms.uFlow.value = on * Math.min(pump, 1.3);
    this.stream.visible = pump > 0.01;
    this.trayWater.material.opacity = 0.55 * on;
    this.trayWater.visible = pump > 0.01;
    this.bubbles.update(dt, t, pump);
  }
}

const bubbleVS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vAlpha = aAlpha;
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const bubbleFS = /* glsl */ `
${WATER_GLSL}
varying float vAlpha;
varying vec3 vWPos;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0 || vAlpha <= 0.0) discard;
  float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float hl = smoothstep(0.38, 0.0, length(c - vec2(-0.35, -0.38)));
  float a = (rim * 0.75 + hl * 0.95 + 0.07) * vAlpha;
  vec3 col = vec3(0.85, 0.95, 1.0) * (0.6 + 0.4 * uLightLevel);
  float fog = 1.0 - exp(-waterPath(vWPos) * uWaterDensity);
  col = mix(col, uWaterColor * uLightLevel, fog * 0.8);
  gl_FragColor = vec4(col, a * (1.0 - fog * 0.5));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// 落水で巻き込まれた泡と、水面から跳ねる飛沫
class BubbleSystem {
  constructor(parent) {
    this.max = 3000;
    this.rng = makeRng(99);
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.size = new Float32Array(this.max);
    this.alpha = new Float32Array(this.max);
    this.life = new Float32Array(this.max);
    this.kind = new Uint8Array(this.max); // 0: 空き, 1: 泡, 2: 飛沫
    this.wob = new Float32Array(this.max);
    this.render = new Float32Array(this.max * 3);
    this.spawnAcc = 0;
    this.dropAcc = 0;
    this.free = [];
    for (let i = this.max - 1; i >= 0; i--) this.free.push(i);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.render, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: waterUniforms({ uScale: { value: 800 } }),
      vertexShader: bubbleVS,
      fragmentShader: bubbleFS,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    parent.add(this.points);
    this.tmp = new THREE.Vector3();
    this.flow = new THREE.Vector3();
  }

  setViewport(heightPx, fovDeg) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  spawnBubble(pump) {
    const i = this.free.pop();
    if (i === undefined) return;
    const r = this.rng;
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.32;
    this.pos[i * 3] = PUMP.impact.x + Math.cos(a) * d * 1.3;
    this.pos[i * 3 + 1] = TANK.waterY - 0.04 - r() * 0.1;
    this.pos[i * 3 + 2] = PUMP.impact.z + Math.sin(a) * d;
    const big = r() < 0.1;
    this.size[i] = big ? r.range(0.06, 0.12) : r.range(0.015, 0.05);
    this.vel[i * 3] = Math.cos(a) * r.range(0.1, 0.5);
    this.vel[i * 3 + 1] = -r.range(1.2, 4.2) * Math.min(pump, 1.5);
    this.vel[i * 3 + 2] = Math.sin(a) * r.range(0.1, 0.5);
    this.life[i] = 0;
    this.kind[i] = 1;
    this.wob[i] = r() * 100;
  }

  spawnDrop(pump) {
    const i = this.free.pop();
    if (i === undefined) return;
    const r = this.rng;
    const a = r() * Math.PI * 2;
    this.pos[i * 3] = PUMP.impact.x + r.range(-0.35, 0.35);
    this.pos[i * 3 + 1] = TANK.waterY + 0.02;
    this.pos[i * 3 + 2] = PUMP.impact.z + r.range(-0.1, 0.15);
    this.size[i] = r.range(0.015, 0.035);
    this.vel[i * 3] = Math.cos(a) * r.range(0.2, 0.7);
    this.vel[i * 3 + 1] = r.range(0.6, 1.6) * Math.min(pump, 1.3);
    this.vel[i * 3 + 2] = Math.sin(a) * r.range(0.2, 0.7);
    this.life[i] = 0;
    this.kind[i] = 2;
  }

  kill(i) {
    this.kind[i] = 0;
    this.alpha[i] = 0;
    this.free.push(i);
  }

  update(dt, t, pump) {
    if (pump > 0.02) {
      this.spawnAcc += dt * 600 * pump;
      while (this.spawnAcc >= 1) { this.spawnBubble(pump); this.spawnAcc--; }
      this.dropAcc += dt * 45 * pump;
      while (this.dropAcc >= 1) { this.spawnDrop(pump); this.dropAcc--; }
    }
    const p = this.tmp, f = this.flow;
    for (let i = 0; i < this.max; i++) {
      const k = this.kind[i];
      if (k === 0) continue;
      const i3 = i * 3;
      this.life[i] += dt;
      if (k === 1) {
        p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
        flowAt(p, t, pump, f);
        const size = this.size[i];
        const rise = 0.7 + size * 22;
        const drag = 2.2 + 0.03 / size;
        const k2 = Math.min(1, drag * dt);
        this.vel[i3] += (f.x * 0.9 - this.vel[i3]) * k2;
        this.vel[i3 + 1] += (f.y * 0.9 + rise - this.vel[i3 + 1]) * k2;
        this.vel[i3 + 2] += (f.z * 0.9 - this.vel[i3 + 2]) * k2;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        // 壁で止める
        this.pos[i3] = THREE.MathUtils.clamp(this.pos[i3], TANK.minX + 0.05, TANK.maxX - 0.05);
        this.pos[i3 + 2] = THREE.MathUtils.clamp(this.pos[i3 + 2], TANK.minZ + 0.35, TANK.maxZ - 0.05);
        const floor = sandHeight(this.pos[i3], this.pos[i3 + 2]) + 0.05;
        if (this.pos[i3 + 1] < floor) { this.pos[i3 + 1] = floor; this.vel[i3 + 1] = 0; }
        // 大きい泡ほど揺れながら昇る
        const w = this.wob[i] + this.life[i] * (9 + size * 60);
        const amp = size * 0.9;
        this.render[i3] = this.pos[i3] + Math.sin(w) * amp;
        this.render[i3 + 1] = this.pos[i3 + 1];
        this.render[i3 + 2] = this.pos[i3 + 2] + Math.cos(w * 0.8) * amp;
        const fadeIn = Math.min(1, this.life[i] * 6);
        const fadeTop = THREE.MathUtils.smoothstep(TANK.waterY - this.pos[i3 + 1], 0.0, 0.08);
        this.alpha[i] = fadeIn * fadeTop;
        if (this.pos[i3 + 1] >= TANK.waterY - 0.01 || this.life[i] > 14) this.kill(i);
      } else {
        this.vel[i3 + 1] -= 9.0 * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        this.render[i3] = this.pos[i3];
        this.render[i3 + 1] = this.pos[i3 + 1];
        this.render[i3 + 2] = this.pos[i3 + 2];
        this.alpha[i] = 0.9;
        if (this.pos[i3 + 1] < TANK.waterY) this.kill(i);
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}
