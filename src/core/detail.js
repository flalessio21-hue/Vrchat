import * as THREE from 'three';

/**
 * Materiali realistici per i modelli Blender (che non hanno coordinate UV).
 *
 * Ogni superficie usa un set di texture generato da tools/textures/generate.py:
 *   <set>_c.jpg colore di dettaglio (moltiplicatore centrato sul grigio: le palette
 *               dei modelli restano quelle, la texture aggiunge la materia)
 *   <set>_n.jpg normali (rilievo reale: fughe, venature, graffi, rivetti, cortecce...)
 *   <set>_r.jpg ruvidità (zone lucide e opache)
 * Le texture sono proiettate in "triplanare" (dall'alto, di lato e di fronte) con
 * normal mapping "whiteout", in coordinate mondo; per gli avatar in coordinate del
 * modello a riposo, così il tessuto non "scivola" mentre si muovono.
 */

const isMobile = matchMedia('(pointer: coarse)').matches;
const loader = new THREE.TextureLoader();
const sets = new Map();

function load(name, srgb) {
  const t = loader.load(`textures/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = isMobile ? 4 : 8;
  if (srgb) t.colorSpace = THREE.NoColorSpace; // moltiplicatore lineare, non un colore da convertire
  return t;
}

function textureSet(name) {
  if (!sets.has(name)) sets.set(name, { c: load(`${name}_c`, true), n: load(`${name}_n`), r: load(`${name}_r`) });
  return sets.get(name);
}

/**
 * @param {THREE.MeshStandardMaterial} mat
 * @param {string} set nome del set di texture
 * @param {object} o scale = ripetizioni per metro; normal, albedo, rough = intensità; local = coordinate del modello
 */
export function applyDetail(mat, set, o = {}) {
  if (!mat || mat.userData.detail || !mat.isMeshStandardMaterial) return;
  const opt = { scale: 0.5, normal: 1, albedo: 1, rough: 1, roughBase: null, local: false, ...o };
  mat.userData.detail = set;
  const tex = textureSet(set);
  if (opt.roughBase !== null) mat.roughness = opt.roughBase;
  const uniforms = {
    uDC: { value: tex.c },
    uDN: { value: tex.n },
    uDR: { value: tex.r },
    uDScale: { value: opt.scale },
    uDNormal: { value: opt.normal },
    uDAlbedo: { value: opt.albedo },
    uDRough: { value: opt.rough },
  };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const space = opt.local
      ? `vDPos = position; vDNrm = normalize(normal); vDM0 = normalMatrix[0]; vDM1 = normalMatrix[1]; vDM2 = normalMatrix[2];`
      : `mat4 dModel = modelMatrix;
         #ifdef USE_INSTANCING
           dModel = modelMatrix * instanceMatrix;
         #endif
         vDPos = (dModel * vec4(transformed, 1.0)).xyz;
         vDNrm = normalize(mat3(dModel) * objectNormal);`;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `varying vec3 vDPos;\nvarying vec3 vDNrm;\n${opt.local ? 'varying vec3 vDM0, vDM1, vDM2;' : ''}\nvoid main() {`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${space}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vDPos;
         varying vec3 vDNrm;
         ${opt.local ? 'varying vec3 vDM0, vDM1, vDM2;' : ''}
         uniform sampler2D uDC, uDN, uDR;
         uniform float uDScale, uDNormal, uDAlbedo, uDRough;
         vec3 tri3(sampler2D t, vec2 a, vec2 b, vec2 c, vec3 w) {
           return texture2D(t, a).rgb * w.x + texture2D(t, b).rgb * w.y + texture2D(t, c).rgb * w.z;
         }
         void main() {
           vec3 dN = normalize(vDNrm);
           vec3 dW = pow(abs(dN), vec3(6.0));
           dW /= (dW.x + dW.y + dW.z);
           vec3 dP = vDPos * uDScale;
           vec2 uvX = dP.zy, uvY = dP.xz, uvZ = dP.xy;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 dAlb = tri3(uDC, uvX, uvY, uvZ, dW) * 2.0;
         diffuseColor.rgb *= mix(vec3(1.0), dAlb, uDAlbedo);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         float dRgh = tri3(uDR, uvX, uvY, uvZ, dW).r;
         roughnessFactor = clamp(mix(roughnessFactor, dRgh, uDRough), 0.04, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         {
           // normal mapping triplanare (fusione "whiteout")
           vec3 tX = texture2D(uDN, uvX).xyz * 2.0 - 1.0;
           vec3 tY = texture2D(uDN, uvY).xyz * 2.0 - 1.0;
           vec3 tZ = texture2D(uDN, uvZ).xyz * 2.0 - 1.0;
           tX.xy *= uDNormal; tY.xy *= uDNormal; tZ.xy *= uDNormal;
           tX = vec3(tX.xy + dN.zy, abs(tX.z) * dN.x);
           tY = vec3(tY.xy + dN.xz, abs(tY.z) * dN.y);
           tZ = vec3(tZ.xy + dN.xy, abs(tZ.z) * dN.z);
           vec3 nW = normalize(tX.zyx * dW.x + tY.xzy * dW.y + tZ.xyz * dW.z);
           ${opt.local
             ? 'mat3 dNM = mat3(vDM0, vDM1, vDM2); vec3 base = normalize(dNM * dN); vec3 nV = normalize(dNM * nW);'
             : 'vec3 base = normalize((viewMatrix * vec4(dN, 0.0)).xyz); vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);'}
           normal = normalize(normal + (nV - base));
         }`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|tex-${set}-${opt.local ? 'l' : 'w'}`;
  mat.needsUpdate = true;
}

/** Set di texture per nome di materiale (materiali esportati da Blender). */
export const DETAIL_BY_MATERIAL = {
  LobbyFloor: ['stone_polished', { scale: 0.42, normal: 0.8, albedo: 1, rough: 0.55 }],
  Tiles: ['stone_polished', { scale: 0.42, normal: 0.8 }],
  Sidewalk: ['concrete', { scale: 0.35, normal: 1 }],
  Path: ['concrete', { scale: 0.5 }],
  Hull: ['metal_panels', { scale: 0.18, normal: 1, rough: 0.8 }],
  HullDark: ['metal_panels', { scale: 0.18, normal: 1, rough: 0.8 }],
  Building: ['metal_panels', { scale: 0.12, normal: 0.8 }],
  Metal: ['metal_panels', { scale: 0.5, normal: 0.5, rough: 0.6 }],
  Rock: ['rock', { scale: 0.12, normal: 1.6, rough: 0.9 }],
  Cliff: ['rock', { scale: 0.08, normal: 1.6 }],
  Terrain: ['ground', { scale: 0.32, normal: 1.2, albedo: 0.8, rough: 0.8 }],
  Grass: ['ground', { scale: 0.32, normal: 1.0 }],
  CastleStone: ['stone_blocks', { scale: 0.32, normal: 1.4 }],
  Stone: ['concrete', { scale: 0.45, normal: 0.8 }],
  StoneDark: ['concrete', { scale: 0.45, normal: 0.8 }],
  Plaster: ['plaster', { scale: 0.5, normal: 1 }],
  Wood: ['wood', { scale: 0.55, normal: 1 }],
  WoodDark: ['wood', { scale: 0.55, normal: 1 }],
  Timber: ['wood', { scale: 0.55, normal: 1 }],
  Bark: ['bark', { scale: 1.6, normal: 1.6 }],
  LeavesGreen: ['foliage', { scale: 1.1, normal: 1.4, albedo: 0.9 }],
  LeavesPink: ['foliage', { scale: 1.1, normal: 1.4, albedo: 0.9 }],
  LeavesPine: ['foliage', { scale: 1.4, normal: 1.4, albedo: 0.9 }],
  LeavesAutumn: ['foliage', { scale: 1.1, normal: 1.4, albedo: 0.9 }],
  Bush: ['foliage', { scale: 1.3, normal: 1.4, albedo: 0.9 }],
  Foliage: ['foliage', { scale: 1.5, normal: 1.2 }],
  Snow: ['plaster', { scale: 0.4, normal: 0.6, rough: 0.5 }],
  RoofRed: ['wood', { scale: 1.4, normal: 0.8, albedo: 0.6 }],
  RoofBlue: ['metal_panels', { scale: 0.4, normal: 0.6 }],
  RoofJade: ['wood', { scale: 1.4, normal: 0.8, albedo: 0.6 }],
};
