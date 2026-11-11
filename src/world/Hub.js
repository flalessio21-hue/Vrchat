import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { WORLDS } from './worlds.js';
import { makeTextSprite, makePanelTexture } from './textSprite.js';
import { loadGLTF, loadJSON } from '../core/assets.js';
import { rng } from '../core/toon.js';

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
 * Hub "Oasis". La geometria arriva da Blender (public/models/hub.glb, con
 * occlusione ambientale cotta nei colori dei vertici) e il layout di gioco da
 * public/models/hub.json. Qui aggiungiamo ciò che è dinamico: cielo, mare di
 * nuvole, acqua, portali animati, erba al vento, specchio, particelle e luci.
 */
export class Hub {
  static async load(onProgress) {
    const [gltf, layout] = await Promise.all([loadGLTF('models/hub.glb', onProgress), loadJSON('models/hub.json')]);
    Hub.asset = { gltf, layout };
  }

  constructor(scene, renderer) {
    const { gltf, layout } = Hub.asset;
    this.scene = scene;
    this.renderer = renderer;
    this.layout = layout;
    this.group = new THREE.Group();
    this.group.name = 'hub';
    scene.add(this.group);
    this.animated = [];

    // dati di gioco dal layout di Blender
    this.colliders = layout.colliders.map(([x, z, r]) => ({ x, z, r }));
    this.boxColliders = (layout.boxColliders || []).map(([x, z, hw, hd, rot]) => ({ x, z, hw, hd, rot, c: Math.cos(rot), s: Math.sin(rot) }));
    this.platforms = layout.platforms.map(([x, z, r, top]) => ({ x, z, r, top }));
    this.boxPlatforms = (layout.boxPlatforms || []).map(([x, z, hw, hd, rot, top]) => ({ x, z, hw, hd, rot, top, c: Math.cos(rot), s: Math.sin(rot) }));
    this.zones = layout.zones || [];
    this.destinations = (layout.destinations || []).map((d) => ({ name: d.name, pos: new THREE.Vector3(...d.pos), facing: d.facing }));
    this.decodeTerrain(layout.terrain);
    this.buildCollisionGrid();
    this.bounds = layout.bounds;
    this.spawn = new THREE.Vector3(...layout.spawn);
    this.seats = layout.seats.map((s) => ({ position: new THREE.Vector3(...s.position), facing: s.facing }));
    this.portals = layout.portals.map((p) => ({
      world: WORLDS.find((w) => w.id === p.id),
      position: new THREE.Vector3(...p.position),
      interactPoint: new THREE.Vector3(...p.interact),
    }));
    this.interactables = [
      ...this.portals.map((p) => ({ point: p.interactPoint, radius: 2.6, type: 'portal', data: p, label: p.world.name })),
      ...layout.interactables.map((it) => ({
        point: new THREE.Vector3(...it.point),
        radius: it.radius,
        type: it.type,
        label: it.label,
        data: it.type === 'sit' ? this.seats[it.seat] : it.type === 'teleport' ? this.destinations : it.type === 'shop' ? it.shop : null,
      })),
    ];

    scene.background = new THREE.Color(0xe7a0b0);
    scene.fog = new THREE.Fog(0xc993b8, 110, 640);

    this.buildLights();
    this.buildSky();
    this.buildEnvironment();
    this.buildCloudSea();
    this.setupWorld(gltf.scene);
    this.buildGrass();
    this.buildFountainFx();
    this.buildCampfire();
    this.buildSnowfall();
    this.buildBalloons();
    this.buildMirror();
    this.buildGem();
    this.buildParticles();
  }

