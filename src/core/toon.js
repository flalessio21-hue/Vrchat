import * as THREE from 'three';

/**
 * Stile "anime / social VR": materiali toon a bande + contorno a guscio
 * invertito (inverted hull). Economico: funziona anche su Quest e telefoni.
 */
let gradient3;
let gradient4;

function makeGradient(steps) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function toonGradient(soft = false) {
  if (!gradient3) gradient3 = makeGradient([90, 190, 255]);
  if (!gradient4) gradient4 = makeGradient([135, 210, 255]); // bande nette e ombre chiare: stile cartone
  return soft ? gradient4 : gradient3;
}

export function toonMat(color, { soft, flatShading, ...opts } = {}) {
  // MeshToonMaterial non supporta flatShading: per le rocce sfaccettate
  // usiamo una Lambert sfaccettata, che con la luce del tramonto si sposa bene.
  if (flatShading) return new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(soft), ...opts });
}

const outlineCache = new Map();

/** Materiale per il contorno: spinge i vertici lungo la normale e disegna il retro. */
export function outlineMaterial(width = 0.012, color = 0x1a1028) {
  const key = `${width}:${color}`;
  if (outlineCache.has(key)) return outlineCache.get(key);
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n transformed += normalize(normal) * ${width.toFixed(4)};`,
    );
  };
  mat.customProgramCacheKey = () => key;
  outlineCache.set(key, mat);
  return mat;
}

/** Aggiunge il contorno a tutte le mesh (non trasparenti) dentro un oggetto. */
export function addOutlines(root, width, color) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline && !o.userData.isOutline && !o.material.transparent) meshes.push(o);
  });
  for (const m of meshes) {
    const o = new THREE.Mesh(m.geometry, outlineMaterial(m.userData.outlineWidth ?? width, color));
    o.userData.isOutline = true;
    o.castShadow = false;
    o.raycast = () => {};
    m.add(o);
  }
}

/** Texture generata su canvas (niente file esterni). */
export function canvasTexture(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  return tex;
}

/** Piccolo PRNG deterministico per decorazioni riproducibili. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
