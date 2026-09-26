import * as THREE from 'three';
import { shared, PUMP } from './config.js';

// ポンプが作る水流。JS 側（魚・泡）と GLSL 側（水草）で同じ式を使う
const smooth = THREE.MathUtils.smoothstep;
export function flowAt(p, t, pump, out) {
  const dx = p.x - PUMP.impact.x;
  const dz = p.z - PUMP.impact.z;
  const r = Math.hypot(dx, dz) + 1e-3;
  const radial = pump * (0.18 + 1.4 * Math.exp(-r * 0.45));
  const g = 0.75 + 0.25 * Math.sin(t * 1.1 + p.x * 0.7 + p.z * 0.5)
    + 0.15 * Math.sin(t * 2.3 - p.x * 1.3 + p.y * 0.9);
  const jet = pump * 2.2 * Math.exp(-r * r * 2.5) * smooth(p.y, 1.5, 5.6);
  return out.set((dx / r) * radial * g - 0.25 * pump, -jet, (dz / r) * radial * g);
}

export const FLOW_GLSL = /* glsl */ `
uniform float uPump;
uniform vec3 uImpact;
vec3 flowAt(vec3 p) {
  vec2 d = p.xz - uImpact.xz;
  float r = length(d) + 1e-3;
  float radial = uPump * (0.18 + 1.4 * exp(-r * 0.45));
  float g = 0.75 + 0.25 * sin(uTime * 1.1 + p.x * 0.7 + p.z * 0.5)
          + 0.15 * sin(uTime * 2.3 - p.x * 1.3 + p.y * 0.9);
  float jet = uPump * 2.2 * exp(-r * r * 2.5) * smoothstep(1.5, 5.6, p.y);
  vec2 h = d / r * radial * g;
  return vec3(h.x - 0.25 * uPump, -jet, h.y);
}
`;

// 水中の見え方（色の吸収・コースティクス）
export const WATER_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uTankMin;
uniform vec3 uTankMax;
uniform vec3 uWaterColor;
uniform float uWaterDensity;
uniform float uCaustic;
uniform float uLightLevel;

float causticPattern(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318530718, 6.28318530718) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.5);
}

float caustic(vec3 wp, vec3 n) {
  if (wp.y > uTankMax.y) return 0.0;
  float c = causticPattern(wp.xz * 0.22 + vec2(0.13, 0.07) * wp.y, uTime * 0.35);
  float up = clamp(n.y * 0.7 + 0.3, 0.0, 1.0);
  float depth = mix(0.6, 1.0, clamp(wp.y / uTankMax.y, 0.0, 1.0));
  return c * up * depth * uCaustic * uLightLevel;
}

// カメラから wp までの視線のうち、水の箱の中を通る長さ
float waterPath(vec3 wp) {
  vec3 ro = cameraPosition;
  vec3 rd = wp - ro;
  float len = length(rd);
  rd /= len;
  vec3 inv = 1.0 / (sign(rd) * max(abs(rd), vec3(1e-5)) + vec3(1e-9));
  vec3 t0 = (uTankMin - ro) * inv;
  vec3 t1 = (uTankMax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tEnter = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tExit = min(min(min(tmax.x, tmax.y), tmax.z), len);
  return max(tExit - tEnter, 0.0);
}

vec3 applyWater(vec3 col, vec3 wp) {
  float f = 1.0 - exp(-waterPath(wp) * uWaterDensity);
  return mix(col, uWaterColor * uLightLevel, f);
}
`;

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const WATER_UNIFORM_KEYS = [
  'uTime', 'uTankMin', 'uTankMax', 'uWaterColor', 'uWaterDensity', 'uCaustic', 'uLightLevel',
];

export function waterUniforms(extra = {}) {
  const u = {};
  for (const k of WATER_UNIFORM_KEYS) u[k] = shared[k];
  return Object.assign(u, extra);
}

// MeshStandardMaterial に水中表現（吸収・コースティクス）を足す。
// vertexPars / beginVertex で頂点変形（魚の泳ぎ）も差し込める
export function enhanceStandard(material, opts = {}) {
  const { uniforms = {}, vertexPars = '', beginVertex = '', causticGain = 0.55, key = 'std' } = opts;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms(), uniforms);
    shader.vertexShader = `
      uniform float uTime;
      varying vec3 vWPos;
      varying vec3 vWNormal;
      ${vertexPars}
    ` + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${beginVertex}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wpp = vec4(transformed, 1.0);
        mat3 nm = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          wpp = instanceMatrix * wpp;
          nm = nm * mat3(instanceMatrix);
        #endif
        wpp = modelMatrix * wpp;
        vWPos = wpp.xyz;
        vWNormal = normalize(nm * objectNormal);`);
    shader.fragmentShader = `
      varying vec3 vWPos;
      varying vec3 vWNormal;
      ${WATER_GLSL}
    ` + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * caustic(vWPos, normalize(vWNormal)) * ${causticGain.toFixed(3)};`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        gl_FragColor.rgb = applyWater(gl_FragColor.rgb, vWPos);`);
  };
  material.customProgramCacheKey = () => 'aq-' + key + causticGain;
  return material;
}