  // ------------------------------------------------------------- luci
  buildLights() {
    this.group.add(new THREE.HemisphereLight(0xc4d0ff, 0x9a6a78, 0.9));
    const sun = new THREE.DirectionalLight(0xffd6b0, 2.8);
    sun.position.copy(SUN_DIR).multiplyScalar(60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 28;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 160 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    this.group.add(sun, sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x9fb6ff, 0.5);
    fill.position.set(40, 20, 50);
    this.group.add(fill);
    for (const l of this.layout.lights) {
      const p = new THREE.PointLight(l.color, l.intensity, l.distance, 1.5);
      p.position.set(...l.pos);
      this.group.add(p);
    }
  }

  followShadow(pos) {
    this.sun.position.copy(pos).addScaledVector(SUN_DIR, 60);
    this.sun.target.position.copy(pos);
  }

  // ------------------------------------------------------------- cielo
  skyMaterial() {
    return new THREE.ShaderMaterial({
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
          if (h > 0.0) {
            vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(uTime * 0.006, 0.0);
            float c = fbm(uv * 1.3);
            float band = smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.35, 0.6, h));
            float cl = smoothstep(0.52, 0.62, c) * band;
            vec3 cloudCol = mix(vec3(0.62, 0.45, 0.78), vec3(1.0, 0.78, 0.72), pow(sd, 2.0) * 0.8 + 0.2);
            cloudCol = mix(cloudCol, vec3(1.0, 0.9, 0.85), smoothstep(0.62, 0.75, c) * 0.4);
            col = mix(col, cloudCol, cl * 0.85);
          }
          vec2 sp = vec2(atan(d.z, d.x) * 120.0, h * 240.0);
          float star = step(0.996, hash(floor(sp)));
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp)) * 40.0);
          col += vec3(star * tw) * smoothstep(0.35, 0.8, h) * 0.9;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }

  buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), this.skyMaterial());
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);
    this.animated.push((dt, t) => (sky.material.uniforms.uTime.value = t));

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
            col += vec3(0.9,0.6,1.0) * pow(1.0 - abs(vN.z), 3.0) * 0.4;
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

  /** Mappa d'ambiente dal cielo: riflessi e luce indiretta per i materiali PBR. */
  buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const mat = this.skyMaterial();
    mat.uniforms.uTime.value = 10;
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: 0x5a7a50 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    envScene.add(ground);
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
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
          float c = fbm(p) * 0.7 + fbm(p * 2.7 - uTime * 0.008) * 0.3;
          vec3 col = mix(vec3(0.55, 0.42, 0.72), vec3(1.0, 0.82, 0.82), smoothstep(0.35, 0.7, c));
          col += vec3(1.0, 0.7, 0.45) * pow(max(dot(normalize(vW.xz), normalize(uSun.xz)), 0.0), 8.0) * 0.25;
          float a = smoothstep(0.3, 0.55, c) * (1.0 - smoothstep(600.0, 1300.0, length(vW.xz)));
          gl_FragColor = vec4(col, a * 0.95);
          #include <colorspace_fragment>
        }`,
    });
    for (const [y, s] of [[-42, 1], [-34, 1.6]]) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800), mat.clone());
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = y;
      sea.scale.setScalar(s);
      this.group.add(sea);
      this.animated.push((dt, t) => (sea.material.uniforms.uTime.value = t * s));
    }
  }

  // ------------------------------------------------------------- mondo da Blender
  setupWorld(root) {
    this.group.add(root);
    const waterMat = this.waterMaterial();
    const instanceSources = [];
    root.traverse((o) => {
      if (o.name.startsWith('Inst_') && !o.isMesh) instanceSources.push(o);
      if (!o.isMesh) return;
      const name = o.name;
      const mat = o.material;
      if (o.geometry.attributes.color) mat.vertexColors = true;
      if (mat.name.startsWith('Glow') || mat.name === 'Lantern' || mat.name === 'Crystal' || mat.name === 'GemGreen') {
        mat.toneMapped = true;
        mat.emissiveIntensity = Math.min(mat.emissiveIntensity, 2.5);
      }
      if (mat.name.startsWith('Leaves') || mat.name === 'Bush') {
        mat.roughness = 0.9;
        mat.side = THREE.FrontSide;
      }
      if (mat.name === 'Flower') mat.side = THREE.DoubleSide;
      if (name.startsWith('Water_lake')) {
        o.material = this.lakeMaterial();
        o.receiveShadow = false;
        return;
      }
      if (mat.name === 'Water') {
        o.material = waterMat;
        return;
      }
      if (name.startsWith('Inst_') || o.parent?.name.startsWith('Inst_')) {
        if (!o.parent?.name.startsWith('Inst_')) instanceSources.push(o);
        return;
      }
      if (name === 'Screen_holo') {
        o.material = this.screenMaterial();
        return;
      }
      if (name.startsWith('Board_neon_')) {
        const k = Number(name.slice(11));
        const tex = neonSign((this.layout.signs || [])[k] || 'OASIS', k);
        tex.flipY = false;
        o.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
        return;
      }
      if (name.startsWith('Boat_')) {
        const y0 = o.position.y;
        const ph = Number(name.slice(5)) * 1.7;
        const ry = o.rotation.y;
        this.animated.push((dt, t) => {
          o.position.y = y0 + Math.sin(t * 1.3 + ph) * 0.06;
          o.rotation.z = Math.sin(t * 0.9 + ph) * 0.04;
          o.rotation.y = ry + Math.sin(t * 0.2 + ph) * 0.15;
        });
      }
      if (name.startsWith('Portal_')) {
        const id = name.slice(7);
        o.material = this.portalMaterial(WORLDS.find((w) => w.id === id));
        return;
      }
      const bt = this.layout.boardTexts?.[name];
      if (bt) {
        const tex = textBoard(bt.text, bt.style, bt.aspect);
        tex.flipY = false;
        o.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: bt.style !== 'shop' });
        return;
      }
      if (name === 'Windmill_blades') {
        this.animated.push((dt) => o.rotateZ(dt * 0.7));
      }
      if (name.startsWith('Board_')) {
        const id = name.slice(6);
        const tex = id === 'welcome' ? welcomeTexture() : worldCard(WORLDS.find((w) => w.id === id));
        tex.flipY = false;
        o.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
        return;
      }
      if (name === 'MirrorSurface') {
        o.visible = false;
        return;
      }
      if (name === 'Crystal') {
        this.crystal = o;
        return;
      }
      if (o.parent && o.parent.name.startsWith('Inst_')) return; // parti di una sorgente di istanze
      const big = name === 'Terrain' || name === 'Tiles' || name === 'Grout' || name === 'Cliff' || name === 'Path' || name === 'CitySidewalks';
      o.castShadow = !big && !name.startsWith('FarIsland');
      o.receiveShadow = !name.startsWith('FarIsland');
    });

    this.buildInstances(instanceSources);

    // cristallo con anelli
    if (this.crystal) {
      const c = this.crystal;
      const base = c.position.y;
      const rings = [1.9, 2.4].map((r, i) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 96), new THREE.MeshBasicMaterial({ color: i ? 0xff9ce8 : 0x8ff6ff }));
        ring.position.copy(c.position);
        this.group.add(ring);
        return ring;
      });
      const shell = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.45, 0),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      shell.scale.y = 1.4;
      c.add(shell);
      this.animated.push((dt, t) => {
        c.position.y = base + Math.sin(t * 0.9) * 0.25;
        c.rotation.y += dt * 0.5;
        shell.rotation.y -= dt * 0.8;
        rings[0].position.y = rings[1].position.y = c.position.y;
        rings[0].rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.4, t * 0.6, 0);
        rings[1].rotation.set(Math.PI / 2 + Math.cos(t * 0.5) * 0.5, -t * 0.4, 0.3);
      });
    }

    // etichette sopra i portali
    for (const p of this.portals) {
      const label = makeTextSprite(p.world.name, { fontSize: 64, height: 0.75, glow: p.world.color });
      label.position.copy(p.position).setY(9.2);
      this.group.add(label);
    }
  }

  waterMaterial() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vW; void main(){ vP = position; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0);} `,
      fragmentShader: /* glsl */ `
        varying vec3 vP; varying vec3 vW; uniform float uTime;
        ${NOISE_GLSL}
        void main(){
          vec2 p = vP.xz;
          float d = length(p);
          float R = vW.y > 1.5 ? 1.95 : 4.74;
          float rip = sin(d * 5.0 - uTime * 2.5) * 0.5 + 0.5;
          float n = noise(p * 1.5 + uTime * 0.4);
          vec3 col = mix(vec3(0.18, 0.5, 0.85), vec3(0.45, 0.9, 1.0), step(0.55, rip * 0.6 + n * 0.5));
          float foam = step(R - 0.25 - n * 0.2, d) + step(d, 0.9 + n * 0.3);
          col = mix(col, vec3(0.95, 1.0, 1.0), clamp(foam, 0.0, 1.0));
          col += step(0.97, noise(p * 6.0 + uTime * 1.2)) * 0.6;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.animated.push((dt, t) => (mat.uniforms.uTime.value = t));
    return mat;
  }

  portalMaterial(world) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(world.color) },
        uSeed: { value: WORLDS.indexOf(world) * 3.7 },
        uLocked: { value: world.ready ? 0 : 1 },
      },
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        varying vec2 vP; uniform float uTime, uSeed, uLocked; uniform vec3 uColor;
        ${NOISE_GLSL}
        void main(){
          vec2 p = vP - vec2(0.0, 3.4);
          float r = length(p);
          float ang = atan(p.y, p.x);
          float sw = fbm(vec2(ang * 1.6 + uTime * 0.4, r * 0.9 - uTime * 0.7) + uSeed);
          vec3 sky = mix(uColor * 0.35, uColor * 1.1 + 0.15, smoothstep(-1.0, 5.0, vP.y));
          vec3 col = mix(sky, vec3(1.0), smoothstep(0.55, 0.85, sw) * 0.55);
          float horizon = smoothstep(1.6, 1.5, vP.y + fbm(vec2(vP.x * 0.8 + uSeed, 0.0)) * 0.9);
          col = mix(col, uColor * 0.18, horizon);
          col += uColor * pow(1.0 - clamp(r / 3.4, 0.0, 1.0), 3.0) * 0.8;
          col += step(0.985, noise(vP * 14.0 + uSeed)) * (0.5 + 0.5 * sin(uTime * 3.0 + vP.x * 9.0));
          float stripes = step(0.5, fract((vP.x + vP.y) * 1.2 + uTime * 0.15));
          col = mix(col, col * (0.75 + stripes * 0.25), uLocked * 0.6);
          gl_FragColor = vec4(col, 0.94);
          #include <colorspace_fragment>
        }`,
    });
    this.animated.push((dt, t) => (mat.uniforms.uTime.value = t));
    return mat;
  }

  // ------------------------------------------------------------- terreno e collisioni
  decodeTerrain(t) {
    const bin = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const hb = bin(t.heights);
    this.terrain = {
      n: t.n,
      step: t.step,
      origin: t.origin,
      heights: new Int16Array(hb.buffer, hb.byteOffset, hb.byteLength / 2),
      grass: bin(t.grass),
    };
  }

  /** Altezza del terreno (interpolazione bilineare della mappa di Blender). */
  terrainHeight(x, z) {
    const { n, step, origin, heights } = this.terrain;
    const fx = Math.min(Math.max((x - origin) / step, 0), n - 1.001);
    const fz = Math.min(Math.max((z - origin) / step, 0), n - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = (a, b) => heights[b * n + a] / 100;
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
  }

  buildCollisionGrid() {
    const CELL = 16;
    this.cell = CELL;
    this.grid = new Map();
    const add = (minX, maxX, minZ, maxZ, item) => {
      for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) {
        for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
          const k = gx * 10007 + gz;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(item);
        }
      }
    };
    for (const c of this.colliders) add(c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r, c);
    for (const b of this.boxColliders) {
      const r = Math.hypot(b.hw, b.hd);
      add(b.x - r, b.x + r, b.z - r, b.z + r, { box: b });
    }
    for (const p of this.platforms) add(p.x - p.r, p.x + p.r, p.z - p.r, p.z + p.r, { plat: p });
    for (const b of this.boxPlatforms) {
      const r = Math.hypot(b.hw, b.hd);
      add(b.x - r, b.x + r, b.z - r, b.z + r, { bplat: b });
    }
  }

  /** Oggetti di collisione vicini a (x, z). */
  nearby(x, z) {
    const out = [];
    const gx = Math.floor(x / this.cell);
    const gz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.grid.get((gx + i) * 10007 + gz + j);
        if (list) for (const it of list) if (!out.includes(it)) out.push(it);
      }
    }
    return out;
  }

  zoneAt(x, z) {
    let best = null;
    let bd = Infinity;
    for (const zn of this.zones) {
      const d = Math.hypot(x - zn.x, z - zn.z);
      if (d < zn.r && d / zn.r < bd) {
        bd = d / zn.r;
        best = zn.name;
      }
    }
    return best || 'Campagna di Oasis';
  }

  // ------------------------------------------------------------- istanze (alberi, rocce, fiori...)
  buildInstances(sources) {
    const data = this.layout.instances || {};
    const CHUNK = 128;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    this.instanceChunks = [];
    for (const src of sources) {
      const kind = src.name.slice(5);
      const list = data[kind];
      src.visible = false;
      if (!list || !list.length) continue;
      // parti del modello (relative alla radice della sorgente)
      const parts = [];
      src.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
      src.traverse((o) => {
        if (o.isMesh) parts.push({ mesh: o, local: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
      });
      const chunks = new Map();
      for (const it of list) {
        const key = `${Math.floor(it[0] / CHUNK)},${Math.floor(it[2] / CHUNK)}`;
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(it);
      }
      for (const items of chunks.values()) {
        for (const part of parts) {
          const mat = part.mesh.material;
          if (part.mesh.geometry.attributes.color) mat.vertexColors = true;
          const im = new THREE.InstancedMesh(part.mesh.geometry, mat, items.length);
          items.forEach(([x, y, z, rot, s], i) => {
            m.compose(p.set(x, y, z), q.setFromAxisAngle(up, rot), sc.set(s, s, s)).multiply(part.local);
            im.setMatrixAt(i, m);
          });
          im.computeBoundingSphere();
          im.castShadow = kind !== 'flowers';
          im.receiveShadow = true;
          this.group.add(im);
          this.instanceChunks.push(im);
        }
      }
    }
  }

  // ------------------------------------------------------------- erba al vento (segue il giocatore)
  buildGrass() {
    const t = this.terrain;
    // texture con altezze e quantità d'erba, lette dallo shader
    const n = t.n;
    const hdata = new Uint16Array(n * n);
    for (let i = 0; i < n * n; i++) hdata[i] = THREE.DataUtils.toHalfFloat(t.heights[i] / 100);
    const hTex = new THREE.DataTexture(hdata, n, n, THREE.RedFormat, THREE.HalfFloatType);
    hTex.magFilter = hTex.minFilter = THREE.LinearFilter;
    hTex.needsUpdate = true;
    const gTex = new THREE.DataTexture(t.grass, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    gTex.magFilter = gTex.minFilter = THREE.LinearFilter;
    gTex.needsUpdate = true;

    const mobile = matchMedia('(pointer: coarse)').matches;
    const N = mobile ? 16000 : 30000;
    const TILE = 64;
    const blade = new THREE.InstancedBufferGeometry();
    const w = 0.06;
    const h = 0.34;
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, -w * 0.6, h * 0.5, 0.02, w * 0.6, h * 0.5, 0.02, 0, h, 0.06], 3));
    blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0.3, 1, 0, 0.3, 1, 0, 0.5, 1, 0, 0.5, 1, 0, 0.8, 0.6], 3));
    blade.setAttribute('h', new THREE.Float32BufferAttribute([0, 0, 0.5, 0.5, 1], 1));
    blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    const off = new Float32Array(N * 4);
    const r = rng(77);
    for (let i = 0; i < N; i++) off.set([(r() - 0.5) * TILE, (r() - 0.5) * TILE, r() * Math.PI * 2, r()], i * 4);
    blade.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    blade.instanceCount = N;

    const uni = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
      uHeight: { value: hTex },
      uGrass: { value: gTex },
      uMap: { value: new THREE.Vector3(t.origin, t.step * (n - 1), TILE) },
    };
    this.grassUniforms = uni;
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uni);
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `attribute float h; attribute vec4 aOff;
           uniform float uTime; uniform vec2 uCenter; uniform sampler2D uHeight; uniform sampler2D uGrass; uniform vec3 uMap;
           varying float vH; varying float vR;
           void main() {
             vH = h; vR = aOff.w;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float T = uMap.z;
           vec2 wp = uCenter + mod(aOff.xy - uCenter + 0.5 * T, T) - 0.5 * T;
           vec2 uv = (wp - uMap.x) / uMap.y;
           float g = texture2D(uGrass, uv).r;
           float edge = 1.0 - smoothstep(T * 0.32, T * 0.5, length(wp - uCenter));
           float s = step(aOff.w * 0.85 + 0.1, g) * edge * (0.7 + aOff.w * 0.8);
           float c = cos(aOff.z), sn = sin(aOff.z);
           transformed = vec3(c * transformed.x + sn * transformed.z, transformed.y, -sn * transformed.x + c * transformed.z) * s;
           float wind = sin(uTime * 1.7 + wp.x * 0.35 + wp.y * 0.22) * 0.5 + sin(uTime * 3.1 + wp.x * 1.3) * 0.15;
           transformed.x += wind * h * h * 0.14 * s;
           transformed.z += wind * h * h * 0.08 * s;
           transformed += vec3(wp.x, texture2D(uHeight, uv).r, wp.y);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying float vH; varying float vR;\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           vec3 gcol = mix(vec3(0.16, 0.36, 0.12), vec3(0.42, 0.62, 0.2), vR);
           diffuseColor.rgb = gcol * mix(0.45, 1.25, vH);`,
        );
    };
    const mesh = new THREE.Mesh(blade, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.animated.push((dt, time) => (uni.uTime.value = time));
  }

  lakeMaterial() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSun: { value: SUN_DIR } }]),
      vertexShader: /* glsl */ `
        varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          vec4 mvPosition = viewMatrix * vec4(vW, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW; uniform float uTime; uniform vec3 uSun;
        #include <fog_pars_fragment>
        ${NOISE_GLSL}
        void main(){
          vec2 p = vW.xz;
          float n1 = noise(p * 0.35 + vec2(uTime * 0.25, uTime * 0.1));
          float n2 = noise(p * 1.1 - vec2(uTime * 0.4, -uTime * 0.2));
          vec3 nrm = normalize(vec3((n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.3, 1.0, (n2 - 0.5) * 0.5));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(v, nrm), 0.0), 3.0);
          vec3 deep = vec3(0.12, 0.38, 0.62);
          vec3 sky = vec3(0.85, 0.62, 0.8);
          vec3 col = mix(deep, sky, 0.25 + fres * 0.6);
          float spec = pow(max(dot(reflect(-uSun, nrm), v), 0.0), 120.0);
          col += vec3(1.0, 0.85, 0.65) * spec * 1.5;
          col += step(0.985, noise(p * 3.0 + uTime)) * 0.25;
          gl_FragColor = vec4(col, 0.88);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.animated.push((dt, t) => (mat.uniforms.uTime.value = t));
    return mat;
  }

  screenMaterial() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      toneMapped: false,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} ',
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uTime;
        ${NOISE_GLSL}
        void main(){
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
          float t = uTime * 0.4;
          vec3 a = vec3(0.25, 0.9, 1.0), b = vec3(1.0, 0.3, 0.85), c = vec3(0.55, 0.3, 1.0);
          float wave = sin(uv.x * 6.0 + t * 2.0) * 0.5 + 0.5;
          vec3 col = mix(mix(c, a, wave), b, fbm(uv * 3.0 + t) * 0.8);
          float bars = step(0.5, fract(uv.x * 24.0)) * step(uv.y, 0.25 + 0.6 * noise(vec2(floor(uv.x * 24.0), t * 3.0)));
          col = mix(col * 0.35, col, bars * 0.6 + 0.4);
          float ring = abs(length((uv - vec2(0.5, 0.42)) * vec2(1.6, 1.0)) - 0.18 - 0.02 * sin(t * 4.0));
          col += vec3(1.0) * smoothstep(0.02, 0.0, ring);
          col *= 0.85 + 0.15 * sin(uv.y * 400.0);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.animated.push((dt, t) => (mat.uniforms.uTime.value = t));
    return mat;
  }

  buildCampfire() {
    const pos = this.layout.campfire;
    if (!pos) return;
    const light = new THREE.PointLight(0xff9a40, 30, 16, 1.6);
    light.position.set(pos[0], pos[1] + 0.6, pos[2]);
    this.group.add(light);
    const N = 70;
    const arr = new Float32Array(N * 3);
    const seeds = Array.from({ length: N }, rng(11));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const flames = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xffa040, size: 0.35, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flames.frustumCulled = false;
    this.group.add(flames);
    this.animated.push((dt, t) => {
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        const life = (t * 0.9 + s) % 1;
        const a = s * 40;
        const r = 0.35 * (1 - life);
        arr[i * 3] = pos[0] + Math.cos(a) * r;
        arr[i * 3 + 1] = pos[1] + life * 1.4;
        arr[i * 3 + 2] = pos[2] + Math.sin(a) * r;
      }
      geo.attributes.position.needsUpdate = true;
      light.intensity = 26 + Math.sin(t * 13) * 4 + Math.sin(t * 7.3) * 3;
    });
  }

  // ------------------------------------------------------------- fontana: getti d'acqua
  buildFountainFx() {
    const N = 300;
    const pos = new Float32Array(N * 3);
    const seeds = Array.from({ length: N }, rng(5));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const drops = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8f8ff, size: 0.08, transparent: true, opacity: 0.85, depthWrite: false }));
    drops.frustumCulled = false;
    this.group.add(drops);
    this.animated.push((dt, t) => {
      for (let i = 0; i < N; i++) {
        const sd = seeds[i];
        const life = (t * 0.55 + sd) % 1;
        const a = sd * Math.PI * 14;
        const r = 0.25 + life * 1.75;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = 4.0 + life * 1.6 - life * life * 2.6;
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // ------------------------------------------------------------- specchio
  buildMirror() {
    const { center, size } = this.layout.mirror;
    const [W, H] = size;
    const res = Math.min(1024, window.innerWidth);
    const mirror = new Reflector(new THREE.PlaneGeometry(W, H), {
      textureWidth: res,
      textureHeight: Math.round((res * H) / W),
      color: 0xdcdce4,
      clipBias: 0.003,
    });
    mirror.position.set(...center);
    this.group.add(mirror);
    this.mirror = mirror;
    this.mirrorOn = true;
  }

  toggleMirror(on = !this.mirrorOn) {
    this.mirrorOn = on;
  }

  buildGem() {
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35, 0),
      new THREE.MeshStandardMaterial({ color: 0x9dff9a, emissive: 0x5dff7a, emissiveIntensity: 2, flatShading: true }),
    );
    gem.position.set(...this.layout.gem);
    gem.scale.y = 1.5;
    this.group.add(gem);
    this.gem = gem;
    const y0 = gem.position.y;
    this.animated.push((dt, t) => {
      gem.rotation.y += dt * 2;
      gem.position.y = y0 + Math.sin(t * 2) * 0.12;
    });
  }

  // ------------------------------------------------------------- particelle
  buildParticles() {
    const N = 420;
    const R = this.layout.islandRadius;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const r = rng(99);
    const palette = [new THREE.Color(0xfff2a8), new THREE.Color(0xffb7d5), new THREE.Color(0x9ff4ff)];
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * R;
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
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(vC * 1.6, a * vA);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    this.animated.push((dt, t) => (mat.uniforms.uTime.value = t));
  }

  // ------------------------------------------------------------- runtime
  /** Altezza calpestabile sotto (x, z) partendo dall'altezza y (terreno + piattaforme). */
  groundAt(x, z, y) {
    let ground = this.terrainHeight(x, z);
    for (const it of this.nearby(x, z)) {
      if (it.plat) {
        const p = it.plat;
        const dx = x - p.x;
        const dz = z - p.z;
        if (dx * dx + dz * dz <= p.r * p.r && p.top <= y + 0.45 && p.top > ground) ground = p.top;
      } else if (it.bplat) {
        const b = it.bplat;
        const dx = x - b.x;
        const dz = z - b.z;
        const lx = dx * b.c - dz * b.s;
        const lz = dx * b.s + dz * b.c;
        if (Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd && b.top <= y + 0.45 && b.top > ground) ground = b.top;
      }
    }
    return ground;
  }

  /** Il punto è sul laghetto ghiacciato? (si scivola) */
  onIce(x, z) {
    const ice = this.layout.ice;
    return !!ice && Math.hypot(x - ice.x, z - ice.z) < ice.r;
  }

  zoneTheme(x, z) {
    for (const zn of this.zones) if (zn.theme && Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn.theme;
    return null;
  }

  // ------------------------------------------------------------- neve che cade (solo nella valle)
  buildSnowfall() {
    const N = 2500;
    const pos = new Float32Array(N * 3);
    const r = rng(42);
    for (let i = 0; i < N; i++) pos.set([(r() - 0.5) * 60, r() * 30, (r() - 0.5) * 60], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    this.group.add(pts);
    this.snow = { pts, pos, base: pos.slice() };
  }

  updateSnow(dt, t, p) {
    const s = this.snow;
    const want = this.zoneTheme(p.x, p.z) === 'snow';
    s.pts.visible = want;
    if (!want) return;
    const { pos, base } = s;
    for (let i = 0; i < pos.length; i += 3) {
      const y = (((base[i + 1] - t * 1.6) % 30) + 30) % 30;
      pos[i] = p.x + ((((base[i] + Math.sin(t * 0.5 + i) * 1.5 - p.x) % 60) + 90) % 60) - 30;
      pos[i + 1] = this.terrainHeight(p.x, p.z) + y;
      pos[i + 2] = p.z + ((((base[i + 2] - p.z) % 60) + 90) % 60) - 30;
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------- mongolfiere sopra la piazza
  buildBalloons() {
    const cols = [['#ff6a8a', '#ffe08a'], ['#7ff0ff', '#ffffff'], ['#a98bff', '#ffcf5a'], ['#7dff9a', '#ff9ce8'], ['#ffb02e', '#ff4d6d']];
    cols.forEach(([a, b], i) => {
      const tex = makePanelTexture((ctx, w, h) => {
        for (let k = 0; k < 12; k++) {
          ctx.fillStyle = k % 2 ? a : b;
          ctx.fillRect((k * w) / 12, 0, w / 12 + 1, h);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(0, h * 0.82, w, h * 0.04);
      }, 256, 256);
      const g = new THREE.Group();
      const env = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 16), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
      env.scale.y = 1.2;
      const basket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.9 }));
      basket.position.y = -6.3;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb060 }));
      flame.position.y = -5.4;
      g.add(env, basket, flame);
      for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6), new THREE.MeshBasicMaterial({ color: 0x5a4030 }));
        rope.position.set(x * 1.4, -4.6, z * 1.4);
        rope.rotation.z = x * 0.35;
        rope.rotation.x = -z * 0.35;
        g.add(rope);
      }
      this.group.add(g);
      const R = 55 + i * 18;
      const h0 = 38 + i * 9;
      const sp = 0.012 + i * 0.003;
      const ph = i * 1.3;
      this.animated.push((dt, t) => {
        const a = ph + t * sp;
        g.position.set(Math.sin(a) * R, h0 + Math.sin(t * 0.3 + i) * 3, Math.cos(a) * R);
        flame.scale.setScalar(0.8 + Math.random() * 0.4);
      });
    });
  }

  update(dt, time, playerPos, isXR) {
    for (const fn of this.animated) fn(dt, time);
    this.updateSnow(dt, time, playerPos);
    this.grassUniforms?.uCenter.value.set(playerPos.x, playerPos.z);
    const near = playerPos.distanceTo(this.mirror.position) < 22;
    this.mirror.visible = this.mirrorOn && near && !isXR;
  }
}

function worldCard(world) {
  return makePanelTexture((ctx, w, h) => {
    ctx.fillStyle = 'rgba(20,14,40,0.95)';
    ctx.fillRect(0, 0, w, h);
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

function welcomeTexture() {
  return makePanelTexture((ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2a1d52');
    grad.addColorStop(1, '#4a2a6a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7ff0ff';
    ctx.font = '800 92px system-ui, sans-serif';
    ctx.fillText('Benvenuto in OASIS', 60, 130);
    ctx.font = '500 40px system-ui, sans-serif';
    [
      'Personalizza il tuo avatar dal menu Personaggio',
      'Entra nei portali per visitare i mondi',
      'Siediti sulle panchine e prova lo specchio',
      'Emote: 1 saluto · 2 balla · 3 esulta · 4 siediti',
      'Trova il cristallo verde in cima alle rocce!',
    ].forEach((l, i) => {
      ctx.fillStyle = i % 2 ? '#e6dcff' : '#ffd6f2';
      ctx.fillText('•  ' + l, 70, 230 + i * 74);
    });
  });
}

function neonSign(text, k) {
  const colors = ['#7ff0ff', '#ff7ae0', '#ffcf5a', '#9dff9a', '#b69bff'];
  const col = colors[k % colors.length];
  return makePanelTexture((ctx, w, h) => {
    ctx.fillStyle = '#120a24';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = col;
    ctx.lineWidth = 10;
    ctx.shadowColor = col;
    ctx.shadowBlur = 30;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.font = '900 150px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 40;
    ctx.fillText(text, w / 2, h / 2 + 6, w - 90);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = col;
    ctx.fillText(text, w / 2, h / 2 + 6, w - 90);
  }, 1024, 276);
}

/** Cartello con testo: legno (borgo), pietra, oriente o insegna di negozio. */
function textBoard(text, style, aspect = 3.5) {
  const W = 1024;
  const Hh = Math.round(W / aspect);
  const styles = {
    wood: { bg: '#6b4426', border: '#3a2414', color: '#ffe8c0', font: '800 {s}px Georgia, serif' },
    stone: { bg: '#7a7470', border: '#4a4440', color: '#f4f0e8', font: '800 {s}px Georgia, serif' },
    east: { bg: '#a0141c', border: '#e8b84a', color: '#ffd76a', font: '900 {s}px system-ui, sans-serif' },
    shop: { bg: '#1c1640', border: '#7ff0ff', color: '#ffffff', font: '900 {s}px system-ui, sans-serif' },
  };
  const st = styles[style] || styles.wood;
  return makePanelTexture((ctx, w, h) => {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, w, h);
    if (style === 'wood') {
      for (let y = 0; y < h; y += 18) {
        ctx.fillStyle = `rgba(0,0,0,${0.05 + (y % 36 ? 0.04 : 0)})`;
        ctx.fillRect(0, y, w, 8);
      }
    }
    ctx.strokeStyle = st.border;
    ctx.lineWidth = 16;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    let size = Math.round(h * 0.55);
    ctx.font = st.font.replace('{s}', size);
    while (ctx.measureText(text).width > w * 0.88 && size > 20) {
      size -= 4;
      ctx.font = st.font.replace('{s}', size);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (style === 'shop') {
      ctx.shadowColor = st.border;
      ctx.shadowBlur = 24;
    }
    ctx.fillStyle = st.color;
    ctx.fillText(text, w / 2, h / 2 + 4);
  }, W, Hh);
}
