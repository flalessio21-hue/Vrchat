import * as THREE from 'three';
import { WORLDS } from './worlds.js';
import { makeTextSprite } from './textSprite.js';

const PLAZA_RADIUS = 54;
const PORTAL_RING = 34;

/**
 * L'hub centrale: piazza circolare con torre olografica, portali verso
 * gli altri mondi, piattaforme su cui saltare e un cielo stellato.
 * Tutto procedurale per restare leggero (target: Meta Quest standalone).
 */
export class Hub {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'hub';
    scene.add(this.group);

    this.colliders = []; // cerchi {x, z, r} non attraversabili
    this.platforms = []; // cilindri {x, z, r, top} calpestabili
    this.portals = [];
    this.animated = [];
    this.bounds = PLAZA_RADIUS - 1.2;
    this.spawn = new THREE.Vector3(0, 0, 16);

    scene.fog = new THREE.FogExp2(0x070318, 0.0105);
    scene.background = new THREE.Color(0x05010f);

    this.buildLights();
    this.buildSky();
    this.buildFloor();
    this.buildTower();
    this.buildPortals();
    this.buildPlatforms();
    this.buildDecor();
    this.buildParticles();
  }

  buildLights() {
    this.group.add(new THREE.HemisphereLight(0xb8d0ff, 0x4a2a70, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 40;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 140 });
    sun.shadow.bias = -0.0005;
    this.group.add(sun, sun.target);
    this.sun = sun;

    const core = new THREE.PointLight(0x39e6ff, 60, 40, 1.6);
    core.position.set(0, 6, 0);
    this.group.add(core);
  }

  /** L'ombra segue il giocatore così la shadow map resta piccola e nitida. */
  followShadow(pos) {
    this.sun.position.set(pos.x + 30, 50, pos.z + 20);
    this.sun.target.position.set(pos.x, 0, pos.z);
  }

  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          uniform float uTime;
          void main() {
            float h = vDir.y;
            vec3 top = vec3(0.01, 0.005, 0.05);
            vec3 mid = vec3(0.10, 0.02, 0.22);
            vec3 hor = vec3(0.55, 0.12, 0.55);
            vec3 col = mix(mid, top, smoothstep(0.0, 0.6, h));
            col = mix(hor, col, smoothstep(-0.05, 0.22, h));
            // aurora
            float a = sin(vDir.x * 6.0 + uTime * 0.15) * sin(vDir.z * 4.0 - uTime * 0.1);
            col += vec3(0.05, 0.4, 0.5) * smoothstep(0.4, 1.0, a) * smoothstep(0.15, 0.45, h) * (1.0 - smoothstep(0.45, 0.8, h)) * 0.5;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.group.add(sky);
    this.skyMat = sky.material;

    // Stelle
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.95 + 0.05;
      v.normalize().multiplyScalar(800);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false }));
    this.group.add(stars);

    // Pianeta lontano
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(70, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x3b1d7a, fog: false }),
    );
    planet.position.set(-320, 180, -520);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(95, 140, 64),
      new THREE.MeshBasicMaterial({ color: 0xff3df2, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }),
    );
    ring.rotation.set(1.2, 0.3, 0);
    planet.add(ring);
    this.group.add(planet);
  }

  buildFloor() {
    // Piani suddivisi in triangoli regolari: i "ventagli" di Circle/RingGeometry
    // producono artefatti con fwidth() su alcune GPU.
    const gridMat = (radius, base, line, fade, inner = 0) =>
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uRadius: { value: radius },
          uBase: { value: new THREE.Color(base) },
          uLine: { value: new THREE.Color(line) },
          uFade: { value: fade },
          uInner: { value: inner },
        },
        vertexShader: /* glsl */ `
          varying vec2 vXZ;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vXZ = w.xz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vXZ;
          uniform float uTime, uRadius, uFade, uInner;
          uniform vec3 uBase, uLine;
          float grid(vec2 p, float s) {
            vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s);
            return 1.0 - min(min(g.x, g.y), 1.0);
          }
          void main() {
            float d = length(vXZ);
            float g = max(grid(vXZ, 2.0) * 0.45, grid(vXZ, 10.0));
            // onde concentriche che partono dalla torre
            float wave = smoothstep(0.92, 1.0, sin(d * 0.35 - uTime * 1.6)) * 0.6;
            float rings = 1.0 - min(abs(fract(d / 6.0) - 0.5) * 2.0 / fwidth(d / 6.0) * 0.5, 1.0);
            vec3 col = uBase + uLine * (g * 0.7 + wave * 0.5 + rings * 0.25);
            if (d < uInner) discard;
            float alpha = 1.0 - smoothstep(uRadius * (1.0 - uFade), uRadius, d);
            gl_FragColor = vec4(col, alpha);
            #include <colorspace_fragment>
          }`,
      });

    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(PLAZA_RADIUS * 2 + 2, PLAZA_RADIUS * 2 + 2, 48, 48), gridMat(PLAZA_RADIUS + 1, 0x0b0620, 0x2fb8ff, 0.02));
    plaza.rotation.x = -Math.PI / 2;
    plaza.receiveShadow = true;
    this.group.add(plaza);

    // Ricevitore d'ombra (lo shader della griglia non le disegna)
    const shadowCatcher = new THREE.Mesh(
      new THREE.CircleGeometry(PLAZA_RADIUS, 64),
      new THREE.ShadowMaterial({ opacity: 0.45 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = 0.005;
    shadowCatcher.receiveShadow = true;
    this.group.add(shadowCatcher);

    const outer = new THREE.Mesh(new THREE.PlaneGeometry(840, 840, 64, 64), gridMat(420, 0x05010f, 0x6a1fa8, 0.75, PLAZA_RADIUS));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.6;
    this.group.add(outer);
    this.gridMats = [plaza.material, outer.material];

    // Bordo luminoso della piazza
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(PLAZA_RADIUS, 0.12, 8, 160),
      new THREE.MeshBasicMaterial({ color: 0x39e6ff }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.1;
    this.group.add(rim);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS, 1.4, 128, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    wall.position.y = 0.7;
    this.group.add(wall);
  }

  buildTower() {
    const t = new THREE.Group();
    this.group.add(t);
    const dark = new THREE.MeshStandardMaterial({ color: 0x14102a, metalness: 0.8, roughness: 0.3 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x39e6ff });
    const pink = new THREE.MeshBasicMaterial({ color: 0xff3df2 });

    // Base a gradoni
    [[9, 0.4], [7.2, 0.8], [5.6, 1.2]].forEach(([r, h]) => {
      const step = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.2, 0.4, 48), dark);
      step.position.y = h - 0.2;
      step.receiveShadow = step.castShadow = true;
      t.add(step);
      const edge = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.04, 6, 96), glow);
      edge.rotation.x = Math.PI / 2;
      edge.position.y = h;
      t.add(edge);
      this.platforms.push({ x: 0, z: 0, r: r + 0.1, top: h });
    });

    // Colonna
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 22, 6), dark);
    col.position.y = 12;
    col.castShadow = true;
    t.add(col);
    this.colliders.push({ x: 0, z: 0, r: 2.4 });
    for (let i = 0; i < 6; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 21, 0.08), i % 2 ? pink : glow);
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      strip.position.set(Math.cos(a) * 1.85, 12, Math.sin(a) * 1.85);
      strip.rotation.z = Math.cos(a) * 0.035;
      strip.rotation.x = -Math.sin(a) * 0.035;
      t.add(strip);
    }

    // Anelli rotanti
    [[4, 8, 0.1], [5.5, 14, -0.07], [3.2, 20, 0.14]].forEach(([r, y, speed], i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 8, 80), i === 1 ? pink : glow);
      ring.position.y = y;
      ring.rotation.x = Math.PI / 2 + 0.2;
      t.add(ring);
      this.animated.push((dt, time) => {
        ring.rotation.z += dt * speed * 4;
        ring.rotation.x = Math.PI / 2 + Math.sin(time * 0.5 + i) * 0.25;
      });
    });

    // Cristallo
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x39e6ff, emissive: 0x1a8fff, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.1, flatShading: true }),
    );
    crystal.position.y = 26;
    crystal.scale.y = 1.6;
    t.add(crystal);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(2.6, 0)), new THREE.LineBasicMaterial({ color: 0xff3df2 }));
    crystal.add(wire);
    this.animated.push((dt, time) => {
      crystal.rotation.y += dt * 0.4;
      crystal.position.y = 26 + Math.sin(time * 0.8) * 0.6;
      wire.rotation.y -= dt * 0.9;
    });

    // Fascio di luce verso il cielo
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.6, 200, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    beam.position.y = 126;
    t.add(beam);

    const sign = makeTextSprite('OASIS', { fontSize: 96, height: 2.4, bg: null, glow: '#ff3df2' });
    sign.position.y = 31;
    t.add(sign);
  }

  buildPortals() {
    const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x1a1236, metalness: 0.7, roughness: 0.35 });
    WORLDS.forEach((world, i) => {
      const a = (i / WORLDS.length) * Math.PI * 2 + Math.PI / WORLDS.length;
      const x = Math.sin(a) * PORTAL_RING;
      const z = Math.cos(a) * PORTAL_RING;
      const color = new THREE.Color(world.color);

      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.lookAt(0, 0, 0); // il portale guarda verso la torre
      this.group.add(g);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.5, 6), pedestalMat);
      base.position.y = 0.25;
      base.receiveShadow = base.castShadow = true;
      g.add(base);
      this.platforms.push({ x, z, r: 4.3, top: 0.5 });

      const frame = new THREE.Mesh(
        new THREE.TorusGeometry(3, 0.22, 12, 64),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, metalness: 0.5, roughness: 0.2 }),
      );
      frame.position.y = 3.9;
      frame.castShadow = true;
      g.add(frame);

      const swirl = new THREE.Mesh(
        new THREE.CircleGeometry(2.85, 48),
        new THREE.ShaderMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          uniforms: { uTime: { value: 0 }, uColor: { value: color }, uLocked: { value: world.ready ? 0 : 1 } },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `
            varying vec2 vUv;
            uniform float uTime, uLocked;
            uniform vec3 uColor;
            void main() {
              vec2 p = vUv - 0.5;
              float r = length(p) * 2.0;
              float ang = atan(p.y, p.x);
              float s = sin(ang * 5.0 + r * 12.0 - uTime * 3.0) * 0.5 + 0.5;
              float core = 1.0 - smoothstep(0.0, 0.9, r);
              vec3 col = uColor * (0.4 + s * 0.8) + vec3(1.0) * core * 0.35;
              // linee diagonali "in costruzione" sui mondi bloccati
              float stripes = step(0.5, fract((vUv.x + vUv.y) * 8.0 + uTime * 0.2));
              col = mix(col, col * (0.55 + stripes * 0.3), uLocked);
              float alpha = (0.55 + s * 0.35) * (1.0 - smoothstep(0.92, 1.0, r));
              gl_FragColor = vec4(col, alpha);
            }`,
        }),
      );
      swirl.position.y = 3.9;
      g.add(swirl);

      const label = makeTextSprite(world.name, { fontSize: 64, height: 0.9, glow: world.color });
      label.position.y = 7.9;
      g.add(label);
      if (!world.ready) {
        const soon = makeTextSprite('PROSSIMAMENTE', { fontSize: 40, height: 0.42, glow: world.color, color: '#cfd8ff' });
        soon.position.y = 7.15;
        g.add(soon);
      }

      // Colliders sui due lati della cornice (si può passare solo davanti)
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
      [-1, 1].forEach((s) => this.colliders.push({ x: x + side.x * 3 * s, z: z + side.z * 3 * s, r: 0.5 }));
      this.colliders.push({ x, z, r: 0.6 });

      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
      this.portals.push({
        world,
        position: new THREE.Vector3(x, 0, z),
        interactPoint: new THREE.Vector3(x + front.x * 2.5, 0, z + front.z * 2.5),
      });

      this.animated.push((dt, time) => {
        swirl.material.uniforms.uTime.value = time + i;
        frame.rotation.z = Math.sin(time * 0.6 + i) * 0.05;
      });
    });
  }

  buildPlatforms() {
    // Piccolo percorso di piattaforme fluttuanti tra due portali
    const mat = new THREE.MeshStandardMaterial({ color: 0x1d1640, metalness: 0.6, roughness: 0.35 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x7dff6a });
    const path = [
      [16, -18, 0.8], [19, -21.5, 1.6], [22.5, -24, 2.4], [26.5, -25, 3.2], [30, -23, 4.0], [33, -19.5, 4.8],
    ];
    path.forEach(([x, z, top], i) => {
      const r = i === path.length - 1 ? 2.6 : 1.5;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, 0.4, 24), mat);
      p.position.set(x, top - 0.2, z);
      p.castShadow = p.receiveShadow = true;
      const edge = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 6, 48), glow);
      edge.rotation.x = Math.PI / 2;
      edge.position.y = 0.2;
      p.add(edge);
      this.group.add(p);
      this.platforms.push({ x, z, r, top });
    });

    // Belvedere in cima con un premio luminoso
    const [lx, lz, ly] = path[path.length - 1];
    const gem = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x7dff6a, emissive: 0x7dff6a, emissiveIntensity: 2, flatShading: true }),
    );
    gem.position.set(lx, ly + 1.2, lz);
    this.group.add(gem);
    this.gem = gem;
    this.animated.push((dt, time) => {
      gem.rotation.y += dt * 2;
      gem.position.y = ly + 1.2 + Math.sin(time * 2) * 0.15;
    });
  }

  buildDecor() {
    // Lampioni + alberi olografici lungo un anello
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x221a44, metalness: 0.8, roughness: 0.3 });
    const treeMats = [0x39e6ff, 0xff3df2, 0x8a7bff].map(
      (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.75 }),
    );
    const crownGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.6, 1));
    const lampGeo = new THREE.SphereGeometry(0.28, 12, 10);
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 22;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (i % 3 === 0) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 2, 8), poleMat);
        trunk.position.y = 1;
        trunk.castShadow = true;
        const crown = new THREE.LineSegments(crownGeo, treeMats[(i / 3) % 3]);
        crown.position.y = 3.2;
        tree.add(trunk, crown);
        tree.position.set(x, 0, z);
        this.group.add(tree);
        this.colliders.push({ x, z, r: 0.5 });
        this.animated.push((dt) => (crown.rotation.y += dt * 0.3));
      } else {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 8), poleMat);
        pole.position.set(x, 1.8, z);
        pole.castShadow = true;
        const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0x39e6ff : 0xff3df2 }));
        lamp.position.set(x, 3.7, z);
        this.group.add(pole, lamp);
        this.colliders.push({ x, z, r: 0.3 });
      }
    }

    // Monoliti di confine
    const mono = new THREE.MeshStandardMaterial({ color: 0x120c28, metalness: 0.9, roughness: 0.25 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = PLAZA_RADIUS + 6 + (i % 2) * 5;
      const h = 8 + (i % 3) * 6;
      const m = new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), mono);
      m.position.set(Math.sin(a) * r, h / 2 - 0.6, Math.cos(a) * r);
      m.rotation.y = a;
      this.group.add(m);
      const line = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.1, 3.05), new THREE.MeshBasicMaterial({ color: 0x8a7bff }));
      line.position.y = h / 2 - 1;
      m.add(line);
    }
  }

  buildParticles() {
    const n = 400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(Math.random()) * PLAZA_RADIUS;
      const a = Math.random() * Math.PI * 2;
      pos.set([Math.sin(a) * r, Math.random() * 14 + 0.5, Math.cos(a) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.12, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.group.add(pts);
    this.animated.push((dt, time) => {
      pts.rotation.y = time * 0.02;
      pts.position.y = Math.sin(time * 0.3) * 0.5;
    });
  }

  /** Altezza del terreno calpestabile sotto (x,z) partendo da un'altezza y. */
  groundAt(x, z, y) {
    let ground = 0;
    for (const p of this.platforms) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.r * p.r && p.top <= y + 0.45 && p.top > ground) ground = p.top;
    }
    return ground;
  }

  update(dt, time) {
    this.skyMat.uniforms.uTime.value = time;
    for (const m of this.gridMats) m.uniforms.uTime.value = time;
    for (const fn of this.animated) fn(dt, time);
  }
}
