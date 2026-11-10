import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const isMobile = matchMedia('(pointer: coarse)').matches;

/**
 * Renderer, scena, camera, post-processing e loop.
 * - Schermo (web/mobile): bloom tramite EffectComposer.
 * - VR (Meta Quest): rendering diretto, senza post-processing (costa troppo
 *   in stereo su un visore standalone).
 * Usa renderer.setAnimationLoop, obbligatorio per WebXR.
 */
export class Engine {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 3000);

    // In VR la camera è guidata dal visore: la mettiamo in un "rig" che
    // spostiamo noi per la locomozione.
    this.rig = new THREE.Group();
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    // render target con MSAA: il post-processing non perde l'antialiasing
    const rt = new THREE.WebGLRenderTarget(window.innerWidth * this.pixelRatio, window.innerHeight * this.pixelRatio, {
      type: THREE.HalfFloatType,
      samples: isMobile ? 2 : 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const res = new THREE.Vector2(window.innerWidth, window.innerHeight).multiplyScalar(isMobile ? 0.5 : 1);
    this.bloom = new UnrealBloomPass(res, 0.45, 0.45, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.clock = new THREE.Clock();
    this.updaters = [];
    window.addEventListener('resize', () => this.resize());
  }

  get isXR() {
    return this.renderer.xr.isPresenting;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  onUpdate(fn) {
    this.updaters.push(fn);
  }

  start() {
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      for (const fn of this.updaters) fn(dt, t);
      if (this.isXR) this.renderer.render(this.scene, this.camera);
      else this.composer.render(dt);
    });
  }

  /** Avvia una sessione immersive-vr (Meta Quest e altri visori WebXR). */
  async enterVR() {
    if (!navigator.xr) return false;
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
    return true;
  }

  static async isVRSupported() {
    try {
      return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'));
    } catch {
      return false;
    }
  }
}
