import { CATALOG, SHOP_INFO, item } from '../game/catalog.js';
import { thumbnail } from './thumbnails.js';

const TYPES = [
  { id: 'all', label: 'Tutto', icon: '◆' },
  { id: 'vehicle', label: 'Veicoli', icon: '🛹' },
  { id: 'pet', label: 'Animali', icon: '🐾' },
  { id: 'effect', label: 'Effetti', icon: '✨' },
];
const SLOT_LABEL = { vehicle: 'Veicolo', pet: 'Animale', effect: 'Effetto' };
const TYPE_LABEL = { vehicle: 'Veicolo', pet: 'Animale da compagnia', effect: 'Effetto', snack: 'Snack' };
const SHOP_OF = { veicoli: 'Garage Turbo', animali: 'Amici Pelosi', effetti: 'Magie & Scie', snack: 'Gelati Stellari' };

export function rarity(it) {
  if (it.type === 'snack' || it.price < 150) return { id: 'common', label: 'Comune' };
  if (it.price < 400) return { id: 'rare', label: 'Raro' };
  if (it.price < 750) return { id: 'epic', label: 'Epico' };
  return { id: 'legendary', label: 'Leggendario' };
}

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/**
 * Inventario (zaino) e negozi: stessa finestra.
 *  - open('inventory'): collezione completa, gli oggetti non posseduti sono bloccati
 *  - open(<id negozio>): oggetti in vendita in quel negozio
 */
