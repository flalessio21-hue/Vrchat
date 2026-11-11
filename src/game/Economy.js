import { load, save } from '../core/storage.js';
import { item } from './catalog.js';

const START = { coins: 200, owned: [], vehicle: null, pet: null, effect: null };

/**
 * Monete e oggetti posseduti, salvati in locale. In futuro questo stato potrà
 * stare su un server (account) senza cambiare il resto del gioco.
 */
export class Economy {
  constructor() {
    this.state = { ...START, ...load('economy', START) };
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  commit() {
    save('economy', this.state);
    for (const fn of this.listeners) fn(this.state);
  }

  get coins() {
    return this.state.coins;
  }

  owns(id) {
    return this.state.owned.includes(id);
  }

  add(n) {
    this.state.coins += n;
    this.commit();
  }

  /** @returns {'ok'|'poor'|'owned'} */
  buy(id) {
    const it = item(id);
    if (!it) return 'poor';
    if (it.type !== 'snack' && this.owns(id)) return 'owned';
    if (this.state.coins < it.price) return 'poor';
    this.state.coins -= it.price;
    if (it.type !== 'snack') this.state.owned.push(id);
    this.commit();
    return 'ok';
  }

  /** Equipaggia (o toglie, se già in uso) un veicolo, un animale o un effetto. */
  toggleEquip(id) {
    const it = item(id);
    if (!it || !this.owns(id)) return;
    this.state[it.type] = this.state[it.type] === id ? null : id;
    this.commit();
  }

  equipped(type) {
    return this.state[type];
  }
}
