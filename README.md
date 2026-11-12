# Oasis — Hub

Prototipo di un metaverso ispirato al concetto di "Oasis": per ora **web**, pensato per diventare
un'app per **Meta Quest** (WebXR), **Android** e **iPhone** senza riscrivere il gioco.

Al momento contiene:
- **Un'isola grande da esplorare** (circa 600 m di diametro) con terreno vero, colline, lago e scogliere
  sul mare di nuvole, divisa in quartieri:
  - **Piazza Centrale (atrio futuristico)**: sei archi metallici con luci al neon che salgono a un anello sospeso,
    logo olografico, maxischermi animati ESPLORA / GIOCA / CREA / SOCIAL (interattivi), pavimento lucido con
    riflessi e strisce di luce, piante tropicali con sfere luminose, cascata da una roccia sospesa,
    fontana con cristallo, 6 portali, specchio, panchine
  - **Quartiere Neon**: grattacieli illuminati, insegne, lampioni al neon, piazza con schermo olografico
  - **Lago Cristallo**: spiaggia, pontile con panchine, barche, palme, ombrelloni e lettini
  - **Foresta Sussurrante**: centinaia di alberi, sentiero, accampamento con falò, capanna e tenda
  - **Collina del Vento**: tempio panoramico con campana e cannocchiale
  - **Palco delle Stelle**: palco per concerti con luci, casse e file di sedute
  - **Prato dell'Albero Antico**: albero gigante in mezzo ai fiori
  - **Borgo Medievale**: castello con torri e mastio, case a graticcio, taverna, pozzo, mulino a vento, campo di grano
  - **Città d'Oriente**: porta monumentale, pagoda a cinque piani, case dai tetti curvi, laghetto con ponte ad arco, lanterne rosse, bambù, sala da tè
  - **Valle Innevata**: montagne, neve che cade, baita, igloo, pupazzi di neve, laghetto ghiacciato su cui si scivola
- **Piazza viva**: passanti che camminano, salutano e ballano, 4 negozi con commessi e merce in vetrina,
  fioriere, stendardi, mongolfiere nel cielo.
- **Negozi e monete**: raccogli le monete 🪙 sparse per il mondo e compra veicoli (hoverboard, monopattino,
  kart, nuvoletta), animali che ti seguono (gelatina, gattobot, gufetto, draghetto), effetti (aura, scia di stelle,
  cuoricini, neve) e snack. Zaino (B) per usare ciò che possiedi, V per salire/scendere dal veicolo.
- **Teletrasporti** (piattaforme luminose o pulsante Mappa / tasto M) e minimappa a radar;
  il nome del quartiere compare quando ci entri.
- **Avatar stile cartone** creato in Blender (testa grande, occhi grandi, gambe corte, ombre a bande e contorno spesso): dita, polpacci, spalle modellati; capelli a strati
  (7 tagli), felpa con cappuccio e zip, giacca con risvolti, maglietta, tuta cyber con guanti, tuta spaziale con zaino luminoso e casco,
  pantaloni, cargo, shorts, gonna, sneakers o stivali, 10 accessori (orecchie, aureola, cuffie,
  occhiali, corna, ali, visore, corona, zaino). Viso con espressioni, riflesso anime sui capelli.
- **Animazioni ed emote**: idle, camminata, corsa, salto; saluto, ballo, esulta, seduto.

## Modelli 3D creati con Blender

Tutta la grafica 3D è generata **da zero con script Blender** (nessun asset scaricato):

| Script | Output | Contenuto |
|---|---|---|
| `tools/blender/avatar.py` | `public/models/avatar.glb` | avatar con scheletro (armatura), corpo modellato con Skin + Subdivision, capelli a ciocche da curve, 6 tagli, 3 sopra, 3 sotto, 6 accessori, scarpe; 9 animazioni (idle, walk, run, jump, wave, dance, cheer, sit, floor) |
| `tools/blender/items.py` | `public/models/items.glb` | veicoli, animali da compagnia e moneta dei negozi |
| `tools/blender/hub.py` + `world_districts.py` + `world_extra.py` | `public/models/hub.glb` + `hub.json` | terreno con colline e lago, piazza, quartieri (città, lago, foresta, collina, palco, prato), alberi/rocce/fiori come istanze; **occlusione ambientale cotta con Cycles** nei colori dei vertici; layout di gioco (mappa delle altezze, collisioni, piattaforme, sedute, portali, teletrasporti, zone) |

Per rigenerarli serve Blender come modulo Python (`pip install bpy`, Python 3.13):

```bash
pip install bpy
BLENDER_PY=$(which python3) tools/build-models.sh
```

Lo script esporta i glTF e li comprime con meshopt (`gltf-transform`). Nel gioco i materiali
vengono riconosciuti per nome (es. `Hair`, `Top`, `Water`, `Portal_<id>`), così i colori
dell'avatar si cambiano in tempo reale e gli effetti (acqua, portali, specchio) restano dinamici.

## Avvio

```bash
npm install
npm run dev      # http://localhost:5173 (anche dalla rete locale, per provarlo sul telefono)
npm run build    # build statica in dist/
```

## Controlli

| Dispositivo | Movimento | Camera | Salto | Interagisci | Personaggio |
|---|---|---|---|---|---|
| PC | WASD / frecce, Shift corri | trascina col mouse, rotella zoom | Spazio | E | C · M mappa · B zaino · V veicolo · emote 1-4 |
| Telefono/tablet | joystick a sinistra (spingi tutto per correre) | trascina sullo schermo | ⤒ | E | pulsante in alto |
| Gamepad | stick sinistro | stick destro | A | X | — |
| Meta Quest (VR) | stick sinistro | guardati intorno, stick destro = rotazione a scatti | A | trigger / X | — |

## Struttura

```
src/
  core/Engine.js          renderer, scena, loop compatibile WebXR, ingresso in VR
  core/toon.js            materiali toon, contorni, texture generate
  core/storage.js         salvataggio locale (da sostituire con account/server)
  world/Hub.js            l'hub da Blender + cielo, acqua, erba, specchio, effetti
  world/worlds.js         elenco dei mondi collegati ai portali
  player/Avatar.js        avatar da Blender: varianti, colori, fusione animazioni, emote
  player/avatarParts.js   disegno del viso (occhi, espressioni)
  core/assets.js          caricamento glTF compressi (meshopt)
  game/                   economia, catalogo, negozi, veicoli e animali (Gear), monete, passanti (NPCs)
tools/
  blender/                script Blender che creano avatar e hub
  build-models.sh         rigenera e comprime i modelli
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
