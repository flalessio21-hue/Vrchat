import { load, save } from '../core/storage.js';
import { item } from './catalog.js';

const START = { coins: 300, owned: [], vehicle: null, pet: null, effect: null, discovered: [], lastDaily: '' };
export const DISCOVERY_REWARD = 120;
export const DAILY_REWARD = 150;

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

  /** Prima visita di un quartiere: ricompensa. @returns {boolean} */
  discover(zone) {
    if (!zone || this.state.discovered.includes(zone)) return false;
    this.state.discovered.push(zone);
    this.state.coins += DISCOVERY_REWARD;
    this.commit();
    return true;
  }

  /** Bonus una volta al giorno. @returns {boolean} */
  claimDaily() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.lastDaily === today) return false;
    this.state.lastDaily = today;
    this.state.coins += DAILY_REWARD;
    this.commit();
    return true;
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
