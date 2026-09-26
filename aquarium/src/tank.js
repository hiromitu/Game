import * as THREE from 'three';
import { TANK, shared } from './config.js';
import { WATER_GLSL, waterUniforms } from './shaders.js';

// ガラス・枠・水面・キャビネット・照明器具
export function buildTank(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const W = TANK.maxX - TANK.minX, D = TANK.maxZ - TANK.minZ, H = TANK.glassTop;
  const cx = (TANK.minX + TANK.maxX) / 2, cz = (TANK.minZ + TANK.maxZ) / 2;
  const t = 0.06;

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xcfe9ee, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.2, depthWrite: false,
  });
  const panes = [
    [W, H, t, cx, H / 2, TANK.maxZ + t / 2],
    [t, H, D, TANK.minX - t / 2, H / 2, cz],
    [t, H, D, TANK.maxX + t / 2, H / 2, cz],
  ];
  for (const [w, h, d, x, y, z] of panes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
    m.position.set(x, y, z);
    m.renderOrder = 10;
    group.add(m);
  }

  // ガラスの小口（緑がかった縁）
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x7fc9b8, transparent: true, opacity: 0.45, roughness: 0.1 });
  for (const x of [TANK.minX - t / 2, TANK.maxX + t / 2]) {
    for (const z of [TANK.maxZ + t / 2, TANK.minZ - t / 2]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(t * 1.1, H, t * 1.1), edgeMat);
      e.position.set(x, H / 2, z);
      group.add(e);
    }
  }
  for (const y of [H]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(W + t * 2, 0.03, t * 1.1), edgeMat);
    e.position.set(cx, y, TANK.maxZ + t / 2);
    group.add(e);
  }

  // 底の黒い枠
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.18, D + 0.3), frameMat);
  base.position.set(cx, -0.09, cz);
  group.add(base);

  // 水面
  group.add(buildSurface());

  // 照明（LED バー）と脚
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.3, metalness: 0.6 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.12, 1.2), lampMat);
  lamp.position.set(cx - 0.6, H + 0.75, 0.3);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.6, 0.9),
    new THREE.MeshBasicMaterial({ color: 0xf2fbff }),
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.set(cx - 0.6, H + 0.685, 0.3);
  group.add(lamp, glow);
  for (const x of [TANK.minX + 0.4, TANK.maxX - 1.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.9), lampMat);
    leg.position.set(x, H + 0.35, 0.3);
    group.add(leg);
  }
  const lampGlow = glow.material;

  // キャビネットと床
  const wood = new THREE.MeshStandardMaterial({ color: 0x2c2019, roughness: 0.75 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 3.4, D + 1.2), wood);
  cab.position.set(cx, -0.18 - 1.7, cz - 0.3);
  cab.receiveShadow = true;
  group.add(cab);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.58;
  group.add(floor);
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 30),
    new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 1 }),
  );
  wall.position.set(0, 10, -6);
  group.add(wall);

  return { group, lampGlow };
}

function buildSurface() {
  const W = TANK.maxX - TANK.minX, D = TANK.maxZ - TANK.minZ;
  const geo = new THREE.PlaneGeometry(W, D, 160, 70);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: waterUniforms({ uPump: shared.uPump, uImpact: shared.uImpact }),
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPump;
      uniform vec3 uImpact;
      varying vec3 vWPos;
      varying vec3 vN;
      float height(vec2 p) {
        float h = 0.012 * sin(p.x * 3.1 + uTime * 1.7)
                + 0.010 * sin(p.y * 4.3 - uTime * 2.1 + p.x * 0.8)
                + 0.006 * sin((p.x + p.y) * 7.0 + uTime * 3.3);
        vec2 d = p - uImpact.xz;
        float r = length(d * vec2(0.8, 1.0));
        h += 0.035 * uPump * sin(r * 13.0 - uTime * 9.0) * exp(-r * 1.2);
        h += 0.012 * uPump * sin(r * 5.0 - uTime * 4.0) * exp(-r * 0.35);
        return h;
      }
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec2 p = wp.xz;
        float e = 0.04;
        float h = height(p);
        float hx = height(p + vec2(e, 0.0)) - h;
        float hz = height(p + vec2(0.0, e)) - h;
        vN = normalize(vec3(-hx / e, 1.0, -hz / e));
        wp.y += h;
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${WATER_GLSL}
      varying vec3 vWPos;
      varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        vec3 V = normalize(vWPos - cameraPosition);
        bool below = cameraPosition.y < vWPos.y;
        vec3 L = normalize(vec3(0.2, 1.0, 0.3));
        vec3 col;
        float a;
        if (below) {
          // 水中から見上げた水面：全反射で明るく、きらめく
          vec3 nn = -n;
          float cosT = abs(dot(V, nn));
          float tir = smoothstep(0.55, 0.25, cosT);
          vec3 refr = refract(V, nn, 1.33);
          float sky = length(refr) > 0.0 ? pow(max(dot(refr, L), 0.0), 6.0) : 0.0;
          col = mix(vec3(0.55, 0.85, 0.9) * (0.6 + 1.2 * sky), uWaterColor * 1.6, tir);
          col += vec3(1.0) * pow(max(dot(reflect(V, nn), -L), 0.0), 40.0) * 0.3;
          a = mix(0.45, 0.8, tir);
        } else {
          float fres = pow(1.0 - max(dot(-V, n), 0.0), 3.0);
          col = mix(vec3(0.25, 0.45, 0.5), vec3(0.8, 0.9, 0.95), fres);
          col += vec3(1.0) * pow(max(dot(reflect(V, n), L), 0.0), 80.0) * 1.5;
          a = mix(0.18, 0.75, fres);
        }
        col *= uLightLevel;
        col = applyWater(col, vWPos - vec3(0.0, 0.001, 0.0));
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((TANK.minX + TANK.maxX) / 2, TANK.waterY, (TANK.minZ + TANK.maxZ) / 2);
  mesh.renderOrder = 2;
  return mesh;
}
