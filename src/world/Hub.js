import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLDS } from './worlds.js';
import { makeTextSprite, makePanelTexture } from './textSprite.js';
import { toonMat, addOutlines, canvasTexture, rng } from '../core/toon.js';

const PLAZA_R = 24;
const ISLAND_R = 50.5;
const PORTAL_R = 36;
const SUN_DIR = new THREE.Vector3(-0.62, 0.32, -0.72).normalize();

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }`;

/**
 * Hub "Oasis": isola fluttuante al tramonto sopra un mare di nuvole.
 * Piazza con fontana e cristallo, 6 portali ad arco, specchio, panchine,
 * alberi stilizzati, lanterne, percorso di salti verso un isolotto.
 * Tutto procedurale (nessun file da scaricare), pensato anche per Quest.
 */
export class Hub {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'hub';
    scene.add(this.group);

    this.colliders = []; // cerchi {x, z, r}
    this.platforms = []; // cilindri calpestabili {x, z, r, top}
    this.portals = [];
    this.interactables = []; // {point, radius, label, type, data}
    this.seats = [];
    this.animated = [];
    this.bounds = ISLAND_R - 2;
    this.spawn = new THREE.Vector3(0, 0, 15);
    this.rand = rng(7);

    scene.background = new THREE.Color(0xe7a0b0);
    scene.fog = new THREE.Fog(0xc993b8, 80, 480);

    this.makeTextures();
    this.buildLights();
    this.buildSky();
    this.buildCloudSea();
    this.buildIsland();
    this.buildFountain();
    this.buildPortals();
    this.buildMirror();
    this.buildBenches();
    this.buildTrees();
    this.buildLanterns();
    this.buildParkour();
    this.buildWelcomeBoard();
    this.buildParticles();
  }

  // ------------------------------------------------------------- texture
  makeTextures() {
    const r = rng(3);
    this.tex = {
      tiles: canvasTexture(512, (ctx, S) => {
        ctx.fillStyle = '#6e6280';
        ctx.fillRect(0, 0, S, S);
        const n = 4;
        const t = S / n;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const off = y % 2 ? t / 2 : 0;
            const l = 70 + r() * 9;
            ctx.fillStyle = `hsl(${30 + r() * 20}, ${14 + r() * 10}%, ${l}%)`;
            for (const dx of [0, -S]) {
              ctx.beginPath();
              ctx.roundRect(x * t + off + dx + 4, y * t + 4, t - 8, t - 8, 10);
              ctx.fill();
            }
          }
        }
        for (let i = 0; i < 900; i++) {
          ctx.fillStyle = `rgba(80,60,90,${r() * 0.08})`;
          ctx.fillRect(r() * S, r() * S, 2 + r() * 5, 2 + r() * 5);
        }
      }, { repeat: 12 }),
      grass: canvasTexture(512, (ctx, S) => {
        ctx.fillStyle = '#5fae6a';
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < 2600; i++) {
          const x = r() * S;
          const y = r() * S;
          ctx.strokeStyle = `hsla(${105 + r() * 35}, ${45 + r() * 25}%, ${38 + r() * 28}%, 0.55)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (r() - 0.5) * 6, y - 6 - r() * 10);
          ctx.stroke();
        }
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = ['#ffe4f0', '#fff6a8', '#cfe8ff'][i % 3];
          ctx.beginPath();
          ctx.arc(r() * S, r() * S, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }, { repeat: 26 }),
      rock: canvasTexture(256, (ctx, S) => {
        ctx.fillStyle = '#c4b2d8';
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < 500; i++) {
          ctx.fillStyle = `rgba(${r() > 0.5 ? '255,220,240' : '30,20,50'},${r() * 0.12})`;
          ctx.fillRect(r() * S, r() * S, 4 + r() * 22, 2 + r() * 6);
        }
      }, { repeat: 6 }),
    };
  }

  // ------------------------------------------------------------- luci
  buildLights() {
    this.group.add(new THREE.HemisphereLight(0xb9c8ff, 0x8a5a6a, 1.35));
    const sun = new THREE.DirectionalLight(0xffd6b0, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 30;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 160 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.group.add(sun, sun.target);
    this.sun = sun;

    // luce di riempimento fredda dal lato opposto (look anime: ombre colorate)
    const fill = new THREE.DirectionalLight(0x9fb6ff, 0.6);
    fill.position.set(40, 20, 50);
    this.group.add(fill);
  }

  followShadow(pos) {
    this.sun.position.copy(pos).addScaledVector(SUN_DIR, 60);
    this.sun.target.position.copy(pos);
  }

  // ------------------------------------------------------------- cielo
  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          uniform float uTime;
          uniform vec3 uSun;
          ${NOISE_GLSL}
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 zenith = vec3(0.10, 0.09, 0.32);
            vec3 mid = vec3(0.42, 0.30, 0.68);
            vec3 horizon = vec3(1.0, 0.62, 0.62);
            vec3 low = vec3(0.86, 0.58, 0.78);
            vec3 col = mix(horizon, mid, smoothstep(0.02, 0.28, h));
            col = mix(col, zenith, smoothstep(0.28, 0.85, h));
            col = mix(col, low, smoothstep(0.0, -0.25, h));

            float sd = max(dot(d, uSun), 0.0);
            col += vec3(1.0, 0.65, 0.35) * pow(sd, 8.0) * 0.4;
            col += vec3(1.0, 0.85, 0.6) * pow(sd, 64.0) * 0.6;
            col = mix(col, vec3(1.0, 0.95, 0.85), smoothstep(0.9975, 0.999, sd));

            // nuvole stilizzate
            if (h > 0.0) {
              vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(uTime * 0.006, 0.0);
              float c = fbm(uv * 1.3);
              float band = smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.35, 0.6, h));
              float cl = smoothstep(0.52, 0.62, c) * band;
              vec3 cloudCol = mix(vec3(0.62, 0.45, 0.78), vec3(1.0, 0.78, 0.72), pow(sd, 2.0) * 0.8 + 0.2);
              cloudCol = mix(cloudCol, vec3(1.0, 0.9, 0.85), smoothstep(0.62, 0.75, c) * 0.4);
              col = mix(col, cloudCol, cl * 0.85);
            }

            // stelle verso lo zenit
            vec2 sp = vec2(atan(d.z, d.x) * 120.0, h * 240.0);
            float star = step(0.996, hash(floor(sp)));
            float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp)) * 40.0);
            col += vec3(star * tw) * smoothstep(0.35, 0.8, h) * 0.9;

            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);
    this.skyMat = sky.material;
    this.animated.push((dt, t) => (this.skyMat.uniforms.uTime.value = t));

    // pianeta e lune lontane (tocco sci-fi di Oasis)
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(90, 48, 32),
      new THREE.ShaderMaterial({
        fog: false,
        uniforms: { uSun: { value: SUN_DIR } },
        vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
        fragmentShader: `varying vec3 vN; varying vec3 vP; uniform vec3 uSun;
          void main(){
            float l = smoothstep(-0.2, 0.6, dot(vN, uSun));
            float bands = sin(vP.y * 0.18 + sin(vP.x * 0.03) * 2.0) * 0.5 + 0.5;
            vec3 base = mix(vec3(0.35,0.25,0.65), vec3(0.75,0.55,0.95), bands);
            vec3 col = mix(base * 0.35, base, l);
            float rim = pow(1.0 - abs(vN.z), 3.0);
            col += vec3(0.9,0.6,1.0) * rim * 0.4;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    planet.position.set(420, 330, -900);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(120, 185, 96),
      new THREE.MeshBasicMaterial({ color: 0xffc2e8, transparent: true, opacity: 0.4, side: THREE.DoubleSide, fog: false }),
    );
    ring.rotation.set(1.25, 0.35, 0.2);
    planet.add(ring);
    this.group.add(planet);
  }

  buildCloudSea() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW;
        uniform float uTime;
        uniform vec3 uSun;
        ${NOISE_GLSL}
        void main() {
          vec2 p = vW.xz * 0.012 + vec2(uTime * 0.01, uTime * 0.004);
          float n = fbm(p);
          float n2 = fbm(p * 2.7 - uTime * 0.008);
          float c = n * 0.7 + n2 * 0.3;
          vec3 shadowC = vec3(0.55, 0.42, 0.72);
          vec3 lightC = vec3(1.0, 0.82, 0.82);
          vec3 col = mix(shadowC, lightC, smoothstep(0.35, 0.7, c));
          vec2 sd = normalize(uSun.xz);
          col += vec3(1.0, 0.7, 0.45) * pow(max(dot(normalize(vW.xz), sd), 0.0), 8.0) * 0.25;
          float d = length(vW.xz);
          float a = smoothstep(0.3, 0.55, c) * (1.0 - smoothstep(600.0, 1300.0, d));
          gl_FragColor = vec4(col, a * 0.95);
          #include <colorspace_fragment>
        }`,
    });
    for (const [y, s] of [[-38, 1], [-30, 1.6]]) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800, 1, 1), mat.clone());
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = y;
      sea.scale.setScalar(s);
      this.group.add(sea);
      this.animated.push((dt, t) => (sea.material.uniforms.uTime.value = t * s));
    }
  }

  // ------------------------------------------------------------- isola
  buildIsland() {
    const g = this.group;

    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(ISLAND_R, 96),
      new THREE.MeshStandardMaterial({ map: this.tex.grass, roughness: 1, color: 0xd8ffd0 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    g.add(grass);

    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(PLAZA_R, 96),
      new THREE.MeshStandardMaterial({ map: this.tex.tiles, roughness: 0.85 }),
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    g.add(plaza);

    // cordolo della piazza + anelli luminosi nel pavimento
    const curb = new THREE.Mesh(new THREE.TorusGeometry(PLAZA_R, 0.18, 8, 128), toonMat(0xd8cbe0));
    curb.rotation.x = Math.PI / 2;
    curb.scale.z = 0.4;
    curb.position.y = 0.03;
    curb.receiveShadow = true;
    g.add(curb);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x7ff0ff });
    for (const r of [PLAZA_R - 0.6, 12.5]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r + 0.06, 128), glowMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.035;
      g.add(ring);
    }

    // sentieri verso i portali
    WORLDS.forEach((_, i) => {
      const a = this.portalAngle(i);
      const len = PORTAL_R - PLAZA_R;
      const path = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, len + 1),
        new THREE.MeshStandardMaterial({ map: this.tex.tiles.clone(), roughness: 0.9 }),
      );
      path.material.map.repeat.set(0.8, (len + 1) / 4);
      path.rotation.set(-Math.PI / 2, 0, a);
      const mid = PLAZA_R + len / 2 - 0.5;
      path.position.set(Math.sin(a) * mid, 0.025, Math.cos(a) * mid);
      path.receiveShadow = true;
      g.add(path);
    });

    // scogliera sotto l'isola (rocce con rumore)
    const profile = [[ISLAND_R + 0.3, 0.02], [ISLAND_R + 0.6, -0.8], [ISLAND_R - 1, -3], [ISLAND_R - 6, -7], [38, -12], [27, -18], [15, -26], [6, -33], [0.01, -38]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const cliffGeo = new THREE.LatheGeometry(profile, 72);
    const pos = cliffGeo.attributes.position;
    const v = new THREE.Vector3();
    const rnd = rng(11);
    const jitter = new Map();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.y > -0.5) continue;
      const key = `${Math.round(v.x * 10)},${Math.round(v.y * 10)},${Math.round(v.z * 10)}`;
      if (!jitter.has(key)) jitter.set(key, [(rnd() - 0.5) * 2.4, (rnd() - 0.5) * 1.6]);
      const [jr, jy] = jitter.get(key);
      const len = Math.hypot(v.x, v.z) || 1;
      v.x += (v.x / len) * jr;
      v.z += (v.z / len) * jr;
      v.y += jy;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    cliffGeo.computeVertexNormals();
    const cliff = new THREE.Mesh(cliffGeo, toonMat(0xb79ac8, { map: this.tex.rock, flatShading: true }));
    g.add(cliff);
    // bordo d'erba che sporge
    const lip = new THREE.Mesh(new THREE.TorusGeometry(ISLAND_R, 0.35, 8, 128), toonMat(0x5fae6a));
    lip.rotation.x = Math.PI / 2;
    lip.scale.z = 0.5;
    g.add(lip);

    // ringhiera
    const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8);
    const n = 100;
    const posts = new THREE.InstancedMesh(postGeo, toonMat(0xf3e9ff), n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      m.makeTranslation(Math.sin(a) * (ISLAND_R - 1.2), 0.55, Math.cos(a) * (ISLAND_R - 1.2));
      posts.setMatrixAt(i, m);
    }
    posts.castShadow = true;
    g.add(posts);
    for (const y of [1.0, 0.6]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(ISLAND_R - 1.2, y > 0.8 ? 0.06 : 0.035, 6, 200), y > 0.8 ? toonMat(0xf3e9ff) : new THREE.MeshBasicMaterial({ color: 0xffb3e6 }));
      rail.rotation.x = Math.PI / 2;
      rail.position.y = y;
      g.add(rail);
    }

    // isolotti fluttuanti decorativi
    const rockMat = toonMat(0xb79ac8, { map: this.tex.rock, flatShading: true });
    const grassMat = toonMat(0x6cbf72);
    const r2 = rng(21);
    for (let i = 0; i < 9; i++) {
      const a = r2() * Math.PI * 2;
      const d = 75 + r2() * 90;
      const s = 3 + r2() * 7;
      const isle = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.ConeGeometry(s, s * 1.8, 7), rockMat);
      rock.rotation.x = Math.PI;
      rock.position.y = -s * 0.9;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(s, s * 0.95, 0.5, 7), grassMat);
      isle.add(rock, top);
      if (s > 5) isle.add(this.makeTree(r2() > 0.5 ? 'sakura' : 'round', s * 0.12 + 0.6, r2).group);
      isle.position.set(Math.sin(a) * d, -6 + r2() * 26, Math.cos(a) * d);
      const y0 = isle.position.y;
      const ph = r2() * 6;
      this.animated.push((dt, t) => (isle.position.y = y0 + Math.sin(t * 0.3 + ph) * 0.8));
      g.add(isle);
    }
  }

  portalAngle(i) {
    return (i / WORLDS.length) * Math.PI * 2 + Math.PI / WORLDS.length;
  }

  // ------------------------------------------------------------- fontana
  buildFountain() {
    const f = new THREE.Group();
    this.group.add(f);
    const stone = toonMat(0xeee4f6);
    const stoneDark = toonMat(0xb9a8cc);

    const basin = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 0.05], [4.6, 0.05], [5.2, 0.1], [5.25, 0.55], [5.0, 0.62], [4.7, 0.55], [4.6, 0.25], [0, 0.25]].map(([r, y]) => new THREE.Vector2(r, y)), 64),
      stone,
    );
    basin.castShadow = basin.receiveShadow = true;
    f.add(basin);
    this.platforms.push({ x: 0, z: 0, r: 5.25, top: 0.6 });
    this.colliders.push({ x: 0, z: 0, r: 4.25 });

    const waterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uR: { value: 4.6 } },
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        varying vec2 vP; uniform float uTime; uniform float uR;
        ${NOISE_GLSL}
        void main(){
          float d = length(vP);
          float rip = sin(d * 5.0 - uTime * 2.5) * 0.5 + 0.5;
          float n = noise(vP * 1.5 + uTime * 0.4);
          vec3 deep = vec3(0.22, 0.55, 0.85);
          vec3 shallow = vec3(0.45, 0.9, 1.0);
          vec3 col = mix(deep, shallow, step(0.55, rip * 0.6 + n * 0.5));
          float foam = step(uR - 0.25 - n * 0.2, d) + step(d, 1.0 + n * 0.3);
          col = mix(col, vec3(0.95, 1.0, 1.0), clamp(foam, 0.0, 1.0));
          float sparkle = step(0.97, noise(vP * 6.0 + uTime * 1.2));
          col += sparkle * 0.6;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(4.62, 64), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.45;
    f.add(water);
    this.animated.push((dt, t) => (waterMat.uniforms.uTime.value = t));

    // vasca superiore
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 2.4, 16), stoneDark);
    column.position.y = 1.4;
    column.castShadow = true;
    f.add(column);
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 0], [0.6, 0], [1.9, 0.35], [2.0, 0.55], [1.85, 0.55], [0.6, 0.25], [0, 0.25]].map(([r, y]) => new THREE.Vector2(r, y)), 48),
      stone,
    );
    bowl.position.y = 2.5;
    bowl.castShadow = true;
    f.add(bowl);
    const water2 = new THREE.Mesh(new THREE.CircleGeometry(1.86, 48), waterMat);
    water2.rotation.x = -Math.PI / 2;
    water2.position.y = 2.98;
    f.add(water2);
    addOutlines(f, 0.03, 0x3a2a4a);

    // cristallo di Oasis
    const crystal = new THREE.Group();
    crystal.position.y = 6;
    f.add(crystal);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1, 0),
      new THREE.MeshStandardMaterial({ color: 0x9ff4ff, emissive: 0x39d0ff, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.1, flatShading: true }),
    );
    gem.scale.y = 1.7;
    crystal.add(gem);
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    const shell = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), shellMat);
    shell.scale.y = 1.6;
    crystal.add(shell);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff9ce8 });
    const rings = [1.9, 2.4].map((r, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 64), i ? ringMat : new THREE.MeshBasicMaterial({ color: 0x8ff6ff }));
      crystal.add(ring);
      return ring;
    });
    const light = new THREE.PointLight(0x7fe6ff, 25, 18, 1.5);
    crystal.add(light);
    this.animated.push((dt, t) => {
      crystal.position.y = 6 + Math.sin(t * 0.9) * 0.25;
      gem.rotation.y += dt * 0.5;
      shell.rotation.y -= dt * 0.3;
      rings[0].rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.4, t * 0.6, 0);
      rings[1].rotation.set(Math.PI / 2 + Math.cos(t * 0.5) * 0.5, -t * 0.4, 0.3);
    });

    // getti d'acqua (particelle)
    const N = 260;
    const posArr = new Float32Array(N * 3);
    const seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) seeds[i] = this.rand();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const drops = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xc9f6ff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    drops.frustumCulled = false;
    f.add(drops);
    this.animated.push((dt, t) => {
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        const life = (t * 0.55 + s) % 1;
        const a = s * Math.PI * 2 * 7;
        const r = 0.3 + life * 1.6;
        posArr[i * 3] = Math.cos(a) * r;
        posArr[i * 3 + 1] = 3.1 + life * 2.2 - life * life * 2.6;
        posArr[i * 3 + 2] = Math.sin(a) * r;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // ------------------------------------------------------------- portali
  buildPortals() {
    const stone = toonMat(0xf2e9fb);
    const stoneDark = toonMat(0xa995c0);
    WORLDS.forEach((world, i) => {
      const a = this.portalAngle(i);
      const x = Math.sin(a) * PORTAL_R;
      const z = Math.cos(a) * PORTAL_R;
      const color = new THREE.Color(world.color);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.lookAt(0, 0, 0);
      this.group.add(g);

      const base = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 3.4), stoneDark);
      base.position.y = 0.15;
      base.receiveShadow = true;
      g.add(base);
      const frame = new THREE.Group();
      g.add(frame);
      for (const s of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.3, 0.8), stone);
        pillar.position.set(s * 2.55, 2.45, 0);
        pillar.castShadow = true;
        frame.add(pillar);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 1.0), stoneDark);
        cap.position.set(s * 2.55, 0.42, 0);
        frame.add(cap);
      }
      const arch = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.38, 10, 40, Math.PI), stone);
      arch.position.y = 4.6;
      arch.scale.z = 1.05;
      arch.castShadow = true;
      frame.add(arch);
      const keystone = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, flatShading: true }));
      keystone.position.set(0, 7.15, 0.2);
      keystone.scale.y = 1.4;
      frame.add(keystone);
      addOutlines(frame, 0.035, 0x3a2a4a);

      // bordo luminoso interno
      const trimMat = new THREE.MeshBasicMaterial({ color });
      const trimShape = new THREE.Shape();
      trimShape.moveTo(-2.2, 0.3);
      trimShape.lineTo(-2.2, 4.6);
      trimShape.absarc(0, 4.6, 2.2, Math.PI, 0, true);
      trimShape.lineTo(2.2, 0.3);
      const trim = new THREE.Mesh(
        new THREE.TubeGeometry(shapeCurve(trimShape), 80, 0.06, 6, false),
        trimMat,
      );
      trim.position.z = 0.42;
      g.add(trim);

      // superficie del portale
      const shape = new THREE.Shape();
      shape.moveTo(-2.2, 0.3);
      shape.lineTo(2.2, 0.3);
      shape.lineTo(2.2, 4.6);
      shape.absarc(0, 4.6, 2.2, 0, Math.PI, false);
      shape.lineTo(-2.2, 0.3);
      const surf = new THREE.Mesh(
        new THREE.ShapeGeometry(shape, 24),
        new THREE.ShaderMaterial({
          side: THREE.DoubleSide,
          transparent: true,
          uniforms: { uTime: { value: 0 }, uColor: { value: color }, uSeed: { value: i * 3.7 }, uLocked: { value: world.ready ? 0 : 1 } },
          vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
          fragmentShader: /* glsl */ `
            varying vec2 vP; uniform float uTime, uSeed, uLocked; uniform vec3 uColor;
            ${NOISE_GLSL}
            void main(){
              vec2 p = vP - vec2(0.0, 3.0);
              float r = length(p);
              float ang = atan(p.y, p.x);
              // vortice + "anteprima" del mondo
              float sw = fbm(vec2(ang * 1.6 + uTime * 0.4, r * 0.9 - uTime * 0.7) + uSeed);
              vec3 sky = mix(uColor * 0.35, uColor * 1.1 + 0.15, smoothstep(-1.0, 4.0, vP.y));
              vec3 col = mix(sky, vec3(1.0), smoothstep(0.55, 0.85, sw) * 0.55);
              float horizon = smoothstep(1.4, 1.3, vP.y + fbm(vec2(vP.x * 0.8 + uSeed, 0.0)) * 0.9);
              col = mix(col, uColor * 0.18, horizon);
              col += uColor * pow(1.0 - clamp(r / 3.2, 0.0, 1.0), 3.0) * 0.8;
              float stars = step(0.985, noise(vP * 14.0 + uSeed)) * (0.5 + 0.5 * sin(uTime * 3.0 + vP.x * 9.0));
              col += stars;
              float stripes = step(0.5, fract((vP.x + vP.y) * 1.2 + uTime * 0.15));
              col = mix(col, col * (0.75 + stripes * 0.25), uLocked * 0.6);
              gl_FragColor = vec4(col, 0.94);
              #include <colorspace_fragment>
            }`,
        }),
      );
      surf.position.z = 0.02;
      g.add(surf);
      this.animated.push((dt, t) => {
        surf.material.uniforms.uTime.value = t;
        keystone.rotation.y += dt;
      });

      // pannello informativo
      const panel = new THREE.Group();
      panel.position.set(4.6, 0, 0.8);
      panel.rotation.y = -0.35;
      g.add(panel);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.2, 8), stoneDark);
      post.position.y = 0.6;
      panel.add(post);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 1.38),
        new THREE.MeshBasicMaterial({ map: worldCard(world), transparent: true }),
      );
      board.position.y = 1.75;
      board.rotation.x = -0.15;
      panel.add(board);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.48, 0.05), stoneDark);
      back.position.set(0, 1.75, -0.04);
      back.rotation.x = -0.15;
      panel.add(back);

      const label = makeTextSprite(world.name, { fontSize: 64, height: 0.75, glow: world.color });
      label.position.y = 8.3;
      g.add(label);

      // collisioni: pilastri e pannello
      const toWorld = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyQuaternion(g.quaternion).add(g.position);
      for (const s of [-1, 1]) {
        const p = toWorld(s * 2.55, 0);
        this.colliders.push({ x: p.x, z: p.z, r: 0.55 });
      }
      const pp = toWorld(4.6, 0.8);
      this.colliders.push({ x: pp.x, z: pp.z, r: 0.25 });
      const behind = toWorld(0, -0.3);
      this.colliders.push({ x: behind.x, z: behind.z, r: 0.5 });
      this.platforms.push({ x, z, r: 2.2, top: 0.3 });

      const point = toWorld(0, 2.3);
      const portal = { world, position: new THREE.Vector3(x, 0, z), interactPoint: point };
      this.portals.push(portal);
      this.interactables.push({ point, radius: 2.6, type: 'portal', data: portal, label: world.name });
    });
  }

  // ------------------------------------------------------------- specchio
  buildMirror() {
    const g = new THREE.Group();
    g.position.set(0, 0, -19.5);
    this.group.add(g);
    const W = 5;
    const H = 3;
    const mirror = new Reflector(new THREE.PlaneGeometry(W, H), {
      textureWidth: Math.min(1024, window.innerWidth),
      textureHeight: Math.min(1024, window.innerWidth) * (H / W),
      color: 0xd8d8e0,
      clipBias: 0.003,
    });
    mirror.position.set(0, 1.85, 0.06);
    g.add(mirror);
    const frameMat = toonMat(0xf2e9fb);
    const frame = new THREE.Group();
    const bar = (w, h, x, y) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25), frameMat);
      b.position.set(x, y, 0);
      b.castShadow = true;
      frame.add(b);
    };
    bar(W + 0.5, 0.25, 0, 1.85 + H / 2 + 0.12);
    bar(W + 0.5, 0.3, 0, 0.2);
    bar(0.25, H + 0.4, -W / 2 - 0.12, 1.85);
    bar(0.25, H + 0.4, W / 2 + 0.12, 1.85);
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.08), toonMat(0x5a4a70));
    back.position.set(0, 1.85, -0.04);
    frame.add(back);
    addOutlines(frame, 0.02, 0x3a2a4a);
    g.add(frame);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xff9ce8 }));
    glow.position.set(0, 1.85 + H / 2 + 0.3, 0.1);
    g.add(glow);
    const sign = makeTextSprite('Specchio', { fontSize: 44, height: 0.32, glow: '#ff9ce8' });
    sign.position.set(0, 3.95, 0.2);
    g.add(sign);
    for (let x = -2.5; x <= 2.5; x += 1) this.colliders.push({ x, z: -19.5, r: 0.45 });

    this.mirror = mirror;
    this.mirrorOn = true;
    const point = new THREE.Vector3(3.3, 0, -18.4);
    // interruttore accanto allo specchio
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.12), new THREE.MeshBasicMaterial({ color: 0x7ff0ff }));
    sw.position.set(3.15, 1.3, 0.1);
    g.add(sw);
    this.mirrorSwitch = sw;
    this.interactables.push({ point, radius: 1.8, type: 'mirror', label: 'Specchio on/off' });
  }

  toggleMirror(on = !this.mirrorOn) {
    this.mirrorOn = on;
    this.mirrorSwitch.material.color.set(on ? 0x7ff0ff : 0x554466);
  }

  // ------------------------------------------------------------- panchine
  makeBench() {
    const g = new THREE.Group();
    const wood = toonMat(0xd79a6a);
    const metal = toonMat(0x5a4a70);
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 0.15), wood);
      slat.position.set(0, 0.45, -0.18 + i * 0.18);
      g.add(slat);
    }
    for (let i = 0; i < 2; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.14, 0.05), wood);
      slat.position.set(0, 0.68 + i * 0.2, -0.3);
      slat.rotation.x = -0.15;
      g.add(slat);
    }
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.5), metal);
      leg.position.set(s * 0.85, 0.22, -0.02);
      g.add(leg);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.5), metal);
      arm.position.set(s * 0.98, 0.62, -0.02);
      g.add(arm);
    }
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    addOutlines(g, 0.012, 0x3a2a4a);
    return g;
  }

  addBench(x, z, facing) {
    const b = this.makeBench();
    b.position.set(x, 0, z);
    b.rotation.y = facing;
    this.group.add(b);
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const rx = Math.cos(facing);
    const rz = -Math.sin(facing);
    for (const s of [-0.7, 0, 0.7]) this.colliders.push({ x: x + rx * s - fx * 0.05, z: z + rz * s - fz * 0.05, r: 0.3 });
    for (const s of [-0.5, 0.5]) {
      const seat = { position: new THREE.Vector3(x + rx * s + fx * 0.02, 0, z + rz * s + fz * 0.02), facing };
      this.seats.push(seat);
      this.interactables.push({ point: new THREE.Vector3(x + rx * s + fx * 0.8, 0, z + rz * s + fz * 0.8), radius: 1.1, type: 'sit', data: seat, label: 'Siediti' });
    }
  }

  buildBenches() {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      if (i === 3) continue; // lato dello specchio
      this.addBench(Math.sin(a) * 8.6, Math.cos(a) * 8.6, a);
    }
    // davanti allo specchio
    for (const x of [-2.3, 2.3]) this.addBench(x, -14, Math.PI);
  }

  // ------------------------------------------------------------- alberi
  makeTree(kind, scale, r) {
    const group = new THREE.Group();
    const trunkMat = toonMat(kind === 'sakura' ? 0x7a4a5a : 0x8a5a3a);
    const leafColor = { sakura: [0xffb7d5, 0xff9cc6, 0xffd0e4], round: [0x6cc46a, 0x58b05c, 0x8ad97a], pine: [0x3f9a6a, 0x2f8a5e, 0x52ad78] }[kind];
    const h = (kind === 'pine' ? 1.6 : 2.2) * scale;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.24 * scale, h, 8), trunkMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    group.add(trunk);
    const geos = [];
    if (kind === 'pine') {
      for (let i = 0; i < 3; i++) {
        const c = new THREE.ConeGeometry((1.5 - i * 0.35) * scale, 1.6 * scale, 8);
        c.translate(0, h + i * 0.9 * scale, 0);
        geos.push(c);
      }
    } else {
      const n = kind === 'sakura' ? 7 : 6;
      for (let i = 0; i < n; i++) {
        const s = (0.8 + r() * 0.5) * scale;
        const b = new THREE.IcosahedronGeometry(s, 1);
        const a = (i / n) * Math.PI * 2 + r();
        const d = i === 0 ? 0 : 0.85 * scale;
        b.translate(Math.cos(a) * d, h + 0.5 * scale + (i === 0 ? 0.7 * scale : r() * 0.6 * scale), Math.sin(a) * d);
        geos.push(b);
      }
    }
    const leaves = new THREE.Mesh(mergeGeometries(geos), toonMat(leafColor[Math.floor(r() * 3)], { soft: true, flatShading: kind === 'pine' }));
    leaves.castShadow = true;
    group.add(leaves);
    addOutlines(group, 0.04 * scale, 0x2a2040);
    return { group, leaves };
  }

  buildTrees() {
    const r = rng(42);
    const placed = [];
    const parkourAngle = this.portalAngle(1) + Math.PI / 6;
    for (let tries = 0; placed.length < 30 && tries < 600; tries++) {
      const a = r() * Math.PI * 2;
      const d = PLAZA_R + 3 + r() * (ISLAND_R - PLAZA_R - 6);
      // lontano dai sentieri dei portali e dal percorso di salti
      let ok = true;
      for (let i = 0; i < WORLDS.length; i++) {
        const da = Math.abs(Math.atan2(Math.sin(a - this.portalAngle(i)), Math.cos(a - this.portalAngle(i))));
        if (da * d < 5.5) ok = false;
      }
      if (Math.abs(Math.atan2(Math.sin(a - parkourAngle), Math.cos(a - parkourAngle))) < 0.35) ok = false;
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      for (const p of placed) if (Math.hypot(p[0] - x, p[1] - z) < 4.5) ok = false;
      if (!ok) continue;
      placed.push([x, z]);
      const kind = ['sakura', 'round', 'pine', 'sakura'][Math.floor(r() * 4)];
      const scale = 0.9 + r() * 0.6;
      const { group, leaves } = this.makeTree(kind, scale, r);
      group.position.set(x, 0, z);
      group.rotation.y = r() * 6;
      this.group.add(group);
      this.colliders.push({ x, z, r: 0.3 * scale });
      const ph = r() * 6;
      this.animated.push((dt, t) => (leaves.rotation.z = Math.sin(t * 0.8 + ph) * 0.015));
    }
  }

  // ------------------------------------------------------------- lanterne
  buildLanterns() {
    const postMat = toonMat(0x4a3a60);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb860, emissiveIntensity: 2.2 });
    const roofMat = toonMat(0x4a3a60);
    const spots = [];
    WORLDS.forEach((_, i) => {
      const a = this.portalAngle(i);
      for (const d of [PLAZA_R + 3, PLAZA_R + 9]) {
        for (const s of [-1, 1]) {
          const x = Math.sin(a) * d + Math.cos(a) * 2.2 * s;
          const z = Math.cos(a) * d - Math.sin(a) * 2.2 * s;
          spots.push([x, z]);
        }
      }
    });
    for (const [x, z] of spots) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.2, 8), postMat);
      post.position.y = 1.1;
      post.castShadow = true;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.36, 6), lampMat);
      lamp.position.y = 2.35;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 6), roofMat);
      roof.position.y = 2.63;
      g.add(post, lamp, roof);
      addOutlines(post, 0.015, 0x2a2040);
      addOutlines(roof, 0.015, 0x2a2040);
      this.group.add(g);
      this.colliders.push({ x, z, r: 0.15 });
    }
  }

  // ------------------------------------------------------------- percorso di salti
  buildParkour() {
    const base = this.portalAngle(1) + Math.PI / 6;
    const rock = toonMat(0xb79ac8, { map: this.tex.rock, flatShading: true });
    const top = toonMat(0xe9dff5);
    const glow = new THREE.MeshBasicMaterial({ color: 0x9dff9a });
    const steps = 8;
    let last;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const a = base - 0.25 + t * 0.5;
      const d = PLAZA_R + 4 + t * 14;
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      const y = 0.75 + i * 0.75;
      const r = i === steps - 1 ? 3.2 : 1.25;
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const stone = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.6, 7), rock);
      stone.rotation.x = Math.PI;
      stone.position.y = -r * 0.8 - 0.15;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 7), top);
      cap.position.y = -0.15;
      cap.receiveShadow = cap.castShadow = true;
      const edge = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, 0.03, 6, 7), glow);
      edge.rotation.x = Math.PI / 2;
      g.add(stone, cap, edge);
      addOutlines(stone, 0.04, 0x2a2040);
      this.group.add(g);
      this.platforms.push({ x, z, r, top: y });
      const ph = i * 0.7;
      if (i < steps - 1) this.animated.push((dt, tt) => (stone.rotation.y = Math.sin(tt * 0.5 + ph) * 0.2));
      last = { x, y, z };
    }
    // isolotto panoramico con premio
    const tree = this.makeTree('sakura', 0.9, rng(5)).group;
    tree.position.set(last.x + 1.4, last.y, last.z);
    this.group.add(tree);
    this.colliders.push({ x: last.x + 1.4, z: last.z, r: 0.3 });
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35, 0),
      new THREE.MeshStandardMaterial({ color: 0x9dff9a, emissive: 0x5dff7a, emissiveIntensity: 2, flatShading: true }),
    );
    gem.position.set(last.x - 0.8, last.y + 1, last.z);
    gem.scale.y = 1.5;
    this.group.add(gem);
    this.gem = gem;
    this.animated.push((dt, t) => {
      gem.rotation.y += dt * 2;
      gem.position.y = last.y + 1 + Math.sin(t * 2) * 0.12;
    });
  }

  // ------------------------------------------------------------- bacheca
  buildWelcomeBoard() {
    const g = new THREE.Group();
    g.position.set(-6.5, 0, 17.5);
    g.rotation.y = Math.PI - 0.55;
    this.group.add(g);
    const tex = makePanelTexture((ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#2a1d52');
      grad.addColorStop(1, '#4a2a6a');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 40);
      ctx.fill();
      ctx.fillStyle = '#7ff0ff';
      ctx.font = '800 92px system-ui, sans-serif';
      ctx.fillText('Benvenuto in OASIS', 60, 130);
      ctx.fillStyle = '#ffd6f2';
      ctx.font = '500 40px system-ui, sans-serif';
      const lines = [
        'Personalizza il tuo avatar dal menu Personaggio',
        'Entra nei portali per visitare i mondi',
        'Siediti sulle panchine e prova lo specchio',
        'Emote: 1 saluto · 2 balla · 3 esulta · 4 siediti',
        'Trova il cristallo verde in cima alle rocce!',
      ];
      lines.forEach((l, i) => {
        ctx.fillStyle = i % 2 ? '#e6dcff' : '#ffd6f2';
        ctx.fillText('•  ' + l, 70, 230 + i * 74);
      });
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.12), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    board.position.y = 2.0;
    g.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.3, 0.08), toonMat(0xf2e9fb));
    frame.position.set(0, 2.0, -0.05);
    g.add(frame);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.0, 8), toonMat(0xf2e9fb));
      leg.position.set(s * 1.4, 0.5, -0.05);
      g.add(leg);
      const p = new THREE.Vector3(s * 1.4, 0, -0.05).applyQuaternion(g.quaternion).add(g.position);
      this.colliders.push({ x: p.x, z: p.z, r: 0.2 });
    }
    addOutlines(frame, 0.02, 0x2a2040);
  }

  // ------------------------------------------------------------- particelle
  buildParticles() {
    const N = 420;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const r = rng(99);
    const palette = [new THREE.Color(0xfff2a8), new THREE.Color(0xffb7d5), new THREE.Color(0x9ff4ff)];
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * ISLAND_R;
      pos.set([Math.sin(a) * d, 0.3 + r() * 9, Math.cos(a) * d], i * 3);
      const c = palette[i % 3];
      col.set([c.r, c.g, c.b], i * 3);
      seed[i] = r() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: window.innerHeight / 2 } },
      vertexShader: /* glsl */ `
        attribute vec3 color; attribute float seed; varying vec3 vC; varying float vA;
        uniform float uTime, uScale;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.3 + seed) * 0.8;
          p.z += cos(uTime * 0.25 + seed * 1.3) * 0.8;
          p.y += sin(uTime * 0.5 + seed * 2.0) * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = 0.13 * uScale / -mv.z;
          vC = color; vA = 0.4 + 0.6 * sin(uTime * 2.0 + seed * 5.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vC * 1.6, a * vA);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    this.animated.push((dt, t) => (mat.uniforms.uTime.value = t));
  }

  // ------------------------------------------------------------- runtime
  groundAt(x, z, y) {
    let ground = 0;
    for (const p of this.platforms) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.r * p.r && p.top <= y + 0.45 && p.top > ground) ground = p.top;
    }
    return ground;
  }

  update(dt, time, playerPos, isXR) {
    for (const fn of this.animated) fn(dt, time);
    // lo specchio costa un secondo rendering: solo se vicino, acceso e non in VR
    const near = playerPos.distanceTo(this.mirror.getWorldPosition(tmpV)) < 22;
    this.mirror.visible = this.mirrorOn && near && !isXR;
  }
}

const tmpV = new THREE.Vector3();

/** Converte un THREE.Shape in una curva 3D per il tubo luminoso. */
function shapeCurve(shape) {
  const pts = shape.getSpacedPoints(80).map((p) => new THREE.Vector3(p.x, p.y, 0));
  return new THREE.CatmullRomCurve3(pts);
}

function worldCard(world) {
  return makePanelTexture((ctx, w, h) => {
    ctx.fillStyle = 'rgba(20,14,40,0.92)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 36);
    ctx.fill();
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, world.color);
    g.addColorStop(1, 'rgba(255,255,255,0.15)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 18);
    ctx.fillStyle = world.color;
    ctx.font = '800 96px system-ui, sans-serif';
    ctx.fillText(world.name, 56, 150);
    ctx.fillStyle = '#e6e0ff';
    ctx.font = '500 48px system-ui, sans-serif';
    ctx.fillText(world.desc, 56, 240);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.roundRect(56, 320, 380, 80, 40);
    ctx.fill();
    ctx.fillStyle = world.ready ? '#5dff9a' : '#ffcf5a';
    ctx.font = '700 42px system-ui, sans-serif';
    ctx.fillText(world.ready ? '● Aperto' : '● In arrivo', 86, 375);
    ctx.fillStyle = '#b8b0d8';
    ctx.font = '500 40px system-ui, sans-serif';
    ctx.fillText('0 / 32 giocatori', 56, 500);
  });
}
