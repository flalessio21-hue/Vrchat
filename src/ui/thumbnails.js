import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Items } from '../game/Gear.js';

/**
 * Anteprime degli oggetti per l'inventario e i negozi.
 * Veicoli e animali vengono renderizzati dai modelli 3D (Blender) con luci da
 * studio; effetti e snack hanno un'icona disegnata.
 */
const SIZE = 320;
const cache = new Map();
let renderer = null;
let scene = null;
let camera = null;

function setup() {
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 2);
  const rim = new THREE.DirectionalLight(0x7fd8ff, 1.6);
  rim.position.set(-3, 1.5, -2);
  scene.add(key, rim);
  camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
}

function renderModel(id, color) {
  if (!renderer) setup();
  const obj = Items.model(id, color);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.62;
  const dir = new THREE.Vector3(0.9, 0.55, -1.2).normalize(); // vista di tre quarti dal davanti
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.95;
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(obj);
  return url;
}

function renderIcon(emoji, hue) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 10, SIZE / 2, SIZE / 2, SIZE / 2);
  g.addColorStop(0, `hsla(${hue}, 90%, 70%, 0.55)`);
  g.addColorStop(1, `hsla(${hue}, 90%, 50%, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.font = `${SIZE * 0.5}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = `hsla(${hue}, 90%, 60%, 0.9)`;
  ctx.shadowBlur = 30;
  ctx.fillText(emoji, SIZE / 2, SIZE / 2 + 8);
  return c.toDataURL('image/png');
}

/** URL dell'anteprima (calcolata una volta e poi riusata). */
export function thumbnail(it) {
  if (cache.has(it.id)) return cache.get(it.id);
  let url;
  try {
    url = it.type === 'vehicle' || it.type === 'pet' ? renderModel(it.id, it.color) : renderIcon(it.emoji, it.type === 'effect' ? 280 : 20);
  } catch {
    url = renderIcon(it.emoji, 200);
  }
  cache.set(it.id, url);
  return url;
}
