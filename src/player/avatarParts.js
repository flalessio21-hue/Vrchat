import * as THREE from 'three';

/**
 * Arto affusolato con estremità arrotondate. L'origine è sull'articolazione
 * superiore e l'arto scende lungo -Y, così basta ruotare il pivot.
 */
export function limbGeometry(rTop, rBot, len, radial = 14) {
  const pts = [];
  const N = 5;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(rBot * Math.cos(a), 1e-4), -len + rBot * Math.sin(a)));
  }
  for (let i = 1; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(rTop * Math.cos(a), 1e-4), rTop * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/** Solido di rotazione da un profilo [[raggio, y], ...] dal basso verso l'alto. */
export function latheGeometry(profile, radial = 24, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), radial, phiStart, phiLength);
}

/**
 * Ciocca di capelli / coda: tubo lungo una curva che si assottiglia.
 * @param {THREE.Vector3[]} points punti della curva
 * @param {number} r0 raggio iniziale
 * @param {number} r1 raggio finale
 * @param {number} flat schiacciamento laterale (1 = tondo)
 */
export function strandGeometry(points, r0, r1 = 0.002, { segments = 16, radial = 8, flat = 1, bulge = 0.25 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ring = radial + 1;
  for (let i = 0; i < pos.count; i++) {
    const seg = Math.floor(i / ring);
    const t = seg / segments;
    curve.getPointAt(t, c);
    // forma a goccia: un po' più spessa verso il primo terzo
    const r = THREE.MathUtils.lerp(r0, r1, t) * (1 + Math.sin(Math.min(t * 3, 1) * Math.PI) * bulge);
    v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(r);
    v.x *= flat;
    v.add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // chiude le estremità
  geo.computeVertexNormals();
  return geo;
}

/** Disegna il viso su un canvas (occhi, sopracciglia, bocca, guance). */
export function drawFace(ctx, S, { eyeColor, hairColor, eyes, expression }) {
  ctx.clearRect(0, 0, S, S);
  const k = S / 512;
  const eyeY = 246 * k;
  const dx = 138 * k;
  const W = (eyes === 'sharp' ? 56 : 62) * k;
  const H = (eyes === 'sharp' ? 62 : 80) * k;
  const lash = '#1d1424';
  const brow = shade(hairColor, -0.45);

  // guance
  ctx.fillStyle = 'rgba(255,120,150,0.28)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(256 * k + s * 160 * k, 338 * k, 40 * k, 18 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // sopracciglia
  ctx.strokeStyle = brow;
  ctx.lineCap = 'round';
  ctx.lineWidth = 9 * k;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    const bx = 256 * k + s * dx;
    const tilt = eyes === 'sharp' ? 14 * k : expression === 'happy' ? -6 * k : 0;
    ctx.moveTo(bx - s * 40 * k, 142 * k + tilt);
    ctx.quadraticCurveTo(bx, 126 * k, bx + s * 42 * k, 138 * k - tilt * 0.3);
    ctx.stroke();
  }

  for (const s of [-1, 1]) {
    const cx = 256 * k + s * dx;
    if (expression === 'blink' || expression === 'happy') {
      // occhi chiusi (^ ^ se felice)
      ctx.strokeStyle = lash;
      ctx.lineWidth = 11 * k;
      ctx.beginPath();
      if (expression === 'happy') {
        ctx.moveTo(cx - W, eyeY + 14 * k);
        ctx.quadraticCurveTo(cx, eyeY - 34 * k, cx + W, eyeY + 14 * k);
      } else {
        ctx.moveTo(cx - W, eyeY + 6 * k);
        ctx.quadraticCurveTo(cx, eyeY + 26 * k, cx + W, eyeY + 6 * k);
      }
      ctx.stroke();
      continue;
    }

    // bianco dell'occhio
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx, eyeY, W, H, 0, 0, Math.PI * 2);
    ctx.fill();

    // iride con sfumatura
    const g = ctx.createLinearGradient(0, eyeY - H, 0, eyeY + H);
    g.addColorStop(0, shade(eyeColor, -0.55));
    g.addColorStop(0.55, eyeColor);
    g.addColorStop(1, shade(eyeColor, 0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx + s * -4 * k, eyeY + 6 * k, W * 0.78, H * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(eyeColor, -0.7);
    ctx.beginPath();
    ctx.ellipse(cx + s * -4 * k, eyeY + 4 * k, W * 0.36, H * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // riflessi
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx - 17 * k, eyeY - 22 * k, 16 * k, 20 * k, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 17 * k, eyeY + 32 * k, 7 * k, 8 * k, 0, 0, Math.PI * 2);
    ctx.fill();

    // palpebra superiore + ciglia
    ctx.fillStyle = lash;
    ctx.beginPath();
    const lidY = eyes === 'sleepy' ? eyeY - H * 0.25 : eyeY - H * 0.92;
    ctx.moveTo(cx - W * 1.12, lidY + H * 0.35);
    ctx.quadraticCurveTo(cx, lidY - H * 0.32, cx + W * 1.15, lidY + H * 0.2 + (eyes === 'sharp' ? -10 * k * s : 0));
    ctx.lineTo(cx + W * 1.05, lidY + H * 0.36);
    ctx.quadraticCurveTo(cx, lidY - H * 0.08, cx - W * 1.0, lidY + H * 0.5);
    ctx.closePath();
    ctx.fill();
    if (eyes === 'sleepy') {
      // nasconde la parte alta dell'occhio sotto la palpebra
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.ellipse(cx, lidY - H * 0.6, W * 1.3, H * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // ciglia esterna
    ctx.beginPath();
    ctx.moveTo(cx + s * W * 1.0, lidY + H * 0.25);
    ctx.lineTo(cx + s * W * 1.35, lidY + H * 0.05);
    ctx.lineTo(cx + s * W * 1.05, lidY + H * 0.45);
    ctx.fill();
  }

  // bocca
  ctx.strokeStyle = '#5a2a3a';
  ctx.lineWidth = 7 * k;
  const my = 388 * k;
  ctx.beginPath();
  if (expression === 'happy') {
    ctx.fillStyle = '#7a2a3e';
    ctx.moveTo(236 * k, my - 6 * k);
    ctx.quadraticCurveTo(256 * k, my + 30 * k, 276 * k, my - 6 * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff8aa0';
    ctx.beginPath();
    ctx.ellipse(256 * k, my + 8 * k, 10 * k, 5 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(240 * k, my);
    ctx.quadraticCurveTo(248 * k, my + 8 * k, 256 * k, my + 1 * k);
    ctx.quadraticCurveTo(264 * k, my + 8 * k, 272 * k, my);
    ctx.stroke();
  }
}

export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt < 0) c.multiplyScalar(1 + amt);
  else c.lerp(new THREE.Color(1, 1, 1), amt);
  return '#' + c.getHexString();
}
