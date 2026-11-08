/** Elementi HTML sopra la scena: nome, prompt di interazione, notifiche, minimappa, emote. */
export class HUD {
  constructor(world) {
    this.world = world;
    this.el = document.getElementById('hud');
    this.name = document.getElementById('hud-name');
    this.prompt = document.getElementById('prompt');
    this.toastEl = document.getElementById('toast');
    this.map = document.getElementById('minimap-canvas');
    this.ctx = this.map.getContext('2d');
    this.emoteButtons = [...document.querySelectorAll('#emotes button')];
    this.toastTimer = 0;
    this.lastPrompt = null;
  }

  show() {
    this.el.classList.remove('hidden');
  }

  setName(name) {
    this.name.textContent = name;
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

  drawMinimap(pos, facing) {
    const ctx = this.ctx;
    const S = this.map.width;
    const scale = S / 2 / 54;
    const toMap = (x, z) => [S / 2 + x * scale, S / 2 + z * scale];
    ctx.clearRect(0, 0, S, S);

    ctx.fillStyle = 'rgba(95, 174, 106, 0.35)';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 50 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(240, 230, 250, 0.35)';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 24 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7ff0ff';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 4, 0, Math.PI * 2);
    ctx.fill();

    // specchio
    const [mx, my] = toMap(0, -19.5);
    ctx.fillStyle = '#ff9ce8';
    ctx.fillRect(mx - 7, my - 1.5, 14, 3);

    for (const p of this.world.portals) {
      const [x, y] = toMap(p.position.x, p.position.z);
      ctx.fillStyle = p.world.color;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const [px, py] = toMap(pos.x, pos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-facing);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1030';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(5, -4);
    ctx.lineTo(-5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
