import * as THREE from 'three';
import { DEFAULT_AVATAR, sanitizeAvatar } from './avatarConfig.js';
import { limbGeometry, latheGeometry, strandGeometry, drawFace, shade } from './avatarParts.js';
import { toonMat, addOutlines } from '../core/toon.js';
import { makeNameTag } from '../world/textSprite.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const OUTLINE = 0.0055;
const lerp = THREE.MathUtils.lerp;

/**
 * Personaggio stile anime, interamente procedurale (nessun asset esterno):
 * scheletro a pivot, shading toon con contorno, viso disegnato su canvas con
 * battito di ciglia ed espressioni, capelli a ciocche, vestiti intercambiabili,
 * animazioni procedurali (idle, camminata, corsa, salto) ed emote.
 *
 * Interfaccia pubblica (stabile anche se in futuro si passa a glTF/VRM):
 *   apply(config) · animate(dt, speed, grounded, t) · playEmote(id) · stopEmote()
 */
export class Avatar {
  constructor(config = DEFAULT_AVATAR) {
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    this.body = new THREE.Group();
    this.root.add(this.body);

    const m = (this.mats = {
      skin: toonMat(0xffffff, { soft: true }),
      torso: toonMat(0xffffff),
      upperArm: toonMat(0xffffff),
      forearm: toonMat(0xffffff),
      thigh: toonMat(0xffffff),
      shin: toonMat(0xffffff),
      top: toonMat(0xffffff),
      topDark: toonMat(0xffffff),
      shirt: toonMat(0xf4f2fa),
      bottom: toonMat(0xffffff),
      shoes: toonMat(0xffffff),
      sole: toonMat(0xf0f0f5),
      sock: toonMat(0xf4f2fa),
      hair: toonMat(0xffffff, { soft: true }),
      hairInner: toonMat(0xffffff, { soft: true }),
      dark: toonMat(0x2a2433),
      pink: toonMat(0xffb3c8),
      white: toonMat(0xffffff),
      accent: new THREE.MeshToonMaterial({ color: 0xffffff, emissiveIntensity: 1.6 }),
    });
    m.accent.gradientMap = m.skin.gradientMap;

    // Viso: 3 texture (normale, occhi chiusi, felice)
    this.faceCanvases = ['normal', 'blink', 'happy'].map(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      return c;
    });
    this.faceTex = this.faceCanvases.map((c) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
    m.face = new THREE.MeshBasicMaterial({ map: this.faceTex[0], transparent: true, alphaTest: 0.05, depthWrite: false });

    this.pose = {};
    this.phase = 0;
    this.blinkTimer = 2;
    this.emote = null;
    this.emoteTime = 0;
    this.config = null;
    this.swingers = [];
    this.attached = { hair: [], acc: [], clothes: [] };
    this.prevVel = 0;

    this.buildSkeleton();
    this.apply(config);
  }

