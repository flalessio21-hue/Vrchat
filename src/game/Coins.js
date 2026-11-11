import * as THREE from 'three';
import { Items } from './Gear.js';

const RESPAWN = 150; // secondi prima che una moneta ricompaia
const VALUE = 10;

/** Monete sparse per il mondo (posizioni da Blender), disegnate con un'unica InstancedMesh. */
export class Coins {
  constructor(scene, positions) {
    const { geometry, material } = Items.coinGeometry();
    this.positions = positions.map((p) => new THREE.Vector3(...p));
    this.taken = new Float32Array(positions.length); // tempo di ricomparsa (0 = presente)
    this.mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3(1, 1, 1);
    this.zero = new THREE.Vector3(0, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.p = new THREE.Vector3();
  }

  /** @returns {number} monete raccolte in questo frame */
  update(dt, t, player) {
    let got = 0;
    const pp = player.position;
    for (let i = 0; i < this.positions.length; i++) {
      const c = this.positions[i];
      if (this.taken[i] > 0) {
        if (t > this.taken[i]) this.taken[i] = 0;
        else {
          this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
          continue;
        }
      }
      const dx = c.x - pp.x;
      const dz = c.z - pp.z;
      if (dx * dx + dz * dz < 1.6 && Math.abs(c.y - 1.1 - pp.y) < 2.2) {
        this.taken[i] = t + RESPAWN;
        got += VALUE;
        continue;
      }
      this.q.setFromAxisAngle(this.up, t * 2 + i);
      this.p.set(c.x, c.y + Math.sin(t * 2 + i) * 0.12, c.z);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return got;
  }
}
