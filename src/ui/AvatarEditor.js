import { PALETTES, OPTIONS, randomAvatar } from '../player/avatarConfig.js';

const COLOR_FIELDS = [
  ['skin', 'Pelle'],
  ['suit', 'Tuta'],
  ['accent', 'Luci neon'],
  ['visor', 'Visore'],
  ['hairColor', 'Colore capelli'],
];
const OPTION_FIELDS = [
  ['hair', 'Capelli'],
  ['bodyType', 'Corporatura'],
  ['accessory', 'Accessorio'],
];

/** Pannello HTML per personalizzare il personaggio in tempo reale. */
export class AvatarEditor {
  constructor({ getConfig, onChange, onOpen, onClose }) {
    this.getConfig = getConfig;
    this.onChange = onChange;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.el = document.getElementById('editor');
    this.fields = document.getElementById('ed-fields');
    this.nameInput = document.getElementById('ed-name');
    this.isOpen = false;

    this.nameInput.addEventListener('input', () => this.set('name', this.nameInput.value.trim() || 'Viaggiatore'));
    document.getElementById('ed-random').addEventListener('click', () => {
      this.onChange(randomAvatar(this.getConfig().name));
      this.render();
    });
    document.getElementById('ed-done').addEventListener('click', () => this.close());
  }

  set(key, value) {
    this.onChange({ ...this.getConfig(), [key]: value });
    this.render();
  }

  render() {
    const c = this.getConfig();
    if (document.activeElement !== this.nameInput) this.nameInput.value = c.name;
    this.fields.innerHTML = '';

    for (const [key, label] of OPTION_FIELDS) {
      const field = this.field(label);
      const row = document.createElement('div');
      row.className = 'options';
      for (const [value, text] of OPTIONS[key]) {
        const b = document.createElement('button');
        b.className = 'opt' + (c[key] === value ? ' active' : '');
        b.textContent = text;
        b.onclick = () => this.set(key, value);
        row.appendChild(b);
      }
      field.appendChild(row);
    }

    for (const [key, label] of COLOR_FIELDS) {
      const field = this.field(label);
      const row = document.createElement('div');
      row.className = 'swatches';
      for (const color of PALETTES[key]) {
        const b = document.createElement('button');
        b.className = 'swatch' + (c[key].toLowerCase() === color ? ' active' : '');
        b.style.background = color;
        b.title = color;
        b.onclick = () => this.set(key, color);
        row.appendChild(b);
      }
      // colore libero
      const custom = document.createElement('input');
      custom.type = 'color';
      custom.value = c[key];
      custom.className = 'swatch';
      custom.oninput = () => this.onChange({ ...this.getConfig(), [key]: custom.value });
      custom.onchange = () => this.render();
      row.appendChild(custom);
      field.appendChild(row);
    }

    const hField = this.field(`Altezza · ${Math.round(c.height * 180)} cm`);
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0.85';
    range.max = '1.15';
    range.step = '0.01';
    range.value = String(c.height);
    range.oninput = () => {
      this.onChange({ ...this.getConfig(), height: Number(range.value) });
      hField.firstChild.textContent = `Altezza · ${Math.round(Number(range.value) * 180)} cm`;
    };
    hField.appendChild(range);
  }

  field(label) {
    const f = document.createElement('div');
    f.className = 'field';
    f.appendChild(document.createTextNode(label));
    this.fields.appendChild(f);
    return f;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.render();
    this.el.classList.remove('hidden');
    this.onOpen?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.nameInput.blur();
    this.onClose?.();
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }
}
