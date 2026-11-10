import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { load, save } from './core/storage.js';
import { Hub } from './world/Hub.js';
import { makeTextSprite } from './world/textSprite.js';
import { Avatar } from './player/Avatar.js';
import { DEFAULT_AVATAR, sanitizeAvatar } from './player/avatarConfig.js';
import { PlayerController } from './player/PlayerController.js';
import { InputManager } from './input/InputManager.js';
import { AvatarEditor } from './ui/AvatarEditor.js';
import { HUD } from './ui/HUD.js';

const canvas = document.getElementById('scene');
const engine = new Engine(canvas);

// caricamento dei modelli Blender con barra di avanzamento
const startBtn = document.getElementById('btn-start');
const progress = { avatar: 0, hub: 0 };
const showProgress = () => {
  const pct = Math.round(((progress.avatar + progress.hub) / 2) * 100);
  startBtn.textContent = `Caricamento… ${pct}%`;
};
const track = (key) => (e) => {
  if (e.lengthComputable) progress[key] = e.loaded / e.total;
  showProgress();
};
startBtn.disabled = true;
showProgress();
await Promise.all([Avatar.load(track('avatar')), Hub.load(track('hub'))]);
startBtn.disabled = false;
startBtn.textContent = 'Entra nel mondo';

const hub = new Hub(engine.scene, engine.renderer);

let avatarConfig = sanitizeAvatar(load('avatar.v2', DEFAULT_AVATAR));
const avatar = new Avatar(avatarConfig);
const player = new PlayerController(engine, avatar, hub);
const input = new InputManager(canvas, engine.renderer);
const hud = new HUD(hub);
hud.setName(avatarConfig.name);

const editor = new AvatarEditor({
  getConfig: () => avatarConfig,
  onChange: (cfg) => {
    avatarConfig = sanitizeAvatar(cfg);
    avatar.apply(avatarConfig);
    hud.setName(avatarConfig.name);
    save('avatar.v2', avatarConfig);
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
 * Punto di aggancio per i mondi futuri: ogni mondo potrà essere un modulo
 * caricato on-demand (import dinamico) che sostituisce l'hub nella scena.
 */
const WorldManager = {
  enter(world) {
    if (!world.ready) {
      hud.toast(`<b style="color:${world.color}">${world.name}</b><br>${world.desc}<br><small>Mondo in costruzione: torna presto!</small>`, 3.5);
      return;
    }
    // TODO: const mod = await import(`./worlds/${world.id}.js`); mod.load(engine, player)
  },
};

function interact(it) {
  if (it.type === 'portal') WorldManager.enter(it.data.world);
  else if (it.type === 'sit') player.sit(it.data);
  else if (it.type === 'mirror') {
    hub.toggleMirror();
    hud.toast(hub.mirrorOn ? 'Specchio acceso' : 'Specchio spento', 1.5);
  }
}

// Etichetta 3D di interazione: visibile anche in VR, dove l'HTML non c'è
let worldPrompt = null;
function setWorldPrompt(it) {
  if (worldPrompt?.userData.it === it) return;
  if (worldPrompt) {
    engine.scene.remove(worldPrompt);
    worldPrompt.material.map.dispose();
    worldPrompt = null;
  }
  if (!it || !engine.isXR) return;
  worldPrompt = makeTextSprite(it.label, { fontSize: 40, height: 0.3, glow: '#7ff0ff' });
  worldPrompt.userData.it = it;
  worldPrompt.position.copy(it.point).setY(player.position.y + 1.9);
  engine.scene.add(worldPrompt);
}

let gemFound = false;
const flat = new THREE.Vector3();

engine.onUpdate((dt, t) => {
  const state = input.poll();
  if (state.avatar && !engine.isXR) editor.toggle();
  if (state.emote) player.emote(state.emote);

  player.update(dt, state);
  hub.update(dt, t, player.position, engine.isXR);
  hub.followShadow(player.position);

  // oggetto interattivo più vicino (portali, panchine, specchio)
  let near = null;
  let best = Infinity;
  if (!player.seat) {
    flat.set(player.position.x, 0, player.position.z);
    for (const it of hub.interactables) {
      const d = it.point.distanceTo(flat);
      if (d < it.radius && d < best && Math.abs(player.position.y) < 1.5) {
        best = d;
        near = it;
      }
    }
  }
  setWorldPrompt(near);
  const key = input.isTouch ? 'E' : 'E';
  if (player.seat) hud.setPrompt(input.isTouch ? '↕' : 'WASD', 'Alzati');
  else hud.setPrompt(near ? key : null, near ? (near.type === 'portal' ? `Entra: ${near.label}` : near.label) : '');
  if (near && state.interact) interact(near);

  hud.setActiveEmote(player.seat ? null : avatar.emote);

  if (!gemFound && hub.gem && player.position.distanceTo(hub.gem.position) < 1.7) {
    gemFound = true;
    hub.gem.visible = false;
    avatar.playEmote('cheer');
    hud.toast('✦ Hai trovato il <b style="color:#9dff9a">Cristallo Verde</b>! ✦', 3);
  }

  hud.drawMinimap(player.position, player.facing);
});

hud.onEmote((id) => player.emote(id));

// --- Avvio
document.getElementById('btn-start').addEventListener('click', () => {
  document.getElementById('loading').classList.add('hidden');
  hud.show();
  if (!load('seenEditor', { v: false }).v) {
    save('seenEditor', { v: true });
    editor.open();
  } else {
    hud.toast('Benvenuto in <b>Oasis</b>!', 2.5);
  }
});
document.getElementById('btn-avatar').addEventListener('click', () => editor.toggle());
document.getElementById('btn-mirror').addEventListener('click', () => {
  hub.toggleMirror();
  hud.toast(hub.mirrorOn ? 'Specchio acceso' : 'Specchio spento', 1.5);
});

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