  // ---------------------------------------------------------------- scheletro
  buildSkeleton() {
    const m = this.mats;
    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    this.mesh = mesh;

    this.hips = new THREE.Group();
    this.hips.position.y = 0.82;
    this.body.add(this.hips);
    this.pelvis = mesh(latheGeometry([[0.0, -0.1], [0.085, -0.09], [0.118, -0.04], [0.125, 0.04], [0.0, 0.05]], 20), m.bottom, this.hips);
    this.pelvis.scale.z = 0.78;

    // Gambe (side +1 = sinistra del personaggio, verso +X)
    this.legs = [1, -1].map((side) => {
      const thigh = new THREE.Group();
      thigh.position.set(0.072 * side, -0.04, 0);
      this.hips.add(thigh);
      const thighMesh = mesh(limbGeometry(0.066, 0.05, 0.36), m.thigh, thigh);
      thighMesh.scale.z = 0.95;
      const knee = new THREE.Group();
      knee.position.y = -0.375;
      thigh.add(knee);
      mesh(limbGeometry(0.05, 0.038, 0.36), m.shin, knee);
      const ankle = new THREE.Group();
      ankle.position.y = -0.38;
      knee.add(ankle);
      // scarpa da ginnastica
      const shoe = mesh(new THREE.CapsuleGeometry(0.048, 0.1, 6, 12), m.shoes, ankle, 0, -0.012, 0.035);
      shoe.rotation.x = Math.PI / 2;
      shoe.scale.set(1.05, 1, 0.75);
      const sole = mesh(new THREE.BoxGeometry(0.1, 0.022, 0.21), m.sole, ankle, 0, -0.048, 0.035);
      sole.userData.outlineWidth = 0.004;
      const stripe = mesh(new THREE.BoxGeometry(0.104, 0.012, 0.07), m.accent, ankle, 0, -0.01, 0.02);
      stripe.userData.noOutline = true;
      return { thigh, knee, ankle, side };
    });

    // Busto
    this.spine = new THREE.Group();
    this.spine.position.y = 0.03;
    this.hips.add(this.spine);
    this.chest = new THREE.Group();
    this.spine.add(this.chest);
    this.torso = mesh(
      latheGeometry([[0.0, -0.03], [0.118, -0.02], [0.13, 0.08], [0.128, 0.16], [0.145, 0.27], [0.15, 0.34], [0.13, 0.4], [0.075, 0.445], [0.04, 0.46], [0.0, 0.465]], 24),
      m.torso, this.chest,
    );
    this.torso.scale.z = 0.74;

    // Collo e testa
    this.neck = new THREE.Group();
    this.neck.position.y = 0.43;
    this.chest.add(this.neck);
    mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.09, 12), m.skin, this.neck, 0, 0.035, 0);
    this.head = new THREE.Group();
    this.head.position.y = 0.075;
    this.head.scale.setScalar(1.14); // testa leggermente grande: proporzioni anime
    this.neck.add(this.head);
    const HR = 0.135;
    this.HR = HR;
    const skull = mesh(new THREE.SphereGeometry(HR, 32, 24), m.skin, this.head, 0, HR, 0);
    skull.scale.set(1, 1.04, 0.98);
    const jaw = mesh(new THREE.SphereGeometry(0.1, 24, 16), m.skin, this.head, 0, HR - 0.05, 0.022);
    jaw.scale.set(0.98, 0.95, 0.95);
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.026, 12, 10), m.skin, this.head, s * HR * 0.98, HR - 0.005, -0.005);
      ear.scale.set(0.5, 1, 0.75);
    }
    // naso minimale
    const nose = mesh(new THREE.SphereGeometry(0.008, 8, 6), m.skin, this.head, 0, HR - 0.03, HR * 0.97);
    nose.userData.noOutline = true;

    // Decal del viso: porzione frontale di sfera, phi = PI/2 è il davanti
    const face = new THREE.Mesh(
      new THREE.SphereGeometry(HR * 1.004, 32, 24, Math.PI / 2 - 0.55, 1.1, Math.PI * 0.35, Math.PI * 0.4),
      m.face,
    );
    face.position.y = HR;
    face.scale.copy(skull.scale);
    face.renderOrder = 2;
    this.head.add(face);

    // Braccia
    this.arms = [1, -1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.145 * side, 0.37, 0);
      this.chest.add(shoulder);
      mesh(new THREE.SphereGeometry(0.043, 14, 10), m.upperArm, shoulder);
      const upper = mesh(limbGeometry(0.044, 0.036, 0.25), m.upperArm, shoulder);
      upper.userData.role = 'upperArm';
      const elbow = new THREE.Group();
      elbow.position.y = -0.26;
      shoulder.add(elbow);
      mesh(limbGeometry(0.036, 0.029, 0.22), m.forearm, elbow);
      const hand = new THREE.Group();
      hand.position.y = -0.235;
      elbow.add(hand);
      const palm = mesh(new THREE.SphereGeometry(0.036, 12, 10), m.skin, hand, 0, -0.03, 0);
      palm.scale.set(0.75, 1.15, 0.55);
      const thumb = mesh(limbGeometry(0.012, 0.01, 0.035, 8), m.skin, hand, -0.022 * side * -1, -0.012, 0.014);
      thumb.rotation.z = 0.6 * side;
      return { shoulder, elbow, hand, side };
    });

    // Ombra di contatto
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    this.root.add(blob);

    addOutlines(this.body, OUTLINE);
  }

  // ---------------------------------------------------------------- aspetto
  apply(config) {
    const prev = this.config;
    const c = (this.config = sanitizeAvatar(config));
    const m = this.mats;
    const skin = new THREE.Color(c.skin);

    m.skin.color.set(c.skin);
    m.top.color.set(c.topColor);
    m.topDark.color.set(shade(c.topColor, -0.25));
    m.bottom.color.set(c.bottomColor);
    m.shoes.color.set(c.shoesColor);
    m.hair.color.set(c.hairColor);
    m.hairInner.color.set(shade(c.hairColor, -0.3));
    m.accent.color.set(c.accent);
    m.accent.emissive.set(c.accent);

    // materiali "di ruolo": pelle o stoffa a seconda dei vestiti
    const longSleeves = c.top !== 'tshirt';
    m.torso.color.set(c.top === 'jacket' ? '#f4f2fa' : c.topColor);
    m.upperArm.color.set(c.top === 'jacket' ? c.topColor : longSleeves ? c.topColor : skin);
    m.forearm.color.set(longSleeves ? c.topColor : skin);
    m.thigh.color.set(c.bottom === 'pants' ? c.bottomColor : skin);
    m.shin.color.set(c.bottom === 'pants' ? c.bottomColor : '#f4f2fa');

    const widths = { slim: 0.9, normal: 1, strong: 1.14 };
    const w = widths[c.bodyType];
    this.chest.scale.set(w, 1, w);
    this.pelvis.scale.x = 0.95 + (w - 1) * 0.6;
    this.arms.forEach((a) => (a.shoulder.position.x = 0.145 * a.side));
    this.legs.forEach((l) => (l.thigh.position.x = 0.072 * l.side * (0.95 + (w - 1) * 0.5)));
    this.body.scale.setScalar(c.height);

    this.faceCanvases.forEach((cv, i) =>
      drawFace(cv.getContext('2d'), cv.width, { ...c, expression: ['normal', 'blink', 'happy'][i] }),
    );
    this.faceTex.forEach((t) => (t.needsUpdate = true));

    const changed = (k) => !prev || prev[k] !== c[k];
    if (changed('hair')) this.buildHair(c.hair);
    if (changed('accessory')) this.buildAccessory(c.accessory);
    if (changed('top') || changed('bottom')) this.buildClothes(c.top, c.bottom);
    if (changed('name') || changed('height')) this.buildNameTag(c.name);
  }

  detach(list) {
    for (const o of list) {
      o.parent?.remove(o);
      o.traverse((x) => {
        if (x.geometry && !x.userData.isOutline) x.geometry.dispose();
      });
    }
    list.length = 0;
  }

  attach(kind, parent, obj) {
    parent.add(obj);
    addOutlines(obj, OUTLINE);
    obj.traverse((x) => {
      if (x.isMesh && !x.userData.isOutline) x.castShadow = true;
    });
    this.attached[kind].push(obj);
    return obj;
  }

  // ---------------------------------------------------------------- capelli
  buildHair(style) {
    this.detach(this.attached.hair);
    this.swingers = this.swingers.filter((s) => s.kind !== 'hair');
    const m = this.mats;
    const HR = this.HR;
    const g = new THREE.Group();
    g.position.y = HR;

    // calotta superiore
    const cap = new THREE.Mesh(new THREE.SphereGeometry(HR * 1.07, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.4), m.hair);
    cap.scale.set(1.02, 1.06, 1.02);
    cap.position.set(0, 0.006, -0.004);
    g.add(cap);
    // parte posteriore (lascia libero il viso)
    const backLen = { short: 0.66, spiky: 0.62, bob: 0.8, long: 0.72, ponytail: 0.6, twintails: 0.66 }[style];
    const back = new THREE.Mesh(
      new THREE.SphereGeometry(HR * 1.075, 32, 16, Math.PI * 0.82, Math.PI * 1.36, 0, Math.PI * backLen),
      m.hair,
    );
    back.scale.set(1.03, 1.05, 1.04);
    back.position.z = -0.004;
    g.add(back);
    const inner = new THREE.Mesh(back.geometry, m.hairInner);
    inner.material = m.hairInner.clone();
    inner.material.side = THREE.BackSide;
    inner.scale.copy(back.scale);
    inner.userData.noOutline = true;
    g.add(inner);

    const strand = (pts, r0, r1, opts) => {
      const s = new THREE.Mesh(strandGeometry(pts, r0, r1, opts), m.hair);
      g.add(s);
      return s;
    };

    // frangia: ciocche dalla sommità che scendono sulla fronte
    const bangCount = style === 'spiky' ? 6 : 7;
    for (let i = 0; i < bangCount; i++) {
      const t = i / (bangCount - 1) - 0.5;
      const a = t * 1.45;
      const len = style === 'bob' ? 0.075 : 0.06 + Math.cos(t * 3) * 0.012;
      const endY = 0.078 - len * 0.5 + Math.abs(t) * 0.01 - (Math.abs(t) > 0.4 ? 0.06 : 0);
      const R = HR * 1.1;
      strand(
        [
          V(Math.sin(a) * 0.04, HR * 0.95, Math.cos(a) * 0.03),
          V(Math.sin(a) * R * 0.85, HR * 0.72, Math.cos(a) * R * 0.88),
          V(Math.sin(a * 1.05) * R * 1.0, 0.06, Math.cos(a) * R * 0.98),
          V(Math.sin(a * 1.1) * R * 0.98 + t * 0.01, endY, Math.cos(a) * R * 0.95),
        ],
        0.034, 0.003, { flat: 1.25, bulge: 0.2 },
      );
    }
    // ciocche laterali che incorniciano il viso
    const sideLen = { short: -0.06, spiky: -0.04, bob: -0.13, long: -0.24, ponytail: -0.09, twintails: -0.12 }[style];
    for (const s of [-1, 1]) {
      strand(
        [V(s * 0.09, 0.1, 0.07), V(s * 0.145, 0.02, 0.075), V(s * 0.14, sideLen * 0.6, 0.07), V(s * 0.13, sideLen, 0.065)],
        0.03, 0.004, { flat: 0.7 },
      );
    }

    if (style === 'spiky') {
      const R = HR * 1.02;
      for (let i = 0; i < 12; i++) {
        const a = Math.PI * 0.55 + (i / 11) * Math.PI * 0.9 + (i % 2) * 0.1;
        const up = 0.25 + (i % 3) * 0.2;
        const base = V(-Math.cos(a) * R * Math.sin(1.1), Math.cos(1.1) * R + 0.02, Math.sin(a) * R * Math.sin(1.1) * -1);
        const dir = base.clone().normalize();
        dir.y += up;
        dir.normalize();
        strand([base.clone().multiplyScalar(0.8), base.clone().addScaledVector(dir, 0.06), base.clone().addScaledVector(dir, 0.12)], 0.04, 0.002, { bulge: 0.1 });
      }
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.04;
        strand([V(x, HR * 0.9, 0), V(x * 1.4, HR * 1.25, -0.03), V(x * 1.8, HR * 1.4, -0.08)], 0.035, 0.002);
      }
    }

    if (style === 'bob') {
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.62 + (i / 8) * Math.PI * 0.76;
        const x = -Math.cos(a);
        const z = -Math.abs(Math.sin(a));
        strand([V(x * 0.12, 0.05, z * 0.12), V(x * 0.155, -0.04, z * 0.15), V(x * 0.15, -0.1, z * 0.14)], 0.045, 0.012, { flat: 1 });
      }
    }

    // un "ciuffo ribelle" in cima (classico anime)
    strand([V(0, HR * 1.0, 0.0), V(0.01, HR * 1.25, -0.02), V(0.04, HR * 1.3, 0.02)], 0.012, 0.001, { bulge: 0 });

    const swingGroup = (pivotPos) => {
      const pivot = new THREE.Group();
      pivot.position.copy(pivotPos);
      g.add(pivot);
      this.swingers.push({ kind: 'hair', obj: pivot, rx: 0, rz: 0, vx: 0, vz: 0 });
      return pivot;
    };

    if (style === 'long') {
      const pivot = swingGroup(V(0, 0.02, -0.11));
      for (let i = 0; i < 9; i++) {
        const t = i / 8 - 0.5;
        const x = t * 0.2;
        const s = new THREE.Mesh(
          strandGeometry([V(x, 0.06, 0.02), V(x * 1.3, -0.1, -0.03), V(x * 1.35, -0.3, -0.04), V(x * 1.2, -0.46 + Math.abs(t) * 0.06, -0.02)], 0.042, 0.006, { flat: 1.3 }),
          m.hair,
        );
        pivot.add(s);
      }
    }

    if (style === 'ponytail') {
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.012, 8, 16), m.accent);
      tie.position.set(0, 0.07, -0.142);
      tie.rotation.x = 0.6;
      g.add(tie);
      const pivot = swingGroup(V(0, 0.07, -0.15));
      pivot.add(new THREE.Mesh(strandGeometry([V(0, 0, 0), V(0, 0.03, -0.06), V(0, -0.1, -0.1), V(0, -0.3, -0.07), V(0, -0.42, -0.04)], 0.05, 0.006, { bulge: 0.35 }), m.hair));
    }

    if (style === 'twintails') {
      for (const s of [-1, 1]) {
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.011, 8, 16), m.accent);
        tie.position.set(s * 0.125, 0.06, -0.07);
        tie.rotation.y = s * 1.2;
        g.add(tie);
        const pivot = swingGroup(V(s * 0.13, 0.06, -0.075));
        pivot.add(new THREE.Mesh(strandGeometry([V(0, 0, 0), V(s * 0.06, 0.0, -0.03), V(s * 0.09, -0.12, -0.04), V(s * 0.07, -0.32, -0.02), V(s * 0.05, -0.45, 0)], 0.048, 0.006, { bulge: 0.35 }), m.hair));
      }
    }

    this.attach('hair', this.head, g);
  }

  // ---------------------------------------------------------------- accessori
  buildAccessory(type) {
    this.detach(this.attached.acc);
    this.swingers = this.swingers.filter((s) => s.kind !== 'tail');
    const m = this.mats;
    const HR = this.HR;
    const g = new THREE.Group();
    g.position.y = HR;
    let tail = null;

    const ear = (s, h, w, inner) => {
      const e = new THREE.Group();
      e.position.set(s * 0.085, HR * 0.86, -0.01);
      e.rotation.set(-0.15, 0, -s * 0.38);
      const outer = new THREE.Mesh(new THREE.ConeGeometry(w, h, 4), m.hair);
      outer.rotation.y = Math.PI / 4;
      outer.scale.z = 0.45;
      outer.position.y = h / 2;
      const inn = new THREE.Mesh(new THREE.ConeGeometry(w * 0.6, h * 0.75, 4), inner);
      inn.rotation.y = Math.PI / 4;
      inn.scale.z = 0.3;
      inn.position.set(0, h * 0.42, 0.012);
      inn.userData.noOutline = true;
      e.add(outer, inn);
      g.add(e);
    };

    switch (type) {
      case 'catears':
        for (const s of [-1, 1]) ear(s, 0.085, 0.05, m.pink);
        tail = { len: 0.5, r: 0.022, tip: m.hair };
        break;
      case 'foxears':
        for (const s of [-1, 1]) ear(s, 0.12, 0.055, m.white);
        tail = { len: 0.42, r: 0.075, tip: m.white };
        break;
      case 'halo': {
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.011, 8, 40), m.accent);
        halo.rotation.x = Math.PI / 2 - 0.25;
        halo.position.set(0, HR * 1.55, -0.03);
        halo.userData.noOutline = true;
        g.add(halo);
        this.spinner = halo;
        break;
      }
      case 'headphones': {
        const band = new THREE.Mesh(new THREE.TorusGeometry(HR * 1.13, 0.012, 8, 32, Math.PI), m.dark);
        band.position.y = 0.0;
        band.rotation.z = 0;
        g.add(band);
        for (const s of [-1, 1]) {
          const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.05, 0.04, 20), m.dark);
          cup.rotation.z = Math.PI / 2;
          cup.position.set(s * HR * 1.1, -0.01, 0);
          const glow = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.007, 6, 24), m.accent);
          glow.rotation.y = Math.PI / 2;
          glow.position.set(s * (HR * 1.1 + 0.021), -0.01, 0);
          glow.userData.noOutline = true;
          g.add(cup, glow);
        }
        break;
      }
      case 'glasses': {
        for (const s of [-1, 1]) {
          const rim = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 24), m.dark);
          rim.position.set(s * 0.048, -0.008, HR * 0.97);
          rim.rotation.y = s * 0.25;
          rim.scale.y = 0.8;
          rim.userData.noOutline = true;
          const temple = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.11), m.dark);
          temple.position.set(s * 0.122, -0.002, 0.065);
          temple.userData.noOutline = true;
          g.add(rim, temple);
        }
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), m.dark);
        bridge.position.set(0, -0.004, HR * 1.0);
        bridge.userData.noOutline = true;
        g.add(bridge);
        break;
      }
      case 'horns':
        for (const s of [-1, 1]) {
          const h = new THREE.Mesh(
            strandGeometry([V(s * 0.07, HR * 0.75, 0.03), V(s * 0.11, HR * 1.0, 0.0), V(s * 0.12, HR * 1.18, -0.06), V(s * 0.1, HR * 1.25, -0.11)], 0.024, 0.002, { bulge: 0 }),
            m.dark,
          );
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 16), m.accent);
          ring.position.set(s * 0.085, HR * 0.82, 0.02);
          ring.rotation.x = Math.PI / 2;
          ring.userData.noOutline = true;
          g.add(h, ring);
        }
        break;
      default:
        break;
    }
    if (type !== 'halo') this.spinner = null;
    this.attach('acc', this.head, g);

    if (tail) {
      const pivot = new THREE.Group();
      pivot.position.set(0, -0.02, -0.09);
      const L = tail.len;
      const t1 = new THREE.Mesh(
        strandGeometry([V(0, 0, 0), V(0, -0.04, -0.1), V(0, 0.02, -L * 0.55), V(0, 0.14, -L * 0.85), V(0, 0.22, -L)], tail.r, tail.r * 0.15, { bulge: tail.r > 0.05 ? 0.5 : 0 }),
        m.hair,
      );
      pivot.add(t1);
      if (tail.tip !== m.hair) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(tail.r * 0.9, 12, 10), tail.tip);
        tip.position.set(0, 0.2, -L * 0.97);
        tip.scale.set(1, 1.3, 1.6);
        pivot.add(tip);
      }
      this.attach('acc', this.hips, pivot);
      this.swingers.push({ kind: 'tail', obj: pivot, rx: 0, rz: 0, vx: 0, vz: 0, tail: true });
    }
  }

  // ---------------------------------------------------------------- vestiti
  buildClothes(top, bottom) {
    this.detach(this.attached.clothes);
    const m = this.mats;
    const add = (parent, obj) => this.attach('clothes', parent, obj);

    if (top === 'hoodie') {
      // cappuccio appoggiato dietro il collo
      const hood = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.035, 10, 24), m.top);
      hood.position.set(0, 0.425, -0.035);
      hood.rotation.x = Math.PI / 2 + 0.5;
      hood.scale.set(1.15, 1, 0.8);
      add(this.chest, hood);
      const hoodBack = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.topDark);
      hoodBack.position.set(0, 0.38, -0.085);
      hoodBack.rotation.x = -2.1;
      hoodBack.scale.set(1.1, 0.7, 0.6);
      add(this.chest, hoodBack);
      // tasca a marsupio
      const pocket = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.13, 4, 8), m.topDark);
      pocket.rotation.z = Math.PI / 2;
      pocket.position.set(0, 0.07, 0.093);
      pocket.scale.set(1, 1, 0.35);
      add(this.chest, pocket);
      // laccetti luminosi
      for (const s of [-1, 1]) {
        const lace = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 6), m.accent);
        lace.position.set(s * 0.028, 0.33, 0.1);
        lace.rotation.x = -0.15;
        lace.userData.noOutline = true;
        add(this.chest, lace);
      }
      // polsini e orlo
      for (const a of this.arms) {
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.03, 12), m.topDark);
        cuff.position.y = -0.2;
        add(a.elbow, cuff);
      }
      const hem = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.018, 8, 28), m.topDark);
      hem.rotation.x = Math.PI / 2;
      hem.position.y = -0.005;
      hem.scale.y = 0.74;
      add(this.chest, hem);
    }

    if (top === 'jacket') {
      // giacca aperta: guscio con apertura sul davanti + colletto
      const shell = new THREE.Mesh(
        latheGeometry([[0.13, -0.06], [0.138, 0.08], [0.137, 0.16], [0.155, 0.27], [0.16, 0.34], [0.14, 0.4], [0.09, 0.44]], 24, 0.42, Math.PI * 2 - 0.84),
        m.top,
      );
      shell.scale.z = 0.78;
      shell.material = m.top.clone();
      shell.material.side = THREE.DoubleSide;
      add(this.chest, shell);
      this.jacketMat = shell.material;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 8, 24, Math.PI * 1.5), m.topDark);
      collar.position.set(0, 0.425, -0.005);
      collar.rotation.set(Math.PI / 2, 0, Math.PI * 0.75);
      collar.scale.set(1, 0.8, 1);
      add(this.chest, collar);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.147, 0.006, 6, 28, Math.PI * 1.6), m.accent);
      stripe.rotation.set(Math.PI / 2, 0, Math.PI * 0.7);
      stripe.position.y = 0.2;
      stripe.scale.y = 0.78;
      stripe.userData.noOutline = true;
      add(this.chest, stripe);
      const logo = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), m.accent);
      logo.position.set(0.0, 0.25, 0.1);
      logo.userData.noOutline = true;
      add(this.chest, logo);
    } else {
      this.jacketMat = null;
    }

    if (top === 'tshirt') {
      for (const a of this.arms) {
        const sleeve = new THREE.Mesh(limbGeometry(0.052, 0.046, 0.11), m.top);
        add(a.shoulder, sleeve);
      }
      const print = new THREE.Mesh(new THREE.RingGeometry(0.025, 0.04, 6), m.accent);
      print.position.set(0, 0.25, 0.103);
      print.userData.noOutline = true;
      add(this.chest, print);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 20), m.topDark);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.44;
      add(this.chest, collar);
    }

    if (bottom === 'shorts') {
      for (const l of this.legs) {
        const leg = new THREE.Mesh(limbGeometry(0.075, 0.064, 0.15), m.bottom);
        add(l.thigh, leg);
      }
    }
    if (bottom === 'skirt') {
      const skirt = new THREE.Mesh(
        latheGeometry([[0.25, -0.26], [0.22, -0.2], [0.16, -0.08], [0.128, 0.0], [0.122, 0.04]], 28),
        m.bottom.clone(),
      );
      skirt.material.side = THREE.DoubleSide;
      skirt.scale.z = 0.85;
      add(this.hips, skirt);
      this.skirt = skirt;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.124, 0.012, 6, 28), m.accent);
      band.rotation.x = Math.PI / 2;
      band.scale.y = 0.85;
      band.position.y = 0.03;
      band.userData.noOutline = true;
      add(this.hips, band);
    } else {
      this.skirt = null;
    }
    if (bottom !== 'skirt') {
      const belt = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 6, 28), m.dark);
      belt.rotation.x = Math.PI / 2;
      belt.scale.y = 0.8;
      belt.position.y = 0.035;
      add(this.hips, belt);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.01), m.accent);
      buckle.position.set(0, 0.035, 0.1);
      buckle.userData.noOutline = true;
      add(this.hips, buckle);
    }
  }

  buildNameTag(name) {
    if (this.nameTag) {
      this.root.remove(this.nameTag);
      this.nameTag.material.map.dispose();
      this.nameTag.material.dispose();
    }
    this.nameTag = makeNameTag(name);
    this.nameTag.position.y = 1.98 * this.config.height;
    this.root.add(this.nameTag);
  }

  setNameVisible(v) {
    if (this.nameTag) this.nameTag.visible = v;
  }

  // ---------------------------------------------------------------- emote
  playEmote(id) {
    this.emote = id;
    this.emoteTime = 0;
  }

  stopEmote() {
    this.emote = null;
  }

  setExpression(i) {
    const map = this.faceTex[i];
    if (this.mats.face.map !== map) this.mats.face.map = map;
  }

  // ---------------------------------------------------------------- animazione
  /**
   * @param {number} dt
   * @param {number} speed velocità orizzontale (m/s)
   * @param {boolean} grounded
   * @param {number} t tempo totale
   */
  animate(dt, speed, grounded, t) {
    const P = {
      hipsY: 0.82, hipsX: 0, hipsRY: 0, hipsRZ: 0,
      spineX: 0, spineY: 0, spineZ: 0, headX: 0, headY: 0, headZ: 0,
      legX: [0, 0], legZ: [0, 0], kneeX: [0, 0], ankleX: [0, 0],
      armX: [0, 0], armZ: [0.12, -0.12], elbowX: [-0.15, -0.15], elbowZ: [0, 0],
    };
    if (speed > 0.4 && this.emote) this.stopEmote();
    this.emoteTime += dt;
    const e = this.emote;

    if (!grounded) {
      // salto
      P.legX = [-0.9, 0.25];
      P.kneeX = [1.4, 0.5];
      P.armZ = [1.2, -1.2];
      P.armX = [-0.4, 0.3];
      P.elbowX = [-0.6, -0.4];
      P.spineX = 0.1;
      P.hipsY = 0.85;
    } else if (speed > 0.25) {
      const run = THREE.MathUtils.smoothstep(speed, 4.5, 7.5);
      const amp = Math.min(speed / 4, 1);
      this.phase += dt * (5.2 + speed * 1.45);
      const ph = this.phase;
      for (let i = 0; i < 2; i++) {
        const p = ph + i * Math.PI;
        const s = Math.sin(p);
        P.legX[i] = -s * lerp(0.55, 0.95, run) * amp;
        P.kneeX[i] = (0.12 + Math.max(0, Math.cos(p)) * lerp(0.7, 1.5, run)) * amp;
        P.ankleX[i] = -0.15 * s * amp;
        P.armX[i] = s * lerp(0.45, 0.9, run) * amp;
        P.elbowX[i] = -lerp(0.3, 1.3, run);
      }
      P.armZ = [0.1 + run * 0.1, -0.1 - run * 0.1];
      P.hipsY = 0.82 - run * 0.03 + Math.abs(Math.cos(ph)) * lerp(0.025, 0.05, run) * amp;
      P.hipsRY = Math.sin(ph) * 0.12 * amp;
      P.spineY = -Math.sin(ph) * 0.2 * amp;
      P.spineX = lerp(0.04, 0.22, run);
      P.headX = -P.spineX * 0.6;
    } else if (e) {
      this.emotePose(e, P, this.emoteTime, t);
    } else {
      // idle: respiro, peso che si sposta, sguardo che vaga
      const b = Math.sin(t * 1.8);
      P.spineX = b * 0.015;
      P.hipsX = Math.sin(t * 0.5) * 0.012;
      P.hipsRZ = Math.sin(t * 0.5) * 0.03;
      P.legZ = [-0.03 - P.hipsRZ, 0.03 - P.hipsRZ];
      P.kneeX = [0.05 + Math.max(0, Math.sin(t * 0.5)) * 0.12, 0.05 + Math.max(0, -Math.sin(t * 0.5)) * 0.12];
      P.armZ = [0.13 + b * 0.02, -0.13 - b * 0.02];
      P.headY = Math.sin(t * 0.37) * 0.25;
      P.headX = Math.sin(t * 0.23) * 0.06;
      P.headZ = Math.sin(t * 0.31) * 0.05;
    }

    // smorzamento verso la posa (transizioni morbide)
    const k = Math.min(dt * (grounded ? 14 : 9), 1);
    const cur = this.pose;
    for (const key in P) {
      if (Array.isArray(P[key])) {
        cur[key] ??= [...P[key]];
        for (let i = 0; i < 2; i++) cur[key][i] += (P[key][i] - cur[key][i]) * k;
      } else {
        cur[key] ??= P[key];
        cur[key] += (P[key] - cur[key]) * k;
      }
    }
    this.applyPose(cur);

    // battito di ciglia ed espressioni
    this.blinkTimer -= dt;
    let expr = 0;
    if (e === 'wave' || e === 'cheer' || e === 'dance') expr = 2;
    else if (this.blinkTimer < 0) {
      expr = 1;
      if (this.blinkTimer < -0.12) this.blinkTimer = 2 + Math.random() * 3.5;
    }
    this.setExpression(expr);

    // capelli/coda: molla smorzata guidata da velocità e accelerazione
    const acc = (speed - this.prevVel) / Math.max(dt, 1e-3);
    this.prevVel = speed;
    for (const s of this.swingers) {
      const targetX = s.tail
        ? -0.35 + Math.min(speed / 8, 1) * 0.6 + Math.sin(t * 2.2) * 0.12
        : Math.min(speed / 8, 1) * -0.55 + (grounded ? 0 : 0.3);
      const targetZ = s.tail ? Math.sin(t * 3.1) * 0.35 : Math.sin(this.phase) * 0.08 * Math.min(speed / 4, 1);
      s.vx += ((targetX - s.rx) * 60 - s.vx * 8 - acc * 0.004) * dt;
      s.vz += ((targetZ - s.rz) * 60 - s.vz * 8) * dt;
      s.rx += s.vx * dt;
      s.rz += s.vz * dt;
      s.obj.rotation.x = s.tail ? s.rx : -s.rx;
      s.obj.rotation.z = s.rz;
    }

    this.mats.accent.emissiveIntensity = 1.3 + Math.sin(t * 2.5) * 0.35;
    if (this.spinner) this.spinner.rotation.z += dt * 1.2;
  }

  emotePose(e, P, et, t) {
    switch (e) {
      case 'wave': {
        P.armZ = [0.15, -2.55];
        P.armX = [0, -0.25];
        P.elbowZ = [0, -0.3 + Math.sin(et * 9) * 0.45];
        P.elbowX = [-0.15, -0.35];
        P.headZ = 0.12;
        P.spineZ = 0.06;
        break;
      }
      case 'cheer': {
        const b = Math.abs(Math.sin(et * 6));
        P.armZ = [2.7 + b * 0.2, -2.7 - b * 0.2];
        P.elbowX = [-0.3, -0.3];
        P.hipsY = 0.8 + b * 0.05;
        P.kneeX = [0.25 - b * 0.2, 0.25 - b * 0.2];
        P.legX = [-0.1, -0.1];
        P.headX = -0.2;
        break;
      }
      case 'dance': {
        const beat = et * 7.2;
        const s = Math.sin(beat);
        const c = Math.cos(beat * 0.5);
        P.hipsX = s * 0.05;
        P.hipsY = 0.78 + Math.abs(Math.cos(beat)) * 0.04;
        P.hipsRY = c * 0.35;
        P.hipsRZ = -s * 0.08;
        P.spineZ = s * 0.12;
        P.spineY = -c * 0.25;
        P.kneeX = [0.35 + Math.max(0, s) * 0.4, 0.35 + Math.max(0, -s) * 0.4];
        P.legX = [-0.2 - Math.max(0, s) * 0.25, -0.2 - Math.max(0, -s) * 0.25];
        P.armZ = [1.4 + s * 0.9, -1.4 + s * 0.9];
        P.armX = [-0.6 - c * 0.4, -0.6 + c * 0.4];
        P.elbowX = [-1.2 - s * 0.4, -1.2 + s * 0.4];
        P.headZ = -s * 0.15;
        P.headX = Math.abs(Math.cos(beat)) * 0.12;
        break;
      }
      case 'sit': {
        P.hipsY = 0.47;
        P.legX = [-1.45, -1.45];
        P.kneeX = [1.5, 1.5];
        P.legZ = [0.08, -0.08];
        P.spineX = -0.08;
        P.armX = [-0.55, -0.55];
        P.elbowX = [-0.65, -0.65];
        P.armZ = [0.18, -0.18];
        P.headY = Math.sin(t * 0.3) * 0.3;
        P.headX = Math.sin(t * 0.2) * 0.08;
        break;
      }
      case 'floor': {
        P.hipsY = 0.13;
        P.legX = [-1.45, -1.5];
        P.kneeX = [0.15, 0.35];
        P.legZ = [0.12, -0.12];
        P.spineX = -0.25;
        P.armX = [0.5, 0.5];
        P.armZ = [0.35, -0.35];
        P.elbowX = [0, 0];
        P.headX = 0.15 + Math.sin(t * 0.3) * 0.05;
        P.headY = Math.sin(t * 0.25) * 0.3;
        break;
      }
      default:
        break;
    }
  }

  applyPose(p) {
    this.hips.position.set(p.hipsX, p.hipsY, 0);
    this.hips.rotation.set(0, p.hipsRY, p.hipsRZ);
    this.spine.rotation.set(p.spineX, p.spineY, p.spineZ);
    this.head.rotation.set(p.headX, p.headY, p.headZ);
    for (let i = 0; i < 2; i++) {
      const l = this.legs[i];
      l.thigh.rotation.set(p.legX[i], 0, p.legZ[i]);
      l.knee.rotation.x = p.kneeX[i];
      l.ankle.rotation.x = p.ankleX[i] - (p.legX[i] + p.kneeX[i]) * 0.35;
      const a = this.arms[i];
      // side +1: braccio a +X → l'abduzione è una rotazione Z positiva
      a.shoulder.rotation.set(p.armX[i], 0, p.armZ[i]);
      a.elbow.rotation.set(p.elbowX[i], 0, p.elbowZ[i]);
    }
    if (this.skirt) {
      // la gonna segue le gambe
      const spread = Math.max(-p.legX[0], -p.legX[1], 0);
      this.skirt.rotation.x = -spread * 0.35;
      this.skirt.scale.y = 1 - spread * 0.15;
    }
  }
}
