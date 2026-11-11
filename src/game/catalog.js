// Catalogo dei negozi della piazza. Prezzi in monete (🪙), raccolte esplorando il mondo.
export const CATALOG = [
  // Garage Turbo: veicoli
  { id: 'hoverboard', shop: 'veicoli', type: 'vehicle', name: 'Hoverboard', emoji: '🛹', price: 150,
    desc: 'Tavola fluttuante. Veloce e silenziosa.', speed: 1.7, pose: 'ride_stand', riderY: 0.27, hover: true, color: '#39e6ff' },
  { id: 'scooter', shop: 'veicoli', type: 'vehicle', name: 'Monopattino Neon', emoji: '🛴', price: 300,
    desc: 'Ruote luminose per sfrecciare in città.', speed: 2.0, pose: 'ride_stand', riderY: 0.18, color: '#ff3df2' },
  { id: 'kart', shop: 'veicoli', type: 'vehicle', name: 'Mini Kart', emoji: '🏎️', price: 600,
    desc: 'Il più veloce della piazza.', speed: 2.5, pose: 'ride_sit', riderY: 0.36, color: '#ffb02e' },
  { id: 'cloud', shop: 'veicoli', type: 'vehicle', name: 'Nuvoletta', emoji: '☁️', price: 900,
    desc: 'Una nuvola morbida che ti porta ovunque.', speed: 2.1, pose: 'ride_sit', riderY: 0.5, hover: true, color: '#ffffff' },

  // Amici Pelosi: animali da compagnia
  { id: 'slime', shop: 'animali', type: 'pet', name: 'Gelatina', emoji: '🟢', price: 100, desc: 'Saltella felice dietro di te.', move: 'hop' },
  { id: 'robocat', shop: 'animali', type: 'pet', name: 'Gattobot', emoji: '🐱', price: 250, desc: 'Un gatto robot con gli occhi luminosi.', move: 'walk' },
  { id: 'owl', shop: 'animali', type: 'pet', name: 'Gufetto', emoji: '🦉', price: 350, desc: 'Vola sopra la tua spalla.', move: 'fly' },
  { id: 'dragon', shop: 'animali', type: 'pet', name: 'Draghetto', emoji: '🐉', price: 700, desc: 'Piccolo, viola e coraggioso.', move: 'fly' },

  // Magie & Scie: effetti
  { id: 'aura', shop: 'effetti', type: 'effect', name: 'Aura Neon', emoji: '💫', price: 120, desc: 'Un cerchio di luce ai tuoi piedi.' },
  { id: 'sparkles', shop: 'effetti', type: 'effect', name: 'Scia di Stelle', emoji: '✨', price: 200, desc: 'Lasci stelline mentre corri.' },
  { id: 'hearts', shop: 'effetti', type: 'effect', name: 'Cuoricini', emoji: '💖', price: 260, desc: 'Cuori che salgono intorno a te.' },
  { id: 'snowfx', shop: 'effetti', type: 'effect', name: 'Nuvola di Neve', emoji: '❄️', price: 320, desc: 'Una piccola nevicata tutta tua.' },

  // Gelati Stellari: per divertimento
  { id: 'gelato', shop: 'snack', type: 'snack', name: 'Gelato Stellare', emoji: '🍦', price: 10, desc: 'Gusto lampone e polvere di stelle.' },
  { id: 'bubble', shop: 'snack', type: 'snack', name: 'Bibita Frizzante', emoji: '🥤', price: 8, desc: 'Ti fa venire voglia di ballare.' },
  { id: 'cookie', shop: 'snack', type: 'snack', name: 'Biscotto Pixel', emoji: '🍪', price: 5, desc: 'Croccante, a forma di cuore.' },
];

export const SHOP_INFO = {
  veicoli: { title: 'Garage Turbo', intro: 'Veicoli per esplorare Oasis più in fretta.', displays: ['hoverboard', 'kart'] },
  animali: { title: 'Amici Pelosi', intro: 'Un amico che ti segue ovunque.', displays: ['dragon', 'robocat'] },
  effetti: { title: 'Magie & Scie', intro: 'Effetti speciali per farti notare.', displays: ['cloud', 'slime'] },
  snack: { title: 'Gelati Stellari', intro: 'Qualcosa di buono per una pausa.', displays: [] },
};

export const item = (id) => CATALOG.find((i) => i.id === id);
