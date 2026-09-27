import * as THREE from 'three';

// 背景：グラデーションの空と、浮かぶ雲（当たり判定なし）

export class Scenery {
  constructor(scene) {
    this.scene = scene;
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 top;
        uniform vec3 bottom;
        varying vec3 vDir;
        void main() {
          gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.15, 0.55, vDir.y)), 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.skyMat);
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 1, flatShading: true });
    this.cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    this.clouds = new THREE.Group();
    scene.add(this.clouds);
  }

  applyTheme(theme) {
    this.skyMat.uniforms.top.value.set(theme.skyTop);
    this.skyMat.uniforms.bottom.value.set(theme.skyBottom);
    this.clouds.clear();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < theme.clouds; i++) {
      const c = new THREE.Group();
      const parts = 3 + Math.floor(rnd() * 3);
      for (let p = 0; p < parts; p++) {
        const m = new THREE.Mesh(this.cloudGeo, this.cloudMat);
        m.scale.set(3 + rnd() * 5, 1.2 + rnd() * 1.5, 2.5 + rnd() * 3);
        m.position.set((p - parts / 2) * 2.4 + rnd(), rnd() * 0.8, (rnd() - 0.5) * 2);
        c.add(m);
      }
      const below = rnd() < 0.55;
      const side = rnd() < 0.5 ? -1 : 1;
      c.position.set(side * (14 + rnd() * 40), below ? -8 - rnd() * 22 : 14 + rnd() * 22, 20 - rnd() * 110);
      c.userData.speed = 0.3 + rnd() * 0.6;
      this.clouds.add(c);
    }
  }

  update(dt, camera) {
    this.sky.position.copy(camera.position);
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 60) c.position.x = -60;
    }
  }
}
