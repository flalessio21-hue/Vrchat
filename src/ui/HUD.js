/** Elementi HTML sopra la scena: nome, prompt di interazione, notifiche, minimappa. */
export class HUD {
  constructor(world) {
    this.world = world;
    this.el = document.getElementById('hud');
    this.name = document.getElementById('hud-name');
    this.prompt = document.getElementById('prompt');
    this.toastEl = document.getElementById('toast');
    this.map = document.getElementById('minimap-canvas');
    this.ctx = this.map.getContext('2d');
    this.toastTimer = 0;
    this.lastPrompt = null;
  }

  show() {
    this.el.classList.remove('hidden');
  }

  setName(name) {
    this.name.textContent = name;
  }

  setPrompt(text) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    this.prompt.classList.toggle('hidden', !text);
    if (text) this.prompt.textContent = text;
  }

  toast(html, seconds = 3) {
    this.toastEl.innerHTML = html;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), seconds * 1000);
  }

  drawMinimap(pos, facing) {
    const ctx = this.ctx;
    const S = this.map.width;
    const scale = S / 2 / 56;
    const toMap = (x, z) => [S / 2 + x * scale, S / 2 + z * scale];
    ctx.clearRect(0, 0, S, S);

    ctx.strokeStyle = 'rgba(57,230,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, this.world.bounds * scale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#39e6ff';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 4, 0, Math.PI * 2);
    ctx.fill();

    for (const p of this.world.portals) {
      const [x, y] = toMap(p.position.x, p.position.z);
      ctx.fillStyle = p.world.color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    const [px, py] = toMap(pos.x, pos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-facing);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(4, -4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
