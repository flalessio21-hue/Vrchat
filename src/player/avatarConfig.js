// Schema del personaggio: è un oggetto JSON semplice così può essere salvato
// in locale, inviato a un server multiplayer o sincronizzato con un account.

export const PALETTES = {
  skin: ['#f6d7c3', '#eac09f', '#d39a72', '#a86f4c', '#7a4a2e', '#4a2c1c', '#9fe8ff', '#c9a7ff'],
  suit: ['#1b1f3b', '#2a2a2a', '#f2f2f2', '#2d6cdf', '#b3123e', '#1f7a4a', '#5b2a86', '#e0a100'],
  accent: ['#39e6ff', '#ff3df2', '#7dff6a', '#ffb02e', '#ff4d4d', '#ffffff', '#8a7bff', '#00ffb3'],
  visor: ['#39e6ff', '#ff3df2', '#ffb02e', '#7dff6a', '#111111', '#ffffff'],
  hairColor: ['#111111', '#4a2c1c', '#a0522d', '#e8c26b', '#f2f2f2', '#ff3df2', '#39e6ff', '#7dff6a'],
};

export const OPTIONS = {
  hair: [
    ['none', 'Nessuno'],
    ['spiky', 'Spettinati'],
    ['mohawk', 'Cresta'],
    ['bob', 'Caschetto'],
    ['long', 'Lunghi'],
  ],
  accessory: [
    ['none', 'Nessuno'],
    ['halo', 'Aureola'],
    ['antenna', 'Antenna'],
    ['horns', 'Corna'],
    ['headphones', 'Cuffie'],
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
  suit: PALETTES.suit[0],
  accent: PALETTES.accent[0],
  visor: PALETTES.visor[0],
  hair: 'spiky',
  hairColor: PALETTES.hairColor[0],
  accessory: 'none',
  bodyType: 'normal',
  height: 1.0,
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function randomAvatar(name) {
  return {
    name,
    skin: pick(PALETTES.skin),
    suit: pick(PALETTES.suit),
    accent: pick(PALETTES.accent),
    visor: pick(PALETTES.visor),
    hair: pick(OPTIONS.hair)[0],
    hairColor: pick(PALETTES.hairColor),
    accessory: pick(OPTIONS.accessory)[0],
    bodyType: pick(OPTIONS.bodyType)[0],
    height: Math.round((0.9 + Math.random() * 0.2) * 100) / 100,
  };
}
