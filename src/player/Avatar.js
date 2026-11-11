import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DEFAULT_AVATAR, sanitizeAvatar } from './avatarConfig.js';
import { drawFace, shade } from './avatarParts.js';
import { toonGradient, outlineMaterial } from '../core/toon.js';
import { loadGLTF } from '../core/assets.js';
import { makeNameTag } from '../world/textSprite.js';

const URL = 'models/avatar.glb';
const OUTLINE = 0.009; // contorno spesso: look da cartone animato
// gambe più corte: proporzioni "chibi" (scala delle cosce e abbassamento del bacino)
const LEG_SCALE = 0.84;
const LEG_DROP = 0.86 * (1 - LEG_SCALE);

// varianti presenti nel modello Blender (nome oggetto -> opzione)
const VARIANTS = {
  hair: ['short', 'spiky', 'bob', 'long', 'ponytail', 'twintails', 'buns'].map((v) => [v, `Hair_${v}`]),
  top: ['hoodie', 'jacket', 'tshirt', 'cyber'].map((v) => [v, `Top_${v}`]),
  bottom: ['pants', 'shorts', 'skirt', 'cargo'].map((v) => [v, `Bottom_${v}`]),
  shoes: ['sneakers', 'boots'].map((v) => [v, `Shoes_${v}`]),
  accessory: ['catears', 'foxears', 'halo', 'headphones', 'glasses', 'horns', 'wings', 'visor', 'crown', 'backpack'].map((v) => [v, `Acc_${v}`]),
};

// velocità (m/s) a cui le animazioni di camminata/corsa non "scivolano"
const WALK_SPEED = 2.3;
const RUN_SPEED = 4.6;
const EMOTES = ['wave', 'dance', 'cheer', 'sit', 'floor'];

/**
 * Materiale toon con luce di contorno (rim light), stile avatar social VR.
 * shine: riflesso "ad anello" tipico dei capelli anime.
 */
function avatarToon(color, opts = {}, shine = false) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(true), ...opts });
  m.userData.rim = { value: new THREE.Color(0xffc8e8) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = m.userData.rim;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
         outgoingLight += uRim * rimF * 0.35;
         ${shine ? `float hs = dot(normal, normalize(vec3(0.0, 0.75, 0.66)));
         float band = smoothstep(0.80, 0.86, hs) * (1.0 - smoothstep(0.92, 0.97, hs));
         outgoingLight += vec3(1.0) * band * 0.22;` : ''}
         #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => (shine ? 'toon-shine' : 'toon');
  return m;
}

/**
 * Avatar creato in Blender (tools/blender/avatar.py): mesh con scheletro,
 * varianti di capelli/vestiti/accessori e animazioni. Qui scegliamo le
 * varianti visibili, coloriamo i materiali, disegniamo il viso e fondiamo
 * le animazioni (camminata/corsa sincronizzate con la velocità, emote).
 */
export class Avatar {
  static async load(onProgress) {
    Avatar.asset = await loadGLTF(URL, onProgress);
  }

