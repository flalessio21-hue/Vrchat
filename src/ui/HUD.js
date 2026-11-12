/** Elementi HTML sopra la scena: nome, luogo, prompt, notifiche, minimappa, mappa e teletrasporti. */
export class HUD {
  constructor(world) {
    this.world = world;
    this.el = document.getElementById('hud');
    this.name = document.getElementById('hud-name');
    this.location = document.getElementById('hud-location');
    this.prompt = document.getElementById('prompt');
    this.toastEl = document.getElementById('toast');
    this.map = document.getElementById('minimap-canvas');
    this.ctx = this.map.getContext('2d');
    this.emoteButtons = [...document.querySelectorAll('#emotes button')];
    this.travel = document.getElementById('travel');
    this.toastTimer = 0;
    this.lastPrompt = null;
    this.lastZone = null;
    this.baseMap = this.buildBaseMap();
    document.getElementById('travel-close').addEventListener('click', () => this.closeTravel());
    this.travel.addEventListener('click', (e) => {
      if (e.target === this.travel) this.closeTravel();
    });
  }

  show() {
    this.el.classList.remove('hidden');
  }

  setName(name) {
    this.name.textContent = name;
  }

  setZone(name) {
    if (name === this.lastZone) return;
    const first = this.lastZone === null;
    this.lastZone = name;
    this.location.textContent = `Oasis · ${name}`;
    if (!first) this.toast(`<b>${name}</b>`, 2);
  }

  /** @param {string|null} key tasto da mostrare  @param {string} text azione */
  setPrompt(key, text) {
    const id = key ? key + text : null;
    if (id === this.lastPrompt) return;
    this.lastPrompt = id;
    this.prompt.classList.toggle('hidden', !id);
    if (!id) return;
    this.prompt.textContent = '';
    const k = document.createElement('kbd');
    k.textContent = key;
    this.prompt.append(k, text);
  }

  toast(html, seconds = 3) {
    this.toastEl.innerHTML = html;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), seconds * 1000);
  }

  onEmote(fn) {
    for (const b of this.emoteButtons) b.addEventListener('click', () => fn(b.dataset.emote));
  }

  setActiveEmote(id) {
    for (const b of this.emoteButtons) b.classList.toggle('active', b.dataset.emote === id);
  }

  // ------------------------------------------------------------- mappa del mondo
  /** Disegna una volta la mappa dell'isola dai dati di Blender (altezze, erba, strade, edifici). */
  buildBaseMap() {
    const w = this.world;
    const t = w.terrain;
    const S = 512;
    const half = -t.origin;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    const R = w.layout.worldRadius || 180;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = (px / S) * 2 * half - half;
        const z = (py / S) * 2 * half - half;
        const i = (py * S + px) * 4;
        if (Math.hypot(x, z) > R) {
          img.data[i + 3] = 0;
          continue;
        }
        const h = w.terrainHeight(x, z);
        const gi = Math.round((z - t.origin) / t.step) * t.n + Math.round((x - t.origin) / t.step);
        const g = t.grass[gi] / 255;
        let c;
        if (h < -0.6) c = [70, 140, 210];
        else if (g > 0.3) c = [80 + h * 3, 150 + h * 2, 85];
        else c = [190, 170, 150];
        const shade = 0.85 + Math.min(h, 24) / 60;
        img.data[i] = c[0] * shade;
        img.data[i + 1] = c[1] * shade;
        img.data[i + 2] = c[2] * shade;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const k = S / (2 * half);
    const P = (x, z) => [(x + half) * k, (z + half) * k];
    // strade
    ctx.strokeStyle = 'rgba(240, 225, 200, 0.9)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const road of w.layout.roads || []) {
      ctx.beginPath();
      road.forEach(([x, z], j) => ctx[j ? 'lineTo' : 'moveTo'](...P(x, z)));
      ctx.stroke();
    }
    // piazza
    ctx.fillStyle = '#e8e0f0';
    ctx.beginPath();
    ctx.arc(...P(0, 0), (w.layout.plazaRadius || 24) * k, 0, Math.PI * 2);
    ctx.fill();
    // edifici
    ctx.fillStyle = '#3a2d5a';
    for (const b of w.boxColliders) {
      ctx.save();
      ctx.translate(...P(b.x, b.z));
      ctx.rotate(b.rot);
      ctx.fillRect(-b.hw * k, -b.hd * k, b.hw * 2 * k, b.hd * 2 * k);
      ctx.restore();
    }
    // portali
    for (const p of w.portals) {
      ctx.fillStyle = p.world.color;
      ctx.beginPath();
      ctx.arc(...P(p.position.x, p.position.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    this.mapScale = k;
    this.mapHalf = half;
    return cv;
  }

  drawMinimap(pos, facing) {
    const ctx = this.ctx;
    const S = this.map.width;
    const view = 70; // metri visibili dal centro
    const k = this.mapScale;
    const src = view * k;
    const [cx, cz] = [(pos.x + this.mapHalf) * k, (pos.z + this.mapHalf) * k];
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2a2050';
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(this.baseMap, cx - src, cz - src, src * 2, src * 2, 0, 0, S, S);
    ctx.restore();
    this.drawArrow(ctx, S / 2, S / 2, facing);
  }

  drawArrow(ctx, x, y, facing, size = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-facing);
    ctx.scale(size, size);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1030';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(5.5, -4);
    ctx.lineTo(-5.5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------- teletrasporti
  get travelOpen() {
    return !this.travel.classList.contains('hidden');
  }

  openTravel(pos, facing, onGo) {
    const cv = document.getElementById('travel-map');
    const ctx = cv.getContext('2d');
    const S = cv.width;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.baseMap, 0, 0, S, S);
    const k = S / (2 * this.mapHalf);
    const P = (x, z) => [(x + this.mapHalf) * k, (z + this.mapHalf) * k];
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const zn of this.world.zones) {
      const [x, y] = P(zn.x, zn.z);
      ctx.fillStyle = 'rgba(20, 12, 40, 0.65)';
      const w = ctx.measureText(zn.name).width + 10;
      ctx.fillRect(x - w / 2, y - 22, w, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(zn.name, x, y - 10);
    }
    this.drawArrow(ctx, ...P(pos.x, pos.z), facing, 1.3);

    const list = document.getElementById('travel-list');
    list.textContent = '';
    for (const d of this.world.destinations) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = '📍 ' + d.name;
      b.onclick = () => {
        this.closeTravel();
        onGo(d);
      };
      list.appendChild(b);
    }
    this.travel.classList.remove('hidden');
  }

  closeTravel() {
    this.travel.classList.add('hidden');
  }
}