export class ShopUI {
  constructor(economy, { onEquip, onSnack, onClose }) {
    this.eco = economy;
    this.onEquip = onEquip;
    this.onSnack = onSnack;
    this.onClose = onClose;
    this.el = document.getElementById('shop');
    this.kicker = document.getElementById('inv-kicker');
    this.title = document.getElementById('shop-title');
    this.intro = document.getElementById('inv-intro');
    this.grid = document.getElementById('shop-list');
    this.balance = document.getElementById('shop-coins');
    this.msg = document.getElementById('shop-msg');
    this.tabs = document.getElementById('inv-tabs');
    this.slots = document.getElementById('inv-slots');
    this.detail = document.getElementById('inv-detail');
    this.current = null;
    this.filter = 'all';
    this.selected = null;
    document.getElementById('shop-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') this.close();
    });
    economy.onChange(() => this.isOpen && this.render());
  }

  get isOpen() {
    return !this.el.classList.contains('hidden');
  }

  get inventory() {
    return this.current === 'inventory';
  }

  open(shop) {
    this.current = shop;
    this.filter = 'all';
    this.selected = null;
    this.msg.textContent = '';
    this.el.classList.toggle('inv-mode', this.inventory);
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.add('hidden');
    this.onClose?.();
  }

  items() {
    if (!this.inventory) return CATALOG.filter((i) => i.shop === this.current);
    const all = CATALOG.filter((i) => i.type !== 'snack');
    // posseduti prima, poi in ordine di prezzo
    return all.sort((a, b) => (this.eco.owns(b.id) - this.eco.owns(a.id)) || a.price - b.price);
  }

  render() {
    const inv = this.inventory;
    const info = inv ? null : SHOP_INFO[this.current];
    const ownedCount = CATALOG.filter((i) => i.type !== 'snack' && this.eco.owns(i.id)).length;
    const total = CATALOG.filter((i) => i.type !== 'snack').length;
    this.kicker.textContent = inv ? 'Zaino' : 'Negozio';
    this.title.textContent = inv ? 'Inventario' : info.title;
    this.intro.textContent = inv ? `${ownedCount} di ${total} oggetti nella collezione` : info.intro;
    this.balance.textContent = this.eco.coins.toLocaleString('it-IT');
    this.renderSlots();
    this.renderTabs();

    let list = this.items();
    if (inv && this.filter !== 'all') list = list.filter((i) => i.type === this.filter);
    if (!this.selected || !list.some((i) => i.id === this.selected)) this.selected = list[0]?.id ?? null;

    this.grid.textContent = '';
    for (const it of list) this.grid.appendChild(this.card(it));
    if (!list.length) this.grid.appendChild(el('p', 'inv-empty', 'Nessun oggetto in questa categoria.'));
    this.renderDetail(this.selected ? item(this.selected) : null);
  }

  renderSlots() {
    this.slots.textContent = '';
    for (const type of ['vehicle', 'pet', 'effect']) {
      const id = this.eco.equipped(type);
      const it = id ? item(id) : null;
      const slot = el('button', 'inv-slot' + (it ? ' filled' : ''));
      slot.type = 'button';
      slot.innerHTML = `<span class="inv-slot-img">${it ? `<img alt="" src="${thumbnail(it)}">` : '<span class="inv-slot-empty">+</span>'}</span>
        <span class="inv-slot-text"><small>${SLOT_LABEL[type]}</small><b>${it ? it.name : 'Vuoto'}</b></span>`;
      slot.onclick = () => {
        if (!this.inventory) this.current = 'inventory';
        this.el.classList.add('inv-mode');
        this.filter = type;
        this.selected = id;
        this.render();
      };
      this.slots.appendChild(slot);
    }
  }

  renderTabs() {
    this.tabs.textContent = '';
    if (!this.inventory) return;
    for (const t of TYPES) {
      const n = CATALOG.filter((i) => i.type !== 'snack' && (t.id === 'all' || i.type === t.id) && this.eco.owns(i.id)).length;
      const b = el('button', 'inv-tab' + (this.filter === t.id ? ' active' : ''), `<span>${t.icon}</span>${t.label}<em>${n}</em>`);
      b.type = 'button';
      b.onclick = () => {
        this.filter = t.id;
        this.selected = null;
        this.render();
      };
      this.tabs.appendChild(b);
    }
  }

  state(it) {
    if (it.type === 'snack') return 'buy';
    if (this.eco.equipped(it.type) === it.id) return 'equipped';
    if (this.eco.owns(it.id)) return 'owned';
    return this.inventory ? 'locked' : 'buy';
  }

  card(it) {
    const r = rarity(it);
    const st = this.state(it);
    const c = el('button', `inv-card r-${r.id} s-${st}` + (it.id === this.selected ? ' selected' : ''));
    c.type = 'button';
    const badge = {
      equipped: '<span class="inv-badge eq">In uso</span>',
      owned: '<span class="inv-badge own">Posseduto</span>',
      locked: '<span class="inv-badge lock">🔒</span>',
      buy: `<span class="inv-badge price">🪙 ${it.price}</span>`,
    }[st];
    c.innerHTML = `<span class="inv-card-img"><img alt="" src="${thumbnail(it)}"></span>
      <span class="inv-card-name">${it.name}</span>
      <span class="inv-card-meta"><i class="inv-rar">${r.label}</i>${badge}</span>`;
    c.onclick = () => {
      this.selected = it.id;
      this.msg.textContent = '';
      this.render();
    };
    return c;
  }

  renderDetail(it) {
    this.detail.textContent = '';
    if (!it) {
      this.detail.appendChild(el('p', 'inv-empty', 'Seleziona un oggetto.'));
      return;
    }
    const r = rarity(it);
    const st = this.state(it);
    const stats = [['Tipo', TYPE_LABEL[it.type]]];
    if (it.type === 'vehicle') stats.push(['Velocità', `×${it.speed.toFixed(1)}`], ['Guida', it.pose === 'ride_sit' ? 'Seduto' : 'In piedi']);
    if (it.type === 'pet') stats.push(['Movimento', { hop: 'Saltella', walk: 'Cammina', fly: 'Vola' }[it.move]]);
    if (st === 'locked') stats.push(['Dove si compra', SHOP_OF[it.shop]]);
    stats.push(['Prezzo', `🪙 ${it.price}`]);
    const d = el('div', `inv-detail-inner r-${r.id}`);
    d.innerHTML = `<div class="inv-detail-img"><img alt="" src="${thumbnail(it)}"></div>
      <span class="inv-rar-chip">${r.label}</span>
      <h3>${it.name}</h3>
      <p class="inv-desc">${it.desc}</p>
      <dl class="inv-stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    const btn = el('button', 'inv-action');
    btn.type = 'button';
    if (st === 'equipped') {
      btn.textContent = 'Togli';
      btn.classList.add('secondary');
      btn.onclick = () => this.equip(it);
    } else if (st === 'owned') {
      btn.textContent = it.type === 'vehicle' ? 'Usa veicolo' : 'Usa';
      btn.onclick = () => this.equip(it);
    } else if (st === 'locked') {
      btn.textContent = `In vendita da ${SHOP_OF[it.shop]}`;
      btn.disabled = true;
    } else {
      const poor = this.eco.coins < it.price;
      btn.innerHTML = poor ? `Ti mancano 🪙 ${it.price - this.eco.coins}` : `Compra · 🪙 ${it.price}`;
      btn.disabled = poor;
      btn.onclick = () => this.buy(it.id);
    }
    d.appendChild(btn);
    this.detail.appendChild(d);
  }

  equip(it) {
    this.eco.toggleEquip(it.id);
    this.onEquip?.(it.type, this.eco.equipped(it.type));
  }

  buy(id) {
    const it = item(id);
    const res = this.eco.buy(id);
    if (res === 'poor') {
      this.msg.textContent = `Ti servono altre ${it.price - this.eco.coins} monete: esplora nuovi quartieri per guadagnarle.`;
      return;
    }
    if (it.type === 'snack') {
      this.onSnack?.(it);
      this.msg.textContent = `${it.emoji} ${it.name}: buonissimo!`;
      return;
    }
    this.eco.toggleEquip(id); // appena comprato: lo usiamo subito
    this.onEquip?.(it.type, this.eco.equipped(it.type));
    this.msg.textContent = `${it.name} aggiunto al tuo inventario.`;
  }
}
