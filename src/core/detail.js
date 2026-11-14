import * as THREE from 'three';

/**
 * Dettaglio di superficie procedurale per i materiali PBR.
 *
 * I modelli creati in Blender non hanno coordinate UV, quindi il dettaglio viene
 * proiettato in "triplanare" (dall'alto, di lato e di fronte, in coordinate mondo).
 * Ogni texture è generata in memoria (nessun file da scaricare) e ha tre canali:
 *   R = rilievo fine (rugosità, grana, venature)
 *   G = variazione ampia (macchie, pozzanghere, usura)
 *   B = solchi (fughe, giunture, crepe)
 * Lo shader li usa per perturbare le normali, variare la ruvidità e il colore.
 */

const isMobile = matchMedia('(pointer: coarse)').matches;
const SIZE = 256;

// ------------------------------------------------------------- rumore tileabile
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Rumore a valori ripetibile ai bordi (la texture si ripete senza giunture). */
function valueNoise(size, cells, seed) {
  const r = makeRng(seed);
  const grid = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const g = (i, j) => grid[((j % cells) * cells) + (i % cells)];
      const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
      const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

function fbm(size, base, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTexture(R, G, B) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 4] = Math.max(0, Math.min(255, R[i] * 255));
    data[i * 4 + 1] = Math.max(0, Math.min(255, G[i] * 255));
    data[i * 4 + 2] = Math.max(0, Math.min(255, B[i] * 255));
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const ones = () => new Float32Array(SIZE * SIZE).fill(1);

// ------------------------------------------------------------- generatori
const GEN = {
  // pietra lucida con venature, pozzanghere e crepe sottili
  tiles(seed) {
    const R = fbm(SIZE, 8, 5, seed);
    const vein = fbm(SIZE, 3, 4, seed + 7);
    for (let i = 0; i < R.length; i++) R[i] = R[i] * 0.7 + Math.pow(1 - Math.abs(vein[i] - 0.5) * 2, 8) * 0.3;
    const G = fbm(SIZE, 2, 4, seed + 13);
    const B = ones();
    const r = makeRng(seed + 3);
    for (let c = 0; c < 6; c++) { // crepe: passeggiate casuali
      let x = r() * SIZE;
      let y = r() * SIZE;
      let a = r() * Math.PI * 2;
      for (let s = 0; s < 120; s++) {
        a += (r() - 0.5) * 0.6;
        x = (x + Math.cos(a) * 1.5 + SIZE) % SIZE;
        y = (y + Math.sin(a) * 1.5 + SIZE) % SIZE;
        B[(y | 0) * SIZE + (x | 0)] = 0.25;
      }
    }
    return toTexture(R, G, B);
  },
  // metallo a pannelli: spazzolatura, giunture e rivetti
  panel(seed) {
    const streak = valueNoise(SIZE, 64, seed);
    const R = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) R[y * SIZE + x] = streak[(y % 4) * SIZE + x] * 0.4 + 0.3;
    const G = fbm(SIZE, 2, 3, seed + 5);
    const B = ones();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const px = x % 128;
        const py = y % 64;
        let v = 1;
        if (px < 2 || py < 2) v = 0.2;
        const rx = (px - 8) ** 2 + (py - 8) ** 2;
        const rx2 = (px - 120) ** 2 + (py - 8) ** 2;
        if (rx < 5 || rx2 < 5) v = 0.55;
        B[y * SIZE + x] = v;
      }
    }
    return toTexture(R, G, B);
  },
  // roccia: rilievo marcato e stratificato
  rock(seed) {
    const R = fbm(SIZE, 4, 6, seed);
    for (let i = 0; i < R.length; i++) R[i] = 1 - Math.abs(R[i] - 0.5) * 2;
    const G = fbm(SIZE, 2, 3, seed + 9);
    const B = fbm(SIZE, 16, 2, seed + 11).map((v) => (v < 0.3 ? 0.4 : 1));
    return toTexture(R, G, B);
  },
  // terreno: grana fine e chiazze
  ground(seed) {
    return toTexture(fbm(SIZE, 16, 4, seed), fbm(SIZE, 2, 4, seed + 4), fbm(SIZE, 8, 2, seed + 8).map((v) => 0.6 + v * 0.4));
  },
  // pietra a blocchi
  stone(seed) {
    const R = fbm(SIZE, 16, 4, seed);
    const G = fbm(SIZE, 4, 3, seed + 2);
    const B = ones();
    for (let y = 0; y < SIZE; y++) {
      const row = Math.floor(y / 32);
      for (let x = 0; x < SIZE; x++) {
        const xo = (x + (row % 2) * 32) % 64;
        if (y % 32 < 2 || xo < 2) B[y * SIZE + x] = 0.15;
      }
    }
    return toTexture(R, G, B);
  },
  // venature del legno
  wood(seed) {
    const n = fbm(SIZE, 4, 3, seed);
    const R = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) R[y * SIZE + x] = 0.5 + 0.5 * Math.sin(y * 0.35 + n[y * SIZE + x] * 9);
    return toTexture(R, fbm(SIZE, 2, 3, seed + 3), ones());
  },
  // trama del tessuto (tute, vestiti)
  fabric(seed) {
    const R = new Float32Array(SIZE * SIZE);
    const n = fbm(SIZE, 8, 3, seed);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      R[y * SIZE + x] = 0.5 + 0.25 * Math.sin(x * 1.6) * Math.sin(y * 1.6) + (n[y * SIZE + x] - 0.5) * 0.4;
    }
    return toTexture(R, fbm(SIZE, 2, 3, seed + 5), ones());
  },
};

