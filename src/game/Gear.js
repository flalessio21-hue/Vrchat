import * as THREE from 'three';
import { loadGLTF } from '../core/assets.js';
import { item } from './catalog.js';

/**
 * Modelli dei negozi (tools/blender/items.py): veicoli, animali, moneta.
 * Gear gestisce ciò che il giocatore ha addosso: veicolo, animale ed effetto.
 */
export class Items {
  static async load(onProgress) {
    Items.asset = await loadGLTF('models/items.glb', onProgress);
  }

  /** Copia di un modello con i materiali pronti (colore principale opzionale). */
  static model(id, color) {
    const src = Items.asset.scene.getObjectByName(`Item_${id}`);
    const obj = src.clone(true);
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (o.material.name === 'VehMain' && color) o.material.color.set(color);
      o.castShadow = true;
    });
    return obj;
  }

  static coinGeometry() {
    const src = Items.asset.scene.getObjectByName('Item_coin');
    const meshes = [];
    src.traverse((o) => o.isMesh && meshes.push(o));
    return { geometry: meshes[0].geometry, material: meshes[0].material };
  }
}

const tmp = new THREE.Vector3();

export class Gear {
  constructor(scene, player, world) {
    this.scene = scene;
    this.player = player;
    this.world = world;
    this.vehicle = null; // { id, obj, data }
    this.riding = false;
    this.pet = null;
    this.effect = null;
    this.fx = null;
  }

  // ------------------------------------------------------------- veicolo
  setVehicle(id) {
    if (this.vehicle) this.scene.remove(this.vehicle.obj);
    this.vehicle = null;
    if (id) {
      const data = item(id);
      const obj = Items.model(id, data.color);
      this.scene.add(obj);
      this.vehicle = { id, obj, data };
    }
    this.setRiding(!!id);
  }

  setRiding(on) {
    this.riding = on && !!this.vehicle;
    if (this.vehicle) this.vehicle.obj.visible = this.riding;
    this.player.speedMul = this.riding ? this.vehicle.data.speed : 1;
    this.player.avatar.riding = this.riding ? this.vehicle.data.pose : null;
    this.player.riderY = this.riding ? this.vehicle.data.riderY : 0;
    if (this.riding) this.player.avatar.stopEmote();
  }

  // ------------------------------------------------------------- animale
  setPet(id) {
    if (this.pet) this.scene.remove(this.pet.obj);
    this.pet = null;
    if (!id) return;
    const obj = Items.model(id);
    obj.scale.setScalar(1.0);
    const p = this.player.position;
    obj.position.set(p.x + 1, p.y, p.z + 1);
    this.scene.add(obj);
    this.pet = { id, obj, data: item(id), vel: new THREE.Vector3(), facing: 0 };
  }

  // ------------------------------------------------------------- effetti
  setEffect(id) {
    if (this.fx) {
      this.scene.remove(this.fx.obj);
      this.fx = null;
    }
    this.effect = id;
    if (!id) return;
    if (id === 'aura') {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.75, 48),
        new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      const g = new THREE.Group();
      g.add(ring);
      this.fx = { obj: g, ring };
    } else {
      const N = 90;
      const pos = new Float32Array(N * 3);
      const life = new Float32Array(N).fill(1);
      const vel = new Float32Array(N * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const color = { sparkles: 0xfff2a8, hearts: 0xff7ab8, snowfx: 0xffffff }[id];
      const size = { sparkles: 0.14, hearts: 0.22, snowfx: 0.12 }[id];
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      pts.frustumCulled = false;
      this.fx = { obj: pts, pos, life, vel, geo, i: 0 };
    }
    this.scene.add(this.fx.obj);
  }

