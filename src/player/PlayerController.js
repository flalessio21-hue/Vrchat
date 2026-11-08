import * as THREE from 'three';

const WALK = 4.2;
const RUN = 8.5;
const JUMP = 8.2;
const GRAVITY = 24;
const BODY_R = 0.35;
const SNAP_ANGLE = THREE.MathUtils.degToRad(30);

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/**
 * Muove il personaggio nell'hub.
 * - Modalità schermo (web/mobile): terza persona con camera orbitale.
 * - Modalità VR (Quest): prima persona, il rig della camera segue il giocatore,
 *   movimento relativo allo sguardo + snap turn.
 */
export class PlayerController {
  constructor(engine, avatar, world) {
    this.engine = engine;
    this.avatar = avatar;
    this.world = world;

    this.position = world.spawn.clone();
    this.velocity = new THREE.Vector3();
    this.grounded = true;
    this.facing = Math.PI; // guarda verso la torre

    this.yaw = 0;
    this.pitch = 0.22;
    this.distance = 5;
    this.camTarget = new THREE.Vector3();
    this.preview = false; // inquadratura frontale per l'editor
    this.xrYaw = 0;
    this.wasXR = false;

    avatar.root.position.copy(this.position);
    engine.scene.add(avatar.root);
  }

  update(dt, input) {
    const xr = this.engine.isXR;
    if (xr !== this.wasXR) this.onModeChange(xr);

    // --- direzione di movimento
    let fx;
    let fz;
    if (xr) {
      this.engine.camera.getWorldDirection(tmpV);
      tmpV.y = 0;
      tmpV.normalize();
      fx = tmpV.x;
      fz = tmpV.z;
      if (input.snapTurn) this.xrYaw += input.snapTurn * SNAP_ANGLE;
    } else {
      this.yaw -= input.lookX;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY, -0.15, 1.25);
      this.distance = THREE.MathUtils.clamp(this.distance + input.zoom * 0.8, 2.5, 16);
      fx = -Math.sin(this.yaw);
      fz = -Math.cos(this.yaw);
    }
    const rx = -fz;
    const rz = fx;

    // --- seduto su una panchina: ci si alza muovendosi o saltando
    if (this.seat) {
      if (Math.hypot(input.moveX, input.moveY) > 0.2 || input.jump) this.standUp();
      else {
        this.avatar.root.position.copy(this.position);
        this.avatar.root.rotation.y = this.facing;
        this.avatar.animate(dt, 0, true, this.engine.clock.elapsedTime);
        if (xr) this.updateXRRig();
        else this.updateCamera(dt);
        return;
      }
    }

    const speed = input.run ? RUN : WALK;
    const wantX = (fx * input.moveY + rx * input.moveX) * speed;
    const wantZ = (fz * input.moveY + rz * input.moveX) * speed;
    const accel = this.grounded ? 14 : 4;
    const k = Math.min(accel * dt, 1);
    this.velocity.x += (wantX - this.velocity.x) * k;
    this.velocity.z += (wantZ - this.velocity.z) * k;

    // --- salto e gravità
    if (input.jump && this.grounded) {
      this.velocity.y = JUMP;
      this.grounded = false;
    }
    this.velocity.y -= GRAVITY * dt;

    const p = this.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    this.resolveCollisions();

    p.y += this.velocity.y * dt;
    const ground = this.world.groundAt(p.x, p.z, p.y);
    if (p.y <= ground) {
      p.y = ground;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else if (p.y - ground > 0.05) {
      this.grounded = false;
    }

    // --- orientamento e animazione avatar
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (hSpeed > 0.3 && !this.preview) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(dt * 12, 1);
    }
    this.avatar.root.position.copy(p);
    this.avatar.root.rotation.y = this.facing;
    this.avatar.animate(dt, hSpeed, this.grounded, this.engine.clock.elapsedTime);

