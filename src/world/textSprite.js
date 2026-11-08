import * as THREE from 'three';

function spriteFromCanvas(canvas, height) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  return sprite;
}

/** Sprite con testo (insegne, etichette). */
export function makeTextSprite(text, { fontSize = 48, color = '#ffffff', glow = '#39e6ff', height = 0.3, bg = 'rgba(5,1,15,0.55)' } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `700 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.font = font;
  const pad = fontSize * 0.5;
  canvas.width = Math.ceil(ctx.measureText(text).width + pad * 2);
  canvas.height = Math.ceil(fontSize * 1.6);
  const w = canvas.width;
  const h = canvas.height;
  ctx.font = font;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h / 2);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = glow;
  ctx.shadowBlur = fontSize * 0.3;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 2);
  return spriteFromCanvas(canvas, height);
}

/** Targhetta del nome sopra la testa, in stile social VR. */
export function makeNameTag(name, { status = 'Online' } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '700 52px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.font = font;
  const tw = ctx.measureText(name).width;
  canvas.width = Math.ceil(Math.max(tw, 120) + 110);
  canvas.height = 112;
  const w = canvas.width;
  ctx.fillStyle = 'rgba(14, 10, 30, 0.72)';
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, 76, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140, 230, 255, 0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // indicatore di stato
  ctx.fillStyle = '#5dff9a';
  ctx.beginPath();
  ctx.arc(42, 42, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 66, 44);
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(200, 220, 255, 0.85)';
  ctx.textAlign = 'center';
  ctx.fillText(status, w / 2, 98);
  return spriteFromCanvas(canvas, 0.2);
}

/** Pannello rettangolare con testo multilinea (bacheche, info mondi). */
export function makePanelTexture(draw, w = 1024, h = 640) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