  // ------------------------------------------------------------- aggiornamento
  update(dt, t) {
    const pl = this.player;
    const p = pl.position;
    if (this.vehicle && this.riding) {
      const o = this.vehicle.obj;
      o.position.set(p.x, p.y + (this.vehicle.data.hover ? 0.08 + Math.sin(t * 3) * 0.04 : 0), p.z);
      o.rotation.set(0, pl.facing, 0);
      // leggera inclinazione in curva
      o.rotation.z = THREE.MathUtils.clamp(-(pl.turnRate || 0) * 0.08, -0.25, 0.25);
    }
    if (this.pet) this.updatePet(dt, t);
    if (this.fx) this.updateFx(dt, t);
  }

  updatePet(dt, t) {
    const pl = this.player;
    const pet = this.pet;
    const o = pet.obj;
    const back = pl.facing + Math.PI;
    const target = tmp.set(pl.position.x + Math.sin(back + 0.6) * 1.4, 0, pl.position.z + Math.cos(back + 0.6) * 1.4);
    const dx = target.x - o.position.x;
    const dz = target.z - o.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 25) o.position.set(target.x, pl.position.y, target.z); // teletrasporto con il padrone
    const k = Math.min(dt * 4, 1);
    o.position.x += dx * k;
    o.position.z += dz * k;
    if (dist > 0.05) pet.facing = Math.atan2(dx, dz);
    let d = pet.facing - o.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    o.rotation.y += d * Math.min(dt * 8, 1);
    const ground = this.world.groundAt(o.position.x, o.position.z, pl.position.y + 1);
    const moving = Math.min(dist / 1.5, 1);
    if (pet.data.move === 'fly') {
      o.position.y = pl.position.y + 1.7 + Math.sin(t * 2.4) * 0.15;
      o.rotation.z = Math.sin(t * 6) * 0.05;
    } else if (pet.data.move === 'hop') {
      o.position.y = ground + Math.abs(Math.sin(t * 7)) * 0.35 * (0.3 + moving);
      const sq = 1 + Math.sin(t * 14) * 0.08;
      o.scale.set(sq, 1 / sq, sq);
    } else {
      o.position.y = ground + Math.abs(Math.sin(t * 10)) * 0.05 * moving;
    }
  }

  updateFx(dt, t) {
    const pl = this.player;
    const p = pl.position;
    const fx = this.fx;
    if (fx.ring) {
      fx.obj.position.set(p.x, pl.groundY + 0.05, p.z);
      const s = 1 + Math.sin(t * 3) * 0.08;
      fx.ring.scale.set(s, s, s);
      fx.ring.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
      return;
    }
    // particelle: nuove alla posizione del giocatore, salgono/cadono e svaniscono
    const n = fx.life.length;
    const speed = Math.hypot(pl.velocity.x, pl.velocity.z);
    const spawn = this.effect === 'sparkles' ? (speed > 0.5 ? 3 : 0) : 1;
    for (let s = 0; s < spawn; s++) {
      const i = fx.i++ % n;
      fx.life[i] = 0;
      const a = Math.random() * Math.PI * 2;
      const r = this.effect === 'snowfx' ? Math.random() * 1.2 : 0.4;
      fx.pos[i * 3] = p.x + Math.cos(a) * r;
      fx.pos[i * 3 + 1] = p.y + (this.effect === 'snowfx' ? 2.6 : 0.3 + Math.random() * 1.2);
      fx.pos[i * 3 + 2] = p.z + Math.sin(a) * r;
      fx.vel[i * 3] = (Math.random() - 0.5) * 0.4;
      fx.vel[i * 3 + 1] = this.effect === 'snowfx' ? -0.8 : this.effect === 'hearts' ? 0.9 : 0.3;
      fx.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    for (let i = 0; i < n; i++) {
      fx.life[i] += dt;
      if (fx.life[i] > 1.6) {
        fx.pos[i * 3 + 1] = -9999;
        continue;
      }
      fx.pos[i * 3] += fx.vel[i * 3] * dt;
      fx.pos[i * 3 + 1] += fx.vel[i * 3 + 1] * dt;
      fx.pos[i * 3 + 2] += fx.vel[i * 3 + 2] * dt;
    }
    fx.geo.attributes.position.needsUpdate = true;
  }
}
