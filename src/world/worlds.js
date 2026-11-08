// Mondi raggiungibili dai portali dell'hub. Per ora sono segnaposto:
// quando un mondo sarà pronto basterà impostare `ready: true` e
// collegare un loader (vedi WorldManager in main.js).
export const WORLDS = [
  { id: 'arena', name: 'Arena', desc: 'Sfide e combattimenti PvP', color: '#ff4d4d', ready: false },
  { id: 'music', name: 'Pianeta Musica', desc: 'Concerti e club virtuali', color: '#ff3df2', ready: false },
  { id: 'racing', name: 'Circuito Neon', desc: 'Corse su veicoli futuristici', color: '#ffb02e', ready: false },
  { id: 'school', name: 'Accademia', desc: 'Lezioni e laboratori', color: '#7dff6a', ready: false },
  { id: 'quest', name: 'Rovine Perdute', desc: 'Esplorazione e cacce al tesoro', color: '#8a7bff', ready: false },
  { id: 'market', name: 'Mercato', desc: 'Negozi di skin e oggetti', color: '#39e6ff', ready: false },
];
