# Oasis — Hub

Prototipo di un metaverso ispirato al concetto di "Oasis": per ora **web**, pensato per diventare
un'app per **Meta Quest** (WebXR), **Android** e **iPhone** senza riscrivere il gioco.

Al momento contiene:
- **Hub sociale in stile social VR**: isola fluttuante al tramonto sopra un mare di nuvole,
  piazza con fontana e cristallo luminoso, 6 portali ad arco con anteprima animata e pannello
  informativo (Arena, Pianeta Musica, Circuito Neon, Accademia, Rovine Perdute, Mercato),
  **specchio** funzionante, panchine su cui **sedersi**, alberi di ciliegio, lanterne, lucciole,
  bacheca di benvenuto, percorso di rocce fluttuanti con un cristallo da trovare.
- **Avatar stile anime** (originale, procedurale): shading toon con contorno, viso disegnato con
  battito di ciglia ed espressioni, capelli a ciocche con movimento secondario, vestiti e accessori.
  Personalizzabili: corporatura, altezza, pelle, occhi, 6 tagli di capelli, felpa/giacca/maglietta,
  pantaloni/shorts/gonna, scarpe, orecchie da gatto/volpe con coda, aureola, cuffie, occhiali, corna,
  luci neon. Salvato in locale.
- **Animazioni ed emote**: idle, camminata, corsa, salto; saluto, ballo, esulta, seduto a terra.
- **Grafica**: bloom, ombre, luce calda del tramonto (post-processing disattivato in VR per le prestazioni).

## Avvio

```bash
npm install
npm run dev      # http://localhost:5173 (anche dalla rete locale, per provarlo sul telefono)
npm run build    # build statica in dist/
```

## Controlli

| Dispositivo | Movimento | Camera | Salto | Interagisci | Personaggio |
|---|---|---|---|---|---|
| PC | WASD / frecce, Shift corri | trascina col mouse, rotella zoom | Spazio | E | C · emote 1-4 |
| Telefono/tablet | joystick a sinistra (spingi tutto per correre) | trascina sullo schermo | ⤒ | E | pulsante in alto |
| Gamepad | stick sinistro | stick destro | A | X | — |
| Meta Quest (VR) | stick sinistro | guardati intorno, stick destro = rotazione a scatti | A | trigger / X | — |

## Struttura

```
src/
  core/Engine.js          renderer, scena, loop compatibile WebXR, ingresso in VR
  core/toon.js            materiali toon, contorni, texture generate
  core/storage.js         salvataggio locale (da sostituire con account/server)
  world/Hub.js            l'hub: geometrie, collisioni, piattaforme, portali
  world/worlds.js         elenco dei mondi collegati ai portali
  player/Avatar.js        avatar anime: scheletro, vestiti, capelli, animazioni, emote
  player/avatarParts.js   geometrie (arti, ciocche) e disegno del viso
  player/avatarConfig.js  schema JSON del personaggio + palette
  player/PlayerController.js  movimento, fisica, camera 3a persona / rig VR
  input/InputManager.js   tastiera, mouse, touch, gamepad, controller Quest
  ui/                     HUD, editor del personaggio, stile
```

## Verso le app

- **Meta Quest**: già pronto via WebXR — apri il sito nel browser del Quest e premi **VR**
  (serve HTTPS). In seguito si può pubblicare come PWA o impacchettare con Bubblewrap/PWABuilder.
- **Android / iPhone**: il build usa percorsi relativi (`base: './'`), quindi si può impacchettare
  con [Capacitor](https://capacitorjs.com): `npx cap init`, `npx cap add android|ios`, `npx cap sync`.

## Prossimi passi possibili

- Multiplayer (WebSocket/WebRTC) usando lo schema JSON dell'avatar
- Primo mondo giocabile dietro un portale (`ready: true` in `worlds.js`)
- Avatar glTF/VRM al posto di quello procedurale, mani in VR
- Chat testuale/vocale, account e inventario
