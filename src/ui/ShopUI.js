import { CATALOG, SHOP_INFO, item } from '../game/catalog.js';

/**
 * Finestra dei negozi e dello zaino (oggetti posseduti).
 * shop: id del negozio, oppure 'inventory' per lo zaino.
 */
export class ShopUI {
  constructor(economy, { onEquip, onSnack, onClose }) {
    this.eco = economy;
    this.onEquip = onEquip;
    this.onSnack = onSnack;
    this.onClose = onClose;
    this.el = document.getElementById('shop');
    this.title = document.getElementById('shop-title');
    this.intro = document.getElementById('shop-intro');
    this.list = document.getElementById('shop-list');
    this.balance = document.getElementById('shop-coins');
    this.msg = document.getElementById('shop-msg');
    this.current = null;
    document.getElementById('shop-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    economy.onChange(() => this.isOpen && this.render());
  }

  get isOpen() {
    return !this.el.classList.contains('hidden');
  }

  open(shop) {
    this.current = shop;
    this.msg.textContent = '';
    this.render();
    this.el.classList.remove('hidden');
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.add('hidden');
    this.onClose?.();
  }

  render() {
    const inv = this.current === 'inventory';
    const info = inv ? { title: 'Il tuo zaino', intro: 'Tocca un oggetto per usarlo o toglierlo.' } : SHOP_INFO[this.current];
    this.title.textContent = info.title;
    this.intro.textContent = info.intro;
    this.balance.textContent = `🪙 ${this.eco.coins}`;
    const items = inv ? CATALOG.filter((i) => this.eco.owns(i.id)) : CATALOG.filter((i) => i.shop === this.current);
    this.list.textContent = '';
    if (inv && !items.length) {
      const p = document.createElement('p');
      p.className = 'shop-empty';
      p.textContent = 'Non hai ancora niente. Raccogli monete 🪙 in giro per il mondo e visita i negozi della piazza!';
      this.list.appendChild(p);
    }
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'shop-item';
      const owned = this.eco.owns(it.id);
      const inUse = this.eco.equipped(it.type) === it.id;
      card.innerHTML = `<div class="shop-emoji">${it.emoji}</div>
        <div class="shop-text"><b>${it.name}</b><span>${it.desc}</span></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn small' + (inUse ? ' primary' : '');
      if (it.type === 'snack') {
        btn.textContent = `🪙 ${it.price}`;
        btn.onclick = () => this.buy(it.id);
      } else if (owned) {
        btn.textContent = inUse ? 'In uso ✓' : 'Usa';
        btn.onclick = () => {
          this.eco.toggleEquip(it.id);
          this.onEquip?.(it.type, this.eco.equipped(it.type));
        };
      } else {
        btn.textContent = `🪙 ${it.price}`;
        btn.disabled = this.eco.coins < it.price;
        btn.onclick = () => this.buy(it.id);
      }
      card.appendChild(btn);
      this.list.appendChild(card);
    }
  }

  buy(id) {
    const it = item(id);
    const res = this.eco.buy(id);
    if (res === 'poor') {
      this.msg.textContent = `Ti servono altre ${it.price - this.eco.coins} monete. Cercale in giro per Oasis!`;
      return;
    }
    if (it.type === 'snack') {
      this.onSnack?.(it);
      this.msg.textContent = `${it.emoji} ${it.name}: buonissimo!`;
      return;
    }
    // appena comprato: lo usiamo subito
    this.eco.toggleEquip(id);
    this.onEquip?.(it.type, this.eco.equipped(it.type));
    this.msg.textContent = `${it.emoji} ${it.name} è tuo!`;
  }
}
