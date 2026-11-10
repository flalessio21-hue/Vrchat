import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Caricamento dei modelli creati con Blender (tools/blender/*.py) e
 * compressi con meshopt. I percorsi sono relativi alla pagina, così
 * funzionano sul web e dentro un'app (Capacitor / PWA sul Quest).
 *
 * Accetta sia .glb sia .gltf.json (glTF testuale con i dati in base64):
 * quest'ultimo serve dove i file binari non possono essere serviti. I dati
 * vengono decodificati qui, senza URL "data:" che alcune pagine bloccano.
 */
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map();

export function loadGLTF(url, onProgress) {
  if (!cache.has(url)) cache.set(url, fetchModel(url, onProgress));
  return cache.get(url);
}

async function fetchModel(url, onProgress) {
  const buf = await fetchWithProgress(url, onProgress);
  let data = buf;
  if (url.endsWith('.json')) data = packGLB(JSON.parse(new TextDecoder().decode(buf)));
  return loader.parseAsync(data, '');
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossibile caricare ${url} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ lengthComputable: true, loaded, total });
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

/** glTF con buffer base64 -> GLB in memoria. */
function packGLB(json) {
  const uri = json.buffers[0].uri;
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  delete json.buffers[0].uri;
  json.buffers[0].byteLength = bin.length;
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(enc.length / 4) * 4;
  const binLen = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  u8.set(enc, 20);
  u8.fill(0x20, 20 + enc.length, 20 + jsonLen);
  dv.setUint32(20 + jsonLen, binLen, true);
  dv.setUint32(24 + jsonLen, 0x004e4942, true); // BIN
  u8.set(bin, 28 + jsonLen);
  return out;
}

export async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossibile caricare ${url}`);
  return res.json();
}