    if (xr) this.updateXRRig();
    else this.updateCamera(dt);
  }

  resolveCollisions() {
    const p = this.position;
    const push = (cx, cz, r) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const min = r + BODY_R;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * min;
        p.z = cz + (dz / d) * min;
      }
    };
    for (const c of this.world.colliders) push(c.x, c.z, c.r);
    // le piattaforme troppo alte si comportano come muri
    for (const pl of this.world.platforms) if (pl.top > p.y + 0.45) push(pl.x, pl.z, pl.r);

    const r = Math.hypot(p.x, p.z);
    const max = this.world.bounds;
    if (r > max) {
      p.x *= max / r;
      p.z *= max / r;
    }
  }

  updateCamera(dt) {
    const cam = this.engine.camera;
    const p = this.position;
    const h = 1.45 * this.avatar.config.height;

    if (this.preview) {
      // inquadratura frontale, personaggio spostato a sinistra per lasciare spazio al pannello
      const wide = window.innerWidth > 600;
      const a = this.facing;
      const desired = tmpV.set(p.x + Math.sin(a) * 3.4, p.y + 1.25, p.z + Math.cos(a) * 3.4);
      if (wide) desired.addScaledVector(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), 1.1);
      cam.position.lerp(desired, Math.min(dt * 6, 1));
      const look = new THREE.Vector3(p.x, p.y + (wide ? 1.0 : 0.55), p.z);
      if (wide) look.addScaledVector(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), 1.1);
      this.camTarget.lerp(look, Math.min(dt * 6, 1));
      cam.lookAt(this.camTarget);
      return;
    }

    this.camTarget.lerp(tmpV.set(p.x, p.y + h, p.z), Math.min(dt * 12, 1));
    const cp = Math.cos(this.pitch);
    const offset = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // la camera non attraversa la torre centrale
    let dist = this.distance;
    const t = this.camTarget;
    for (let s = 0.5; s <= this.distance; s += 0.5) {
      const x = t.x + offset.x * s;
      const z = t.z + offset.z * s;
      if (x * x + z * z < 2.6 * 2.6 && t.y + offset.y * s < 23) {
        dist = Math.max(1.2, s - 0.5);
        break;
      }
    }
    cam.position.copy(t).addScaledVector(offset, dist);
    cam.position.y = Math.max(cam.position.y, 0.3);
    cam.lookAt(t);
  }

  sit(seat) {
    this.seat = seat;
    this.position.copy(seat.position);
    this.velocity.set(0, 0, 0);
    this.facing = seat.facing;
    this.avatar.playEmote('sit');
  }

  standUp() {
    const s = this.seat;
    this.seat = null;
    this.avatar.stopEmote();
    this.position.x += Math.sin(s.facing) * 0.55;
    this.position.z += Math.cos(s.facing) * 0.55;
  }

  emote(id) {
    if (this.seat || !this.grounded) return;
    if (this.avatar.emote === id) this.avatar.stopEmote();
    else this.avatar.playEmote(id);
  }

  updateXRRig() {
    const rig = this.engine.rig;
    rig.position.copy(this.position);
    rig.rotation.set(0, this.xrYaw, 0);
  }

  onModeChange(xr) {
    this.wasXR = xr;
    const rig = this.engine.rig;
    const cam = this.engine.camera;
    if (xr) {
      // la camera diventa quella del visore: azzera la posa locale
      cam.position.set(0, 0, 0);
      cam.quaternion.identity();
      this.xrYaw = this.facing + Math.PI;
      this.avatar.root.visible = false;
    } else {
      rig.position.set(0, 0, 0);
      rig.quaternion.copy(tmpQ.identity());
      this.avatar.root.visible = true;
      this.yaw = this.facing + Math.PI;
    }
  }

  /** Teletrasporta (es. rientro da un mondo, respawn). */
  teleport(pos, facing = this.facing) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.facing = facing;
    this.yaw = facing + Math.PI;
  }
}
