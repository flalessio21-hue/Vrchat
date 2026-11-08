import * as THREE from 'three';
import { DEFAULT_AVATAR } from './avatarConfig.js';
import { makeTextSprite } from '../world/textSprite.js';

/**
 * Personaggio procedurale costruito con primitive (nessun asset esterno).
 * L'origine del gruppo è ai piedi. Le articolazioni sono Group "pivot"
 * così le animazioni sono semplici rotazioni.
 *
 * In futuro si potrà sostituire con un modello glTF/VRM mantenendo la stessa
 * interfaccia: apply(config), animate(dt, speed, grounded), setNameVisible().
 */
export class Avatar {
  constructor(config = DEFAULT_AVATAR) {
    this.root = new THREE.Group();
    this.root.name = 'avatar';

    this.mats = {
      skin: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      suit: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.3 }),
      accent: new THREE.MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 2.2 }),
      visor: new THREE.MeshStandardMaterial({ roughness: 0.05, metalness: 0.6, emissiveIntensity: 1.4 }),
      hair: new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      hairDouble: new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }),
      boot: new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.5, metalness: 0.4 }),
    };

    this.phase = 0;
    this.airBlend = 0;
    this.config = null;
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.build();
    this.apply(config);
  }

  build() {
    const m = this.mats;
    const cast = (mesh) => {
      mesh.castShadow = true;
      return mesh;
    };

    // Bacino
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);

    // Gambe
    this.legs = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(0.11 * side, 0, 0);
      const leg = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 10), m.suit));
      leg.position.y = -0.4;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 12), m.accent);
      stripe.position.y = -0.3;
      const boot = cast(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.3), m.boot));
      boot.position.set(0, -0.86, 0.05);
      pivot.add(leg, stripe, boot);
      this.hips.add(pivot);
      return pivot;
    });

    // Busto
    this.torso = new THREE.Group();
    this.torso.position.y = 0.05;
    this.hips.add(this.torso);
    this.chest = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.36, 6, 14), m.suit));
    this.chest.position.y = 0.32;
    this.torso.add(this.chest);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.025, 8, 24), m.accent);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.08;
    this.torso.add(belt);
    const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), m.accent);
    emblem.position.set(0, 0.42, 0.215);
    this.torso.add(emblem);

    // Braccia
    this.arms = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(0.29 * side, 0.55, 0);
      pivot.rotation.z = 0.12 * side;
      const arm = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.42, 4, 10), m.suit));
      arm.position.y = -0.27;
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), m.accent);
      cuff.position.y = -0.44;
      const hand = cast(new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), m.skin));
      hand.position.y = -0.55;
      pivot.add(arm, cuff, hand);
      this.torso.add(pivot);
      return pivot;
    });

    // Testa
    this.head = new THREE.Group();
    this.head.position.y = 0.78;
    this.torso.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), m.skin);
    neck.position.y = -0.08;
    const skull = cast(new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 18), m.skin));
    skull.position.y = 0.1;
    skull.scale.set(1, 1.08, 1);
    const visor = new THREE.Mesh(
      // phi = PI/2 corrisponde al davanti (+Z) nella SphereGeometry di three.js
      new THREE.SphereGeometry(0.195, 24, 12, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.22),
      m.visor,
    );
    visor.position.y = 0.1;
    visor.scale.set(1.04, 1.1, 1.04);
    this.head.add(neck, skull, visor);
    this.visorMesh = visor;

    this.hairGroup = new THREE.Group();
    this.hairGroup.position.y = 0.1;
    this.accGroup = new THREE.Group();
    this.accGroup.position.y = 0.1;
    this.head.add(this.hairGroup, this.accGroup);

    // Ombra di contatto finta (economica, funziona anche su mobile/Quest)
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.01;
    this.root.add(blob);
    this.blob = blob;
  }

  apply(config) {
    const prev = this.config;
    this.config = { ...DEFAULT_AVATAR, ...config };
    const c = this.config;
    const m = this.mats;
    m.skin.color.set(c.skin);
    m.suit.color.set(c.suit);
    m.accent.color.set(c.accent);
    m.accent.emissive.set(c.accent);
    m.visor.color.set(c.visor);
    m.visor.emissive.set(c.visor);
    m.hair.color.set(c.hairColor);
    m.hairDouble.color.set(c.hairColor);

    const widths = { slim: 0.85, normal: 1, strong: 1.22 };
    const w = widths[c.bodyType] ?? 1;
    this.chest.scale.set(w, 1, w * 0.9 + 0.1);
    this.arms.forEach((a, i) => (a.position.x = (i ? 1 : -1) * (0.29 * w)));
    this.body.scale.setScalar(c.height);

    if (!prev || prev.hair !== c.hair) this.buildHair(c.hair);
    if (!prev || prev.accessory !== c.accessory) this.buildAccessory(c.accessory);
    if (!prev || prev.name !== c.name || prev.height !== c.height) this.buildNameTag(c.name);
  }

  clear(group) {
    for (const child of [...group.children]) {
      child.traverse((o) => o.geometry?.dispose());
      group.remove(child);
    }
  }

  buildHair(style) {
    const g = this.hairGroup;
    this.clear(g);
    const mat = this.mats.hair;
    const add = (geo, x, y, z, rx = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, 0, rz);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    const cap = () => {
      const top = add(new THREE.SphereGeometry(0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), 0, 0.02, -0.01);
      top.scale.set(1.02, 1.12, 1.04);
    };
    switch (style) {
      case 'spiky':
        cap();
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          add(new THREE.ConeGeometry(0.05, 0.16, 6), Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12 - 0.02,
            Math.sin(a) * 0.6, -Math.cos(a) * 0.6);
        }
        add(new THREE.ConeGeometry(0.05, 0.18, 6), 0, 0.26, 0);
        break;
      case 'mohawk':
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          add(new THREE.ConeGeometry(0.035, 0.2, 5), 0, 0.2 - Math.abs(t - 0.4) * 0.12, 0.14 - t * 0.32, (t - 0.4) * -1.4, 0);
        }
        break;
      case 'bob': {
        cap();
        // lato aperto verso il viso (+Z)
        const back = add(new THREE.CylinderGeometry(0.21, 0.23, 0.22, 20, 1, true, Math.PI * 0.25, Math.PI * 1.5), 0, -0.08, -0.01);
        back.material = this.mats.hairDouble;
        break;
      }
      case 'long': {
        cap();
        const tail = add(new THREE.CapsuleGeometry(0.1, 0.38, 4, 10), 0, -0.25, -0.16, 0.25, 0);
        tail.scale.set(1.3, 1, 0.7);
        break;
      }
      default:
        break;
    }
  }

  buildAccessory(type) {
    const g = this.accGroup;
    this.clear(g);
    const glow = this.mats.accent;
    const metal = this.mats.boot;
    switch (type) {
      case 'halo': {
        const halo = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 32), glow);
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 0.36;
        g.add(halo);
        this.spinner = halo;
        break;
      }
      case 'antenna': {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26), metal);
        rod.position.set(0.1, 0.28, 0);
        rod.rotation.z = -0.25;
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), glow);
        tip.position.set(0.135, 0.41, 0);
        g.add(rod, tip);
        break;
      }
      case 'horns':
        [-1, 1].forEach((s) => {
          const horn = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 8), glow);
          horn.position.set(0.11 * s, 0.2, 0.02);
          horn.rotation.z = -0.5 * s;
          g.add(horn);
        });
        break;
      case 'headphones': {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 8, 24, Math.PI), metal);
        band.position.y = 0.02;
        g.add(band);
        [-1, 1].forEach((s) => {
          const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 16), metal);
          cup.rotation.z = Math.PI / 2;
          cup.position.set(0.2 * s, 0, 0);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 6, 20), glow);
          ring.rotation.y = Math.PI / 2;
          ring.position.set(0.23 * s, 0, 0);
          g.add(cup, ring);
        });
        break;
      }
      default:
        break;
    }
    if (type !== 'halo') this.spinner = null;
  }

  buildNameTag(name) {
    if (this.nameTag) {
      this.root.remove(this.nameTag);
      this.nameTag.material.map.dispose();
      this.nameTag.material.dispose();
    }
    this.nameTag = makeTextSprite(name || 'Viaggiatore', { fontSize: 44, height: 0.18 });
    this.nameTag.position.y = 2.25 * this.config.height;
    this.root.add(this.nameTag);
  }

  setNameVisible(v) {
    if (this.nameTag) this.nameTag.visible = v;
  }

  /**
   * @param {number} dt
   * @param {number} speed velocità orizzontale (m/s)
   * @param {boolean} grounded
   * @param {number} t tempo totale
   */
  animate(dt, speed, grounded, t) {
    const walk = Math.min(speed / 3, 1.6);
    this.phase += dt * (4 + speed * 2.1);
    this.airBlend += ((grounded ? 0 : 1) - this.airBlend) * Math.min(dt * 10, 1);

    const swing = Math.sin(this.phase) * 0.75 * Math.min(walk, 1.2);
    const air = this.airBlend;
    this.legs[0].rotation.x = swing * (1 - air) - 0.5 * air;
    this.legs[1].rotation.x = -swing * (1 - air) + 0.3 * air;
    this.arms[0].rotation.x = -swing * 0.8 * (1 - air) - 2.4 * air;
    this.arms[1].rotation.x = swing * 0.8 * (1 - air) - 2.4 * air;

    const breathe = Math.sin(t * 2) * 0.012;
    const bob = Math.abs(Math.cos(this.phase)) * 0.06 * Math.min(walk, 1) * (1 - air);
    this.hips.position.y = 0.95 + bob + breathe;
    this.torso.rotation.x = 0.12 * Math.min(walk, 1.3) * (1 - air);
    this.torso.rotation.y = Math.sin(this.phase) * 0.12 * Math.min(walk, 1);
    this.head.rotation.y = -this.torso.rotation.y * 0.8;

    this.mats.accent.emissiveIntensity = 1.8 + Math.sin(t * 3) * 0.5;
    if (this.spinner) this.spinner.rotation.z += dt * 1.5;
  }
}
