import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/** Correzione colore "cinematografica": ombre fredde, luci calde, contrasto e vignetta. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} ',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, c * vec3(0.86, 0.95, 1.12), (1.0 - smoothstep(0.0, 0.5, l)) * 0.6);
      c = mix(c, c * vec3(1.08, 1.0, 0.9), smoothstep(0.5, 1.0, l) * 0.4);
      c = (c - 0.5) * 1.08 + 0.5;
      c = mix(vec3(l), c, 1.12);
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.9;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

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
    this.renderer.toneMappingExposure = 1.05;
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
    // occlusione ambientale in tempo reale (solo computer): ombre di contatto negli angoli e sotto gli oggetti
    if (!isMobile) {
      this.ao = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.ao.blendIntensity = 0.85;
      this.composer.addPass(this.ao);
    }
    const res = new THREE.Vector2(window.innerWidth, window.innerHeight).multiplyScalar(isMobile ? 0.5 : 1);
    this.bloom = new UnrealBloomPass(res, 0.85, 0.55, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));

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
