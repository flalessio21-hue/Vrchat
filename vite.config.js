import { defineConfig } from 'vite';

// base relativo: il build funziona sia su web hosting sia dentro un wrapper
// nativo (Capacitor per Android/iOS, o come PWA installata sul Quest).
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
