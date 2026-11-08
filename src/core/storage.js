// Piccolo wrapper sicuro su localStorage (può non essere disponibile in
// navigazione privata o dentro alcune WebView). In futuro qui si potrà
// collegare un backend/account utente senza toccare il resto del codice.
const PREFIX = 'oasis:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignorato */
  }
}
