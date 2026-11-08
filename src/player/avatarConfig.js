// Schema del personaggio: un oggetto JSON semplice, così può essere salvato
// in locale, inviato a un server multiplayer o legato a un account.

export const PALETTES = {
  skin: ['#ffe4d6', '#f7d1bb', '#eab796', '#c98d68', '#9a6445', '#6b412b', '#d9f1ff', '#e9dcff'],
  eyeColor: ['#3aa0ff', '#2fd3b0', '#9b5cff', '#ff5d8f', '#ffb02e', '#7a4a2e', '#e8304a', '#222233'],
  hairColor: ['#2a2230', '#5a3a2a', '#b06a3b', '#f2d27a', '#f4f0ff', '#ff8ac2', '#7fd6ff', '#a98bff', '#ff5a5a', '#7dff9a'],
  topColor: ['#ffffff', '#2a2a35', '#ff8ac2', '#7fd6ff', '#a98bff', '#ffcf5a', '#5ad19a', '#ff6a5a'],
  bottomColor: ['#2a2a35', '#3b4a7a', '#ffffff', '#5a3a2a', '#ff8ac2', '#a98bff', '#4a4a4a', '#1f6a5a'],
  shoesColor: ['#ffffff', '#222228', '#ff5a8a', '#5ab8ff', '#ffcf5a', '#8a5aff'],
  accent: ['#39e6ff', '#ff3df2', '#7dff6a', '#ffb02e', '#ff4d6d', '#ffffff', '#8a7bff', '#00ffb3'],
};

export const OPTIONS = {
  hair: [
    ['short', 'Corti'],
    ['spiky', 'Spettinati'],
    ['bob', 'Caschetto'],
    ['long', 'Lunghi'],
    ['ponytail', 'Coda'],
    ['twintails', 'Codini'],
  ],
  eyes: [
    ['round', 'Grandi'],
    ['sharp', 'Decisi'],
    ['sleepy', 'Rilassati'],
  ],
  top: [
    ['hoodie', 'Felpa'],
    ['jacket', 'Giacca'],
    ['tshirt', 'Maglietta'],
  ],
  bottom: [
    ['pants', 'Pantaloni'],
    ['shorts', 'Shorts'],
    ['skirt', 'Gonna'],
  ],
  accessory: [
    ['none', 'Nessuno'],
    ['catears', 'Orecchie gatto'],
    ['foxears', 'Orecchie volpe'],
    ['halo', 'Aureola'],
    ['headphones', 'Cuffie'],
    ['glasses', 'Occhiali'],
    ['horns', 'Corna'],
  ],
  bodyType: [
    ['slim', 'Snello'],
    ['normal', 'Normale'],
    ['strong', 'Robusto'],
  ],
};

export const DEFAULT_AVATAR = {
  name: 'Viaggiatore',
  skin: PALETTES.skin[1],
  eyeColor: PALETTES.eyeColor[0],
  eyes: 'round',
  hair: 'short',
  hairColor: PALETTES.hairColor[6],
  top: 'hoodie',
  topColor: PALETTES.topColor[4],
  bottom: 'pants',
  bottomColor: PALETTES.bottomColor[1],
  shoesColor: PALETTES.shoesColor[0],
  accent: PALETTES.accent[0],
  accessory: 'headphones',
  bodyType: 'normal',
  height: 1.0,
};

/** Rende valido un config caricato (versioni vecchie, valori sconosciuti). */
export function sanitizeAvatar(cfg) {
  const out = { ...DEFAULT_AVATAR };
  for (const key of Object.keys(DEFAULT_AVATAR)) {
    const v = cfg?.[key];
    if (v === undefined) continue;
    if (OPTIONS[key] && !OPTIONS[key].some(([id]) => id === v)) continue;
    if (key === 'height' && (typeof v !== 'number' || v < 0.85 || v > 1.15)) continue;
    if (typeof v !== typeof DEFAULT_AVATAR[key]) continue;
    out[key] = v;
  }
  out.name = String(out.name).slice(0, 16) || DEFAULT_AVATAR.name;
  return out;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function randomAvatar(name) {
  const cfg = { name, height: Math.round((0.92 + Math.random() * 0.16) * 100) / 100 };
  for (const [k, list] of Object.entries(PALETTES)) cfg[k] = pick(list);
  for (const [k, list] of Object.entries(OPTIONS)) cfg[k] = pick(list)[0];
  return sanitizeAvatar(cfg);
}
