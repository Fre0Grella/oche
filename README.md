# oche

A web app for playing darts: X01 scoring, a spoken caller, checkout help, deep
statistics — and a camera autoscorer that reads the board and scores your darts
for you, running entirely in the browser.

**Play it: <https://fre0grella.github.io/oche/>** — X01, tap-the-board scoring and
the spoken caller work today, on a phone or a laptop.

> **Status: planning + foundation.** Nothing here claims to score darts from a
> camera yet. The autoscorer is a gated track: it does not get wired into the
> game until a trained model passes a measured accuracy bar on held-out photos
> of a real board. See [`docs/03-autoscorer.md`](docs/03-autoscorer.md).

## What it is

| | |
|---|---|
| **Play** | X01 (301 → 1001), configurable in/out rule (straight / double / triple / master), legs and sets, 1–8 players. |
| **Score** | Three ways, always interchangeable: tap the board, say it out loud, or let the camera read it. The camera never gets the last word — you do. |
| **Caller** | The score is spoken, so nobody has to look at the screen. |
| **Checkout** | What to aim at on every finishable score, following the configured out rule. |
| **Stats** | The usual ones (3-dart average, first 9, checkout %, darts per leg, tons) plus the ones only a camera can give: where your darts actually land, how tightly they group, which way you miss, and where *you* should be aiming. |
| **Camera setup** | Point the phone at your board and the app tells you what to fix — cut off, too dark, too straight on, camera moved — then you mark the four board points once. |
| **Mark where they landed** | With the camera on, every visit is photographed and you tap where each dart went. That corrects the score and builds the training set for the autoscorer. It stays on your device until you export it. |
| **Two device modes** | **Solo:** the phone does everything. **Paired:** the phone is only a camera and a laptop does the rest. Pairing is two QR codes and no server at all — the video goes straight between the devices and never leaves your network, so it works on a hotspot with no internet. |

Offline-first: it's a PWA, all game data lives on your device, and there is no
account to create.

## Repository layout

```
packages/core/     Board geometry, X01 rules, checkout routes, stats. Pure TS, no DOM.
apps/web/          The app: React + Vite, PWA.
docs/              Plan, decisions and the licence map. Start with docs/07-roadmap.md.
ml/                (later) Dataset prep, training, evaluation, ONNX export.
services/pair/     (later) Signalling relay for phone↔laptop pairing.
```

## Quick start

```bash
npm install
npm test          # core rules + geometry
npm run dev       # app on http://localhost:5173
```

## Documentation

| Doc | What's in it |
|---|---|
| [01 – Product](docs/01-product.md) | Scope, the two device modes, what is deliberately not in v1. |
| [02 – Architecture](docs/02-architecture.md) | Packages, the event log, why every dart stores coordinates. |
| [03 – Autoscorer](docs/03-autoscorer.md) | The runtime choice (ONNX Runtime Web), the pipeline, the training plan, the accuracy gate. |
| [04 – Statistics](docs/04-stats.md) | Every stat, with its formula. |
| [05 – Dual device](docs/05-dual-device.md) | Pairing, WebRTC, signalling. |
| [06 – Voice](docs/06-voice.md) | Caller out loud, voice-controlled scoring, platform limits. |
| [07 – Roadmap](docs/07-roadmap.md) | Phases and the gates between them. |
| [08 – Licensing & data](docs/08-licensing-and-data.md) | What may and may not be used here. Read before importing anything. |

## Licence

[AGPL-3.0](LICENSE). The scorer and the autoscorer stay free and open source,
including for anyone who runs them as a service.