  constructor(config = DEFAULT_AVATAR, { npc = false } = {}) {
    if (!Avatar.asset) throw new Error('Avatar.load() deve essere chiamato prima');
    this.npc = npc;
    this.riding = null; // 'ride_stand' | 'ride_sit' quando si usa un veicolo
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.model = SkeletonUtils.clone(Avatar.asset.scene);
    this.body.add(this.model);

    this.mats = {
      Skin: avatarToon(0xffffff),
      Hair: avatarToon(0xffffff, {}, true),
      Top: avatarToon(0xffffff),
      TopDark: avatarToon(0xffffff),
      Shirt: avatarToon(0xf4f2fa),
      Bottom: avatarToon(0xffffff),
      Shoes: avatarToon(0xffffff),
      Sole: avatarToon(0xf0eef5),
      Dark: avatarToon(0x2a2433),
      White: avatarToon(0xffffff),
      Pink: avatarToon(0xffb3c8),
      Gold: Object.assign(avatarToon(0xffcf6a), { emissive: new THREE.Color(0x553300) }),
      Visor: new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, shininess: 120, emissiveIntensity: 0.6, depthWrite: false }),
      Accent: new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(true), emissiveIntensity: 1.6 }),
    };

    // viso: 3 texture (normale, occhi chiusi, felice)
    this.faceCanvases = [0, 1, 2].map(() => Object.assign(document.createElement('canvas'), { width: 512, height: 512 }));
    this.faceTex = this.faceCanvases.map((c) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // UV glTF
      t.anisotropy = 4;
      return t;
    });
    this.faceMat = new THREE.MeshBasicMaterial({
      map: this.faceTex[0], transparent: true, alphaTest: 0.05, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });

    const meshes = [];
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      meshes.push(o);
      o.frustumCulled = false; // la bounding box dei mesh animati non è affidabile
      const name = o.material.name;
      if (name === 'Face') {
        o.material = this.faceMat;
        o.renderOrder = 2;
        return;
      }
      o.material = this.mats[name] || this.mats.Skin;
      o.castShadow = !npc;
    });
    // contorni (guscio invertito) anche per i mesh con scheletro; i passanti ne fanno a meno (prestazioni)
    for (const m of npc ? [] : meshes) {
      if (m.material === this.faceMat || m.material === this.mats.Accent || m.material === this.mats.Visor) continue;
      const o = m.isSkinnedMesh ? new THREE.SkinnedMesh(m.geometry, outlineMaterial(OUTLINE, 0x2a1a38)) : new THREE.Mesh(m.geometry, outlineMaterial(OUTLINE, 0x2a1a38));
      if (m.isSkinnedMesh) o.bind(m.skeleton, m.bindMatrix);
      o.frustumCulled = false;
      o.raycast = () => {};
      m.add(o);
    }

    this.variants = {};
    for (const [key, list] of Object.entries(VARIANTS)) {
      this.variants[key] = list.map(([id, name]) => [id, this.model.getObjectByName(name)]);
    }

    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
    });

    // animazioni
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of Avatar.asset.animations) {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(0);
      a.play();
      this.actions[clip.name] = a;
    }
    for (const n of ['walk', 'run']) this.actions[n].timeScale = 0; // pilotate a mano
    this.weights = Object.fromEntries(Object.keys(this.actions).map((k) => [k, k === 'idle' ? 1 : 0]));
    this.locoPhase = 0;
    this.emote = null;
    this.blinkTimer = 2;
    this.swing = { x: 0, z: 0, vx: 0, vz: 0 };
    this.prevSpeed = 0;
    this.config = null;
    this.apply(config);

    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    this.root.add(blob);
  }

  apply(config) {
    const prev = this.config;
    const c = (this.config = sanitizeAvatar(config));
    const m = this.mats;
    m.Skin.color.set(c.skin);
    m.Hair.color.set(c.hairColor);
    m.Top.color.set(c.topColor);
    m.TopDark.color.set(shade(c.topColor, -0.25));
    m.Bottom.color.set(c.bottomColor);
    m.Shoes.color.set(c.shoesColor);
    m.Accent.color.set(c.accent);
    m.Accent.emissive.set(c.accent);
    m.Visor.color.set(c.accent);
    m.Visor.emissive.set(c.accent);

    for (const [key, list] of Object.entries(this.variants)) {
      for (const [id, obj] of list) if (obj) obj.visible = c[key] === id;
    }
    // la giacca è aperta: serve vedere anche l'interno
    const jacket = this.model.getObjectByName('Top_jacket');
    jacket?.traverse((o) => {
      if (o.isMesh && o.material === m.Top) o.material = m.TopJacket ??= Object.assign(avatarToon(0xffffff), { side: THREE.DoubleSide });
    });
    m.TopJacket?.color.set(c.topColor);

    this.body.scale.setScalar(c.height);
    this.bodyWidth = { slim: 0.92, normal: 1, strong: 1.12 }[c.bodyType];

    this.faceCanvases.forEach((cv, i) => drawFace(cv.getContext('2d'), 512, { ...c, expression: ['normal', 'blink', 'happy'][i] }));
    this.faceTex.forEach((t) => (t.needsUpdate = true));

    if (!prev || prev.name !== c.name || prev.height !== c.height) this.buildNameTag(c.name);
  }

  buildNameTag(name) {
    if (this.nameTag) {
      this.root.remove(this.nameTag);
      this.nameTag.material.map.dispose();
      this.nameTag.material.dispose();
    }
    this.nameTag = makeNameTag(name);
    this.nameTag.position.y = 1.9 * this.config.height;
    this.root.add(this.nameTag);
  }

  setNameVisible(v) {
    if (this.nameTag) this.nameTag.visible = v;
  }

  playEmote(id) {
    if (!EMOTES.includes(id)) return;
    this.emote = id;
    this.actions[id].reset().play();
  }

  stopEmote() {
    this.emote = null;
  }

  /**
   * @param {number} dt
   * @param {number} speed velocità orizzontale (m/s)
   * @param {boolean} grounded
   * @param {number} t tempo totale
   */
  animate(dt, speed, grounded, t) {
    if (speed > 0.4 && this.emote) this.stopEmote();

    // pesi desiderati
    const target = Object.fromEntries(Object.keys(this.actions).map((k) => [k, 0]));
    if (this.riding) target[this.riding] = 1;
    else if (!grounded) target.jump = 1;
    else if (this.emote) target[this.emote] = 1;
    else if (speed > 0.15) {
      const run = THREE.MathUtils.smoothstep(speed, WALK_SPEED * 1.15, RUN_SPEED * 0.9);
      const move = Math.min(speed / 0.8, 1);
      target.walk = move * (1 - run);
      target.run = move * run;
      target.idle = 1 - move;
    } else target.idle = 1;

    const k = Math.min(dt * (grounded ? 9 : 12), 1);
    for (const [name, a] of Object.entries(this.actions)) {
      this.weights[name] += (target[name] - this.weights[name]) * k;
      a.setEffectiveWeight(this.weights[name]);
      a.enabled = this.weights[name] > 0.002;
    }

    // camminata e corsa condividono la stessa fase: nessuno scivolamento
    const run = this.weights.run / Math.max(this.weights.walk + this.weights.run, 1e-3);
    const cycleLen = THREE.MathUtils.lerp(WALK_SPEED * this.actions.walk.getClip().duration, RUN_SPEED * this.actions.run.getClip().duration, run);
    this.locoPhase = (this.locoPhase + (speed * dt) / cycleLen) % 1;
    this.actions.walk.time = this.locoPhase * this.actions.walk.getClip().duration;
    this.actions.run.time = this.locoPhase * this.actions.run.getClip().duration;

    this.mixer.update(dt);

    // proporzioni da cartone: gambe più corte, bacino più basso
    for (const n of ['thigh_L', 'thigh_R']) this.bones[n]?.scale.set(1, LEG_SCALE, 1);
    if (this.bones.hips) this.bones.hips.position.y -= LEG_DROP;

    // corporatura: allarga il busto (dopo il mixer, che riscrive le scale)
    const chest = this.bones.chest;
    if (chest) chest.scale.set(this.bodyWidth, 1, this.bodyWidth);
    const head = this.bones.head;
    if (head) head.scale.setScalar(1 / this.bodyWidth ** 0.5);

    // capelli e coda: molla smorzata
    const acc = (speed - this.prevSpeed) / Math.max(dt, 1e-3);
    this.prevSpeed = speed;
    const s = this.swing;
    const tx = Math.min(speed / 6, 1) * 0.55 + (grounded ? 0 : -0.25);
    const tz = Math.sin(t * 2.3) * 0.06 + Math.sin(this.locoPhase * Math.PI * 2) * 0.12 * Math.min(speed / 3, 1);
    s.vx += ((tx - s.x) * 55 - s.vx * 7 - acc * 0.03) * dt;
    s.vz += ((tz - s.z) * 55 - s.vz * 7) * dt;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const [name, mx, mz] of [['hair_tail', 1, 1], ['hair_tail_L', 1, 1], ['hair_tail_R', 1, -1], ['hair_back', 0.6, 0.6], ['tail_1', -0.6, 2], ['tail_2', -0.8, 3]]) {
      const b = this.bones[name];
      if (!b) continue;
      const wag = name.startsWith('tail') ? Math.sin(t * 3.2 + (name === 'tail_2' ? 0.8 : 0)) * 0.25 : 0;
      b.quaternion.multiply(q.setFromEuler(e.set(s.x * mx, 0, s.z * mz + wag)));
    }

    // occhi: battito di ciglia, sorriso durante le emote
    this.blinkTimer -= dt;
    let expr = 0;
    if (this.emote === 'wave' || this.emote === 'cheer' || this.emote === 'dance') expr = 2;
    else if (this.blinkTimer < 0) {
      expr = 1;
      if (this.blinkTimer < -0.12) this.blinkTimer = 2 + Math.random() * 3.5;
    }
    if (this.faceMat.map !== this.faceTex[expr]) this.faceMat.map = this.faceTex[expr];

    this.mats.Accent.emissiveIntensity = 1.3 + Math.sin(t * 2.5) * 0.35;
  }
}