const cache = {};
function texture(kind) {
  if (!cache[kind]) cache[kind] = GEN[kind](kind.length * 977);
  return cache[kind];
}

// ------------------------------------------------------------- iniezione nello shader
/**
 * @param {THREE.MeshStandardMaterial} mat
 * @param {string} kind tipo di superficie (tiles, panel, rock, ground, stone, wood, fabric)
 * @param {object} o scale = ripetizioni per metro; bump, rough, albedo, wet, groove = intensità
 */
export function applyDetail(mat, kind, o = {}) {
  if (!mat || mat.userData.detail || !mat.isMeshStandardMaterial) return;
  const opt = { scale: 0.5, bump: 0.6, rough: 0.25, albedo: 0.18, wet: 0, groove: 0.5, ...o };
  mat.userData.detail = kind;
  const uniforms = {
    uDetail: { value: texture(kind) },
    uDScale: { value: opt.scale },
    uDBump: { value: isMobile ? 0 : opt.bump },
    uDRough: { value: opt.rough },
    uDAlbedo: { value: opt.albedo },
    uDWet: { value: opt.wet },
    uDGroove: { value: opt.groove },
  };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vDWorldPos;\nvarying vec3 vDWorldNormal;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         mat4 dModel = modelMatrix;
         #ifdef USE_INSTANCING
           dModel = modelMatrix * instanceMatrix;
         #endif
         vDWorldPos = (dModel * vec4(transformed, 1.0)).xyz;
         vDWorldNormal = normalize(mat3(dModel) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vDWorldPos;
         varying vec3 vDWorldNormal;
         uniform sampler2D uDetail;
         uniform float uDScale, uDBump, uDRough, uDAlbedo, uDWet, uDGroove;
         vec3 dW;
         vec4 triDetail(vec3 p) {
           vec3 q = p * uDScale;
           return texture2D(uDetail, q.zy) * dW.x + texture2D(uDetail, q.xz) * dW.y + texture2D(uDetail, q.xy) * dW.z;
         }
         void main() {
           vec3 dN = normalize(vDWorldNormal);
           dW = pow(abs(dN), vec3(4.0));
           dW /= (dW.x + dW.y + dW.z);
           vec4 dT = triDetail(vDWorldPos);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor.rgb *= mix(1.0 - uDAlbedo, 1.0 + uDAlbedo * 0.6, dT.r) * mix(1.0 - uDAlbedo * 0.8, 1.0, dT.g);
         diffuseColor.rgb *= mix(1.0, dT.b, uDGroove);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = clamp(roughnessFactor * mix(1.0 - uDRough, 1.0 + uDRough, dT.r), 0.04, 1.0);
         // pozzanghere: zone lisce e lucide
         float dWet = smoothstep(0.55, 0.7, dT.g) * uDWet * dW.y;
         roughnessFactor = mix(roughnessFactor, 0.2, dWet);
         diffuseColor.rgb *= 1.0 - dWet * 0.35;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         if (uDBump > 0.0) {
           float e = 0.6 / (uDScale * 256.0);
           float h0 = dot(dT.rb, vec2(0.6, 0.4));
           vec3 grad = vec3(
             dot(triDetail(vDWorldPos + vec3(e, 0.0, 0.0)).rb, vec2(0.6, 0.4)) - h0,
             dot(triDetail(vDWorldPos + vec3(0.0, e, 0.0)).rb, vec2(0.6, 0.4)) - h0,
             dot(triDetail(vDWorldPos + vec3(0.0, 0.0, e)).rb, vec2(0.6, 0.4)) - h0) / e;
           grad -= dot(grad, dN) * dN;
           vec3 nW = normalize(dN - grad * uDBump * 0.02);
           vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
           normal = normalize(normal + (nV - normalize((viewMatrix * vec4(dN, 0.0)).xyz)));
         }`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|detail-${kind}`;
  mat.needsUpdate = true;
}

/** Tipo di dettaglio per nome di materiale (materiali esportati da Blender). */
export const DETAIL_BY_MATERIAL = {
  LobbyFloor: ['tiles', { scale: 0.35, bump: 0.7, rough: 0.35, albedo: 0.22, wet: 1, groove: 0.6 }],
  Sidewalk: ['tiles', { scale: 0.4, bump: 0.5, wet: 0.6 }],
  Hull: ['panel', { scale: 0.22, bump: 0.5, rough: 0.3, albedo: 0.12, groove: 0.55 }],
  HullDark: ['panel', { scale: 0.22, bump: 0.5, rough: 0.3, albedo: 0.15, groove: 0.6 }],
  Building: ['panel', { scale: 0.15, bump: 0.4, groove: 0.5 }],
  Metal: ['panel', { scale: 0.6, bump: 0.3, groove: 0.2 }],
  Rock: ['rock', { scale: 0.18, bump: 1.4, rough: 0.2, albedo: 0.35, groove: 0.4 }],
  Terrain: ['ground', { scale: 0.25, bump: 0.8, rough: 0.15, albedo: 0.25, groove: 0.3 }],
  CastleStone: ['stone', { scale: 0.45, bump: 1.0, albedo: 0.25, groove: 0.6 }],
  Stone: ['stone', { scale: 0.5, bump: 0.6, albedo: 0.15, groove: 0.35 }],
  StoneDark: ['stone', { scale: 0.5, bump: 0.6, albedo: 0.15, groove: 0.4 }],
  Plaster: ['ground', { scale: 0.6, bump: 0.4, albedo: 0.12, groove: 0.1 }],
  Wood: ['wood', { scale: 1.2, bump: 0.6, albedo: 0.22, groove: 0.1 }],
  WoodDark: ['wood', { scale: 1.2, bump: 0.6, albedo: 0.22, groove: 0.1 }],
  Bark: ['wood', { scale: 2.0, bump: 1.0, albedo: 0.3, groove: 0.2 }],
  Timber: ['wood', { scale: 1.2, bump: 0.6, albedo: 0.2, groove: 0.1 }],
  Path: ['tiles', { scale: 0.6, bump: 0.5 }],
};
