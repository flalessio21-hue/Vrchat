import * as THREE from 'three';
import { Avatar } from '../player/Avatar.js';
import { randomAvatar } from '../player/avatarConfig.js';
import { rng } from '../core/toon.js';

const NAMES = ['Luna', 'Kai', 'Mira', 'Teo', 'Nova', 'Zoe', 'Leo', 'Iris', 'Milo', 'Sole', 'Pixel', 'Bea', 'Rio', 'Ada', 'Ettore',
  'Gaia', 'Noa', 'Dario', 'Lia', 'Ugo', 'Vera', 'Bruno', 'Ines', 'Tito', 'Alba', 'Remo', 'Cleo', 'Ivo'];
// quanti passanti per zona (quelli della piazza tengono viva la lobby)
const PER_ZONE = { plaza: 9, city: 3, medieval: 3, east: 3, snow: 3, lake: 2, forest: 2, stage: 3 };
const ACTIVE_DIST = 75;

/**
 * Personaggi non giocanti: passeggiano tra i punti della loro zona, si fermano,
 * salutano e ballano. Ci sono anche i commessi dei negozi.
 * Quelli lontani dal giocatore vengono nascosti e non aggiornati.
 */
export class NPCs {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    const r = rng(2024);
    let n = 0;
    const mobile = matchMedia('(pointer: coarse)').matches;
    for (const [zone, spots] of Object.entries(world.layout.npcSpots || {})) {
      const count = Math.max(1, Math.round((PER_ZONE[zone] ?? 2) * (mobile ? 0.6 : 1)));
      for (let k = 0; k < count; k++) {
        const name = NAMES[n++ % NAMES.length];
        const spot = spots[Math.floor(r() * spots.length)];
        this.spawn(name, spots, new THREE.Vector3(...spot), r);
      }
    }
    // commessi dietro i banconi
    for (const [id, shop] of Object.entries(world.layout.shops || {})) {
      const [x, y, z, f] = shop.keeper;
      const npc = this.spawn({ veicoli: 'Gino', animali: 'Pia', effetti: 'Merlina', snack: 'Bianca' }[id] || 'Commesso', null, new THREE.Vector3(x, y, z), r);
      npc.facing = f;
      npc.shopFacing = f;
      npc.keeper = true;
    }
  }

  spawn(name, spots, pos, r) {
    const cfg = randomAvatar(name);
    const av = new Avatar(cfg, { npc: true });
    av.root.position.copy(pos);
    this.scene.add(av.root);
    const npc = { av, spots, pos: pos.clone(), target: null, wait: r() * 4, facing: r() * Math.PI * 2, speed: 0, r, keeper: false };
    this.list.push(npc);
    return npc;
  }

  update(dt, t, playerPos) {
    for (const npc of this.list) {
      const d = npc.pos.distanceTo(playerPos);
      const active = d < ACTIVE_DIST;
      npc.av.root.visible = active;
      if (!active) continue;
      if (npc.keeper) {
        // il commesso saluta quando ti avvicini
        if (d < 5 && !npc.av.emote && npc.r() < 0.01) npc.av.playEmote('wave');
        npc.facing = d < 6 ? Math.atan2(playerPos.x - npc.pos.x, playerPos.z - npc.pos.z) : npc.shopFacing;
        this.place(npc, dt, t, 0);
        continue;
      }
      if (npc.target) {
        const dx = npc.target.x - npc.pos.x;
        const dz = npc.target.z - npc.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3) {
          npc.target = null;
          npc.wait = 2 + npc.r() * 6;
          const roll = npc.r();
          if (roll < 0.2) npc.av.playEmote('wave');
          else if (roll < 0.35) npc.av.playEmote('dance');
          else if (roll < 0.42) npc.av.playEmote('cheer');
          npc.speed = 0;
        } else {
          npc.speed += (1.5 - npc.speed) * Math.min(dt * 3, 1);
          npc.pos.x += (dx / dist) * npc.speed * dt;
          npc.pos.z += (dz / dist) * npc.speed * dt;
          npc.facing = Math.atan2(dx, dz);
        }
      } else {
        npc.speed = 0;
        npc.wait -= dt;
        if (npc.wait <= 0 && npc.spots) {
          const s = npc.spots[Math.floor(npc.r() * npc.spots.length)];
          const jitter = 2.5;
          npc.target = new THREE.Vector3(s[0] + (npc.r() - 0.5) * jitter, 0, s[2] + (npc.r() - 0.5) * jitter);
          npc.av.stopEmote();
        }
      }
      this.place(npc, dt, t, npc.speed);
    }
  }

  place(npc, dt, t, speed) {
    npc.pos.y = this.world.groundAt(npc.pos.x, npc.pos.z, npc.pos.y + 1);
    const root = npc.av.root;
    root.position.copy(npc.pos);
    let d = npc.facing - root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    root.rotation.y += d * Math.min(dt * 8, 1);
    npc.av.animate(dt, speed, true, t);
  }
}
