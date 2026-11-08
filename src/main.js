import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { load, save } from './core/storage.js';
import { Hub } from './world/Hub.js';
import { makeTextSprite } from './world/textSprite.js';
import { Avatar } from './player/Avatar.js';
import { DEFAULT_AVATAR } from './player/avatarConfig.js';
import { PlayerController } from './player/PlayerController.js';
import { InputManager } from './input/InputManager.js';
import { AvatarEditor } from './ui/AvatarEditor.js';
import { HUD } from './ui/HUD.js';

const canvas = document.getElementById('scene');
const engine = new Engine(canvas);
const hub = new Hub(engine.scene);

let avatarConfig = load('avatar', DEFAULT_AVATAR);
const avatar = new Avatar(avatarConfig);
const player = new PlayerController(engine, avatar, hub);
const input = new InputManager(canvas, engine.renderer);
const hud = new HUD(hub);
hud.setName(avatarConfig.name);

const editor = new AvatarEditor({
  getConfig: () => avatarConfig,
  onChange: (cfg) => {
    avatarConfig = cfg;
    avatar.apply(cfg);
    hud.setName(cfg.name);
    save('avatar', cfg);
  },
  onOpen: () => {
    player.preview = true;
    input.enabled = false;
  },
  onClose: () => {
    player.preview = false;
    input.enabled = true;
  },
});

/**
 * Punto di aggancio per i mondi futuri. Ogni mondo potrà essere un modulo
 * caricato on-demand (import dinamico) che sostituisce l'hub nella scena.
 */
const WorldManager = {
  enter(world) {
    if (!world.ready) {
      hud.toast(`<b style="color:${world.color}">${world.name}</b><br>${world.desc}<br><small>Mondo in costruzione — torna presto!</small>`, 3.5);
      return;
    }
    // TODO: const mod = await import(`./worlds/${world.id}.js`); mod.load(engine, player)
  },
};

// Etichetta 3D di interazione (visibile anche nel visore, dove l'HTML non c'è)
let worldPrompt = null;
function setWorldPrompt(portal) {
  if (worldPrompt?.userData.id === portal?.world.id) return;
  if (worldPrompt) {
    engine.scene.remove(worldPrompt);
    worldPrompt.material.map.dispose();
    worldPrompt = null;
  }
  if (!portal) return;
  const text = portal.world.ready ? `Entra: ${portal.world.name}` : `${portal.world.name} · in costruzione`;
  worldPrompt = makeTextSprite(text, { fontSize: 40, height: 0.38, glow: portal.world.color });
  worldPrompt.userData.id = portal.world.id;
  worldPrompt.position.copy(portal.interactPoint).setY(2.6);
  engine.scene.add(worldPrompt);
}

let gemFound = false;

engine.onUpdate((dt, t) => {
  const state = input.poll();
  if (state.avatar && !engine.isXR) editor.toggle();

  player.update(dt, state);
  hub.update(dt, t);
  hub.followShadow(player.position);

  // portale più vicino
  let near = null;
  for (const p of hub.portals) {
    if (p.interactPoint.distanceTo(tmp.set(player.position.x, 0, player.position.z)) < 3.2) near = p;
  }
  setWorldPrompt(near);
  const touch = input.isTouch;
  hud.setPrompt(near ? `${touch ? 'Tocca E' : 'Premi E'} — ${near.world.name}` : null);
  if (near && state.interact) WorldManager.enter(near.world);

  if (!gemFound && hub.gem && player.position.distanceTo(hub.gem.position) < 1.6) {
    gemFound = true;
    hub.gem.visible = false;
    hud.toast('✦ Hai trovato il <b>Cristallo Verde</b>! ✦', 3);
  }

  hud.drawMinimap(player.position, player.facing);
});
const tmp = new THREE.Vector3();

// --- Avvio
document.getElementById('btn-start').addEventListener('click', () => {
  document.getElementById('loading').classList.add('hidden');
  hud.show();
  if (!load('seenEditor', { v: false }).v) {
    save('seenEditor', { v: true });
    editor.open();
  }
});
document.getElementById('btn-avatar').addEventListener('click', () => editor.toggle());

Engine.isVRSupported().then((ok) => {
  if (!ok) return;
  const btn = document.getElementById('btn-vr');
  btn.classList.remove('hidden');
  btn.addEventListener('click', async () => {
    editor.close();
    try {
      await engine.enterVR();
    } catch (e) {
      hud.toast('Impossibile avviare la VR: ' + e.message);
    }
  });
});

engine.start();

// Debug in console
window.oasis = { engine, hub, player, avatar };
