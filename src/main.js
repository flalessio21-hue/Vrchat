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
import { ShopUI } from './ui/ShopUI.js';
import { Economy } from './game/Economy.js';
import { Items, Gear } from './game/Gear.js';
import { Coins } from './game/Coins.js';
import { NPCs } from './game/NPCs.js';
import { SHOP_INFO, item } from './game/catalog.js';

const canvas = document.getElementById('scene');
const engine = new Engine(canvas);

// caricamento dei modelli Blender con barra di avanzamento
const startBtn = document.getElementById('btn-start');
const progress = { avatar: 0, hub: 0, items: 0 };
const showProgress = () => {
  const pct = Math.round(((progress.avatar + progress.hub + progress.items) / 3) * 100);
  startBtn.textContent = `Caricamento… ${pct}%`;
};
const track = (key) => (e) => {
  if (e.lengthComputable) progress[key] = e.loaded / e.total;
  showProgress();
};
startBtn.disabled = true;
showProgress();
try {
  await Promise.all([Avatar.load(track('avatar')), Hub.load(track('hub')), Items.load(track('items'))]);
} catch (err) {
  // niente attesa infinita: mostriamo cosa è andato storto
  console.error(err);
  startBtn.textContent = 'Errore di caricamento';
  const msg = document.createElement('p');
  msg.className = 'hint';
  msg.textContent = `Non riesco a caricare i modelli 3D (${err.message}). Ricarica la pagina; se il problema resta, prova un altro browser.`;
  startBtn.after(msg);
  throw err;
}
startBtn.disabled = false;
startBtn.textContent = 'Entra nel mondo';

const hub = new Hub(engine.scene, engine.renderer);

let avatarConfig = sanitizeAvatar(load('avatar.v2', DEFAULT_AVATAR));
const avatar = new Avatar(avatarConfig);
const player = new PlayerController(engine, avatar, hub);
const input = new InputManager(canvas, engine.renderer);
const hud = new HUD(hub);
hud.setName(avatarConfig.name);

// --- economia, negozi, veicoli, animali, monete, passanti
const economy = new Economy();
const gear = new Gear(engine.scene, player, hub);
const coins = new Coins(engine.scene, hub.layout.coins || []);
const npcs = new NPCs(engine.scene, hub);
const coinsEl = document.getElementById('hud-coins');
const rideBtn = document.getElementById('btn-ride');
function refreshCoins() {
  coinsEl.textContent = `🪙 ${economy.coins}`;
}
function applyEquip(type, id) {
  if (type === 'vehicle') {
    gear.setVehicle(id);
    rideBtn.classList.toggle('hidden', !id);
    if (id) rideBtn.textContent = item(id).emoji;
  } else if (type === 'pet') gear.setPet(id);
  else if (type === 'effect') gear.setEffect(id);
}
economy.onChange(refreshCoins);
refreshCoins();
for (const type of ['vehicle', 'pet', 'effect']) applyEquip(type, economy.equipped(type));
const shopUI = new ShopUI(economy, {
  onEquip: (type, id) => applyEquip(type, id),
  onSnack: (it) => {
    avatar.playEmote(it.id === 'bubble' ? 'dance' : 'cheer');
  },
  onClose: () => (input.enabled = true),
});
function openShop(id) {
  if (engine.isXR) return;
  input.enabled = false;
  shopUI.open(id);
}
function toggleRide() {
  if (!gear.vehicle) {
    hud.toast('Non hai ancora un veicolo: passa dal <b>Garage Turbo</b> in piazza!', 2.5);
    return;
  }
  gear.setRiding(!gear.riding);
}
// merce in vetrina sui piedistalli dei negozi
const showcase = [];
for (const [id, shop] of Object.entries(hub.layout.shops || {})) {
  (SHOP_INFO[id]?.displays || []).forEach((itemId, i) => {
    const d = shop.displays[i];
    if (!d) return;
    const m = Items.model(itemId, item(itemId)?.color);
    m.position.set(d[0], d[1], d[2]);
    engine.scene.add(m);
    showcase.push(m);
  });
}

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

function openTravel() {
  if (engine.isXR) return;
  input.enabled = false;
  hud.openTravel(player.position, player.facing, (d) => {
    player.teleport(d.pos, d.facing);
    hud.toast(`Teletrasportato: <b>${d.name}</b>`, 2.2);
  });
}
document.getElementById('travel-close').addEventListener('click', () => (input.enabled = true));
document.getElementById('travel').addEventListener('click', () => {
  if (!hud.travelOpen) input.enabled = !editor.isOpen;
});

function interact(it) {
  if (it.type === 'teleport') return openTravel();
  if (it.type === 'shop') return openShop(it.data);
  if (it.type === 'screen') {
    if (it.data === 'explore') return openTravel();
    if (it.data === 'create') return editor.open();
    if (it.data === 'play') {
      hud.toast('🎮 I <b>portali</b> ad arco intorno alla piazza portano ai mondi di gioco.<br><small>Arena, Pianeta Musica, Circuito Neon e altri: in arrivo!</small>', 4);
      return;
    }
    if (it.data === 'social') {
      const n = npcs.list.filter((x) => x.av.root.visible).length;
      avatar.playEmote('wave');
      hud.toast(`👥 Ci sono <b>${n}</b> persone qui vicino. Saluta con 1, balla con 2!`, 3);
      return;
    }
  }
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

engine.onUpdate((dt, t) => {
  const state = input.poll();
  if (state.avatar && !engine.isXR) editor.toggle();
  if (state.map) openTravel();
  if (state.bag) openShop('inventory');
  if (state.ride) toggleRide();
  if (state.emote) player.emote(state.emote);

  player.update(dt, state);
  gear.update(dt, t);
  npcs.update(dt, t, player.position);
  const got = coins.update(dt, t, player);
  if (got) {
    economy.add(got);
    coinsEl.classList.remove('bump');
    void coinsEl.offsetWidth;
    coinsEl.classList.add('bump');
  }
  for (const m of showcase) m.rotation.y += dt * 0.8;
  hub.update(dt, t, player.position, engine.isXR);
  hub.followShadow(player.position);

  // oggetto interattivo più vicino (portali, panchine, specchio)
  let near = null;
  let best = Infinity;
  if (!player.seat) {
    const px = player.position.x;
    const pz = player.position.z;
    for (const it of hub.interactables) {
      const d = Math.hypot(it.point.x - px, it.point.z - pz);
      if (d < it.radius && d < best && Math.abs(player.position.y - it.point.y) < 1.8) {
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
  hud.setZone(hub.zoneAt(player.position.x, player.position.z));
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
document.getElementById('btn-travel').addEventListener('click', openTravel);
document.getElementById('btn-bag').addEventListener('click', () => openShop('inventory'));
rideBtn.addEventListener('click', toggleRide);
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
window.oasis = { engine, hub, player, avatar, economy, gear, npcs, coins, shopUI };
