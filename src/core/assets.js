import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Caricamento dei modelli creati con Blender (tools/blender/*.py) e
 * compressi con meshopt. I percorsi sono relativi alla pagina, così
 * funzionano sul web e dentro un'app (Capacitor / PWA sul Quest).
 */
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map();

export function loadGLTF(url, onProgress) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url, onProgress));
  return cache.get(url);
}

export async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossibile caricare ${url}`);
  return res.json();
}
