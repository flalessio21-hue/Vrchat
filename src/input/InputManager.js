/**
 * Unifica tutti gli input in un unico stato per frame:
 *  - tastiera + mouse (desktop)
 *  - joystick virtuale + trascinamento (Android / iPhone)
 *  - gamepad (controller Bluetooth, anche nel browser del Quest)
 *  - controller Meta Quest in WebXR (thumbstick + pulsanti)
 *
 * Il resto del gioco legge solo `state`, quindi aggiungere nuovi dispositivi
 * non richiede modifiche al controller del personaggio.
 */
export class InputManager {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.keys = new Set();
    this.state = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, zoom: 0, run: false, jump: false, interact: false, snapTurn: 0 };
    this.pending = { lookX: 0, lookY: 0, zoom: 0, jump: false, interact: false, avatar: false, emote: null };
    this.enabled = true;
    this.touch = { id: null, x: 0, y: 0, lookId: null, lx: 0, ly: 0 };
    this.prevXRButtons = {};
    this.snapReady = true;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    this.bindKeyboard();
    this.bindMouse();
    if (this.isTouch) this.bindTouch();
  }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.pending.jump = true;
        e.preventDefault();
      }
      if (e.code === 'KeyE' || e.code === 'Enter') this.pending.interact = true;
      if (e.code === 'KeyC') this.pending.avatar = true;
      const emotes = { Digit1: 'wave', Digit2: 'dance', Digit3: 'cheer', Digit4: 'floor' };
      if (emotes[e.code]) this.pending.emote = emotes[e.code];
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  bindMouse() {
    let dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      dragging = false;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (dragging || document.pointerLockElement === this.canvas) {
        this.pending.lookX += e.movementX;
        this.pending.lookY += e.movementY;
      }
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.pending.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  bindTouch() {
    document.body.classList.add('touch');
    document.getElementById('touch').classList.remove('hidden');
    const stick = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    const R = 52;

    const setKnob = (dx, dy) => (knob.style.transform = `translate(${dx}px, ${dy}px)`);

    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      const rect = stick.getBoundingClientRect();
      this.touch.id = t.identifier;
      this.touch.cx = rect.left + rect.width / 2;
      this.touch.cy = rect.top + rect.height / 2;
      e.preventDefault();
    }, { passive: false });

    const moveStick = (t) => {
      let dx = t.clientX - this.touch.cx;
      let dy = t.clientY - this.touch.cy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      this.touch.x = dx / R;
      this.touch.y = -dy / R;
      setKnob(dx, dy);
    };

    // Trascinamento sulla parte libera dello schermo = ruota la camera
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (this.touch.lookId === null) {
          this.touch.lookId = t.identifier;
          this.touch.lx = t.clientX;
          this.touch.ly = t.clientY;
        }
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) moveStick(t);
        else if (t.identifier === this.touch.lookId) {
          this.pending.lookX += (t.clientX - this.touch.lx) * 1.4;
          this.pending.lookY += (t.clientY - this.touch.ly) * 1.4;
          this.touch.lx = t.clientX;
          this.touch.ly = t.clientY;
        }
      }
    }, { passive: true });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) {
          this.touch.id = null;
          this.touch.x = this.touch.y = 0;
          setKnob(0, 0);
        }
        if (t.identifier === this.touch.lookId) this.touch.lookId = null;
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);

    const tap = (id, key) =>
      document.getElementById(id).addEventListener('touchstart', (e) => {
        this.pending[key] = true;
        e.preventDefault();
      }, { passive: false });
    tap('t-jump', 'jump');
    tap('t-interact', 'interact');
  }

  /** Legge gli input e restituisce lo stato del frame corrente. */
  poll() {
    const s = this.state;
    const k = this.keys;
    const p = this.pending;

    let mx = 0;
    let my = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    let lookX = p.lookX * 0.004;
    let lookY = p.lookY * 0.004;
    let { jump, interact } = p;
    let snapTurn = 0;

    if (this.touch.id !== null) {
      mx += this.touch.x;
      my += this.touch.y;
      run = run || Math.hypot(this.touch.x, this.touch.y) > 0.92;
    }

    // Gamepad classici (non in XR)
    const xr = this.renderer.xr.isPresenting;
    if (!xr && navigator.getGamepads) {
      for (const gp of navigator.getGamepads()) {
        if (!gp || gp.mapping !== 'standard') continue;
        const dz = (v) => (Math.abs(v) > 0.15 ? v : 0);
        mx += dz(gp.axes[0]);
        my -= dz(gp.axes[1]);
        lookX += dz(gp.axes[2]) * 0.05;
        lookY += dz(gp.axes[3]) * 0.05;
        run = run || gp.buttons[10]?.pressed || gp.buttons[6]?.pressed;
        jump = jump || this.edge(`gp${gp.index}a`, gp.buttons[0]?.pressed);
        interact = interact || this.edge(`gp${gp.index}x`, gp.buttons[2]?.pressed);
      }
    }

    // Controller Meta Quest (WebXR)
    if (xr) {
      const session = this.renderer.xr.getSession();
      for (const src of session?.inputSources ?? []) {
        const gp = src.gamepad;
        if (!gp) continue;
        const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0], gp.axes[1]];
        const dz = (v) => (Math.abs(v) > 0.2 ? v : 0);
        if (src.handedness === 'left') {
          mx += dz(ax[0]);
          my -= dz(ax[1]);
          run = run || gp.buttons[3]?.pressed; // click sullo stick
          interact = interact || this.edge('xrX', gp.buttons[4]?.pressed) || this.edge('xrLT', gp.buttons[0]?.pressed);
        } else if (src.handedness === 'right') {
          // Snap turn: comodo e anti-nausea
          const t = ax[0];
          if (Math.abs(t) > 0.7 && this.snapReady) {
            snapTurn = -Math.sign(t);
            this.snapReady = false;
          } else if (Math.abs(t) < 0.3) this.snapReady = true;
          jump = jump || this.edge('xrA', gp.buttons[4]?.pressed);
          interact = interact || this.edge('xrRT', gp.buttons[0]?.pressed);
        }
      }
    }

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    Object.assign(s, { moveX: mx, moveY: my, lookX, lookY, zoom: p.zoom, run, jump, interact, snapTurn });
    s.avatar = p.avatar;
    s.emote = this.enabled ? p.emote : null;
    p.emote = null;
    if (!this.enabled) Object.assign(s, { moveX: 0, moveY: 0, jump: false, interact: false });

    p.lookX = p.lookY = p.zoom = 0;
    p.jump = p.interact = p.avatar = false;
    return s;
  }

  edge(id, pressed) {
    const was = this.prevXRButtons[id];
    this.prevXRButtons[id] = !!pressed;
    return !!pressed && !was;
  }
}
