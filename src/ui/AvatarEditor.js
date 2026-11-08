import { PALETTES, OPTIONS, randomAvatar } from '../player/avatarConfig.js';

// Sezioni dell'editor: ogni voce è [chiave, etichetta, tipo]
const TABS = {
  Corpo: [
    ['bodyType', 'Corporatura', 'option'],
    ['height', 'Altezza', 'range'],
    ['skin', 'Pelle', 'color'],
  ],
  Viso: [
    ['eyes', 'Occhi', 'option'],
    ['eyeColor', 'Colore occhi', 'color'],
  ],
  Capelli: [
    ['hair', 'Taglio', 'option'],
    ['hairColor', 'Colore', 'color'],
  ],
  Vestiti: [
    ['top', 'Sopra', 'option'],
    ['topColor', 'Colore sopra', 'color'],
    ['bottom', 'Sotto', 'option'],
    ['bottomColor', 'Colore sotto', 'color'],
    ['shoesColor', 'Scarpe', 'color'],
  ],
  Extra: [
    ['accessory', 'Accessorio', 'option'],
    ['accent', 'Luci neon', 'color'],
  ],
};

/** Pannello HTML per personalizzare l'avatar in tempo reale. */
export class AvatarEditor {
  constructor({ getConfig, onChange, onOpen, onClose }) {
    this.getConfig = getConfig;
    this.onChange = onChange;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.el = document.getElementById('editor');
    this.fields = document.getElementById('ed-fields');
    this.tabsEl = document.getElementById('ed-tabs');
    this.nameInput = document.getElementById('ed-name');
    this.tab = 'Corpo';
    this.isOpen = false;

    this.nameInput.addEventListener('input', () => this.update('name', this.nameInput.value.trim() || 'Viaggiatore'));
    document.getElementById('ed-random').addEventListener('click', () => {
      this.onChange(randomAvatar(this.getConfig().name));
      this.render();
    });
    document.getElementById('ed-done').addEventListener('click', () => this.close());
    // i tasti premuti nell'editor non devono muovere il personaggio
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  update(key, value, rerender = false) {
    this.onChange({ ...this.getConfig(), [key]: value });
    if (rerender) this.render();
  }

  render() {
    const c = this.getConfig();
    if (document.activeElement !== this.nameInput) this.nameInput.value = c.name;

    this.tabsEl.innerHTML = '';
    for (const name of Object.keys(TABS)) {
      const b = document.createElement('button');
      b.className = 'tab' + (name === this.tab ? ' active' : '');
      b.textContent = name;
      b.onclick = () => {
        this.tab = name;
        this.render();
      };
      this.tabsEl.appendChild(b);
    }

    this.fields.innerHTML = '';
    for (const [key, label, type] of TABS[this.tab]) {
      const field = document.createElement('div');
      field.className = 'field';
      const title = document.createElement('div');
      title.textContent = label;
      field.appendChild(title);
      this.fields.appendChild(field);

      if (type === 'option') {
        const row = document.createElement('div');
        row.className = 'options';
        for (const [value, text] of OPTIONS[key]) {
          const b = document.createElement('button');
          b.className = 'opt' + (c[key] === value ? ' active' : '');
          b.textContent = text;
          b.onclick = () => this.update(key, value, true);
          row.appendChild(b);
        }
        field.appendChild(row);
      } else if (type === 'color') {
        const row = document.createElement('div');
        row.className = 'swatches';
        for (const color of PALETTES[key]) {
          const b = document.createElement('button');
          b.className = 'swatch' + (c[key].toLowerCase() === color ? ' active' : '');
          b.style.background = color;
          b.title = color;
          b.onclick = () => this.update(key, color, true);
          row.appendChild(b);
        }
        const custom = document.createElement('input');
        custom.type = 'color';
        custom.value = c[key];
        custom.className = 'swatch';
        custom.title = 'Colore personalizzato';
        custom.oninput = () => this.update(key, custom.value);
        custom.onchange = () => this.render();
        row.appendChild(custom);
        field.appendChild(row);
      } else if (type === 'range') {
        title.textContent = `${label} · ${Math.round(c.height * 165)} cm`;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = '0.85';
        range.max = '1.15';
        range.step = '0.01';
        range.value = String(c.height);
        range.oninput = () => {
          this.update('height', Number(range.value));
          title.textContent = `${label} · ${Math.round(Number(range.value) * 165)} cm`;
        };
        field.appendChild(range);
      }
    }
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
