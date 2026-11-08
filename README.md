# Oasis — Hub

Prototipo di un metaverso ispirato al concetto di "Oasis": per ora **web**, pensato per diventare
un'app per **Meta Quest** (WebXR), **Android** e **iPhone** senza riscrivere il gioco.

Al momento contiene:
- **Hub centrale**: piazza circolare con torre olografica, 6 portali verso mondi futuri
  (Arena, Pianeta Musica, Circuito Neon, Accademia, Rovine Perdute, Mercato), percorso di
  piattaforme da scalare con un cristallo da trovare, cielo stellato, minimappa.
- **Personaggio**: avatar procedurale personalizzabile (nome, capelli, corporatura, accessorio,
  colori di pelle/tuta/neon/visore, altezza) con animazioni di camminata, corsa e salto.
  Salvato in locale.

## Avvio

```bash
npm install
npm run dev      # http://localhost:5173 (anche dalla rete locale, per provarlo sul telefono)
npm run build    # build statica in dist/
```

## Controlli

| Dispositivo | Movimento | Camera | Salto | Interagisci | Personaggio |
|---|---|---|---|---|---|
| PC | WASD / frecce, Shift corri | trascina col mouse, rotella zoom | Spazio | E | C |
| Telefono/tablet | joystick a sinistra (spingi tutto per correre) | trascina sullo schermo | ⤒ | E | pulsante in alto |
| Gamepad | stick sinistro | stick destro | A | X | — |
| Meta Quest (VR) | stick sinistro | guardati intorno, stick destro = rotazione a scatti | A | trigger / X | — |

## Struttura

```
src/
  core/Engine.js          renderer, scena, loop compatibile WebXR, ingresso in VR
  core/storage.js         salvataggio locale (da sostituire con account/server)
  world/Hub.js            l'hub: geometrie, collisioni, piattaforme, portali
  world/worlds.js         elenco dei mondi collegati ai portali
  player/Avatar.js        modello e animazioni del personaggio
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
