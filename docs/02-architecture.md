# 02 — Architecture

## Shape

```
┌─────────────────────────────────────────────────────────────┐
│ apps/web  (React + Vite, PWA)                               │
│                                                             │
│  UI ── scoreboard · board input · stats · capture lab       │
│   │                                                         │
│   ├── game store (events in, snapshot out)                  │
│   ├── caller (speech out)                                   │
│   ├── voice input (speech in → dart events)                 │
│   └── vision session ──► Worker ──► ONNX Runtime Web         │
│                             ▲                                │
│                      camera │ local getUserMedia             │
│                             └ or remote WebRTC track (hub)   │
└─────────────────────────────────────────────────────────────┘
        │ writes                              │ reads
        ▼                                     ▼
   IndexedDB (append-only events)      packages/core (pure TS)
```

`packages/core` has no DOM and no I/O. Board geometry, X01 rules, checkout
routes and the whole statistics engine live there, are covered by unit tests,
and can be reused by anything later (a native app, a CLI, a server).

## The event log is the database

Every game is an append-only list of events. Snapshots (current score, who is
at the oche, per-player stats) are derived by folding the list. Nothing is
edited in place.

```ts
type DartThrown = {
  type: 'dart.thrown'
  id: string            // uuid
  ts: number            // epoch ms, from the device clock

  // No leg, player, visit or dart index: the fold knows whose throw it is from
  // the rules and the darts so far, so those cannot be recorded inconsistently.

  // Where it landed, in the canonical board frame:
  // millimetres from the centre, +x right, +y up, board plane.
  // Absent when the score came from the keypad or from a voice call that
  // named no position.
  pos?: { x: number; y: number }

  // What it scored. Always present, always consistent with `pos` when both exist.
  hit: { sector: number; ring: Ring; value: number }   // sector 0 for bull/miss

  source: 'manual' | 'voice' | 'auto'
  confidence?: number    // 0..1, autoscorer only
  frameRef?: string      // key of the stored frame, when frame keeping is on
}

type DartCorrected = {
  type: 'dart.corrected'
  id: string; ts: number
  target: string         // id of the DartThrown being corrected
  hit: { sector: number; ring: Ring; value: number }
  pos?: { x: number; y: number }
  source: 'manual' | 'voice'
}
```

That is the whole event vocabulary: darts, and corrections to darts. Legs, sets,
busts, whose throw it is and who won are **derived**, never recorded, so they
cannot disagree with the darts. Undo pops the last event — the log has a single
writer on one device, so a retraction event would buy nothing.

### Why coordinates, not just "T20"

If a dart is stored only as the string `T20`, then heatmaps, grouping size,
miss-direction analysis and the personalised aim map are impossible forever,
and the autoscorer's mistakes cannot be turned into training data. Storing
`pos` costs 16 bytes and buys the entire positional half of
[04 – Statistics](04-stats.md).

Manual entry via the board gives a position too — the one you tapped. It is
less precise than a camera reading, and is flagged as such (`source: 'manual'`)
so the stats layer can weight or exclude it.

### Why corrections are events

`dart.corrected` keeps the original reading. That gives three things for free:

1. **Undo** of a correction.
2. **A live accuracy metric**: corrections ÷ auto-scored darts, per session, per
   lighting condition. This is the number that tells us whether the autoscorer
   is actually working, and it comes from real use rather than a benchmark.
3. **Training data**: original reading + corrected truth + stored frame is
   exactly one labelled sample.

## Storage

IndexedDB (`apps/web/src/storage/db.ts`), with an in-memory fallback so a private
window or blocked site data degrades to "this session only" instead of crashing:

| Store | Contents | Growth |
|---|---|---|
| `matches` | One record per match: its config and its whole event log. A match is ~100 darts × ~200 B, so rewriting the record per dart is cheaper than the complexity of a separate event store | a year of heavy play is a few MB |
| `settings` | Caller on/off, entry mode, locale | trivial |
| `frames` *(A4)* | Opt-in captured frames for training, with their labels | ~80 KB/frame JPEG, quota-managed, explicitly exportable and deletable |

Nothing is stored that is derivable: no scores, no averages, no snapshots. That
module is also the only place that touches persistence, so optional hosted sync
later is one file rather than a refactor.

## Rendering and state

- React 19 + Vite 7, TypeScript strict.
- `zustand` for the game store: it holds the event list and a memoised snapshot.
- No component library. The scoreboard is read at 2–3 metres in bad light: huge
  numerals, high contrast, dark theme first, large touch targets.
- i18n from day one, as one small module per locale (`src/i18n/`) rather than a
  framework: English ships, other locales are additive files. Darts vocabulary
  (caller phrases, number words, voice grammar) is per-locale data, because "one
  hundred and eighty" and "centottanta" are not the same sentence shape.

## Vision code boundary

`apps/web/src/vision/` is written so the game never imports it directly:

```
camera/      getUserMedia, constraints, frame pump, motion & settle gate
pose/        board keypoints → homography → rectified board view
detect/      ONNX session (in a Worker), tip heatmaps → coordinates
score/       rectified coordinates → hit, with a confidence and a margin-to-wire
session/     the state machine: idle → motion → settle → propose → confirm
```

`session/` emits proposals. The game store decides what to do with them. This
means autoscoring can be turned off, replaced, or run in "shadow mode" (it
proposes, you score manually, and we measure how often it agreed) without
touching game logic. Shadow mode is how the model gets validated on real play.

## Testing

- `packages/core`: vitest, including a table-driven check of every board
  coordinate → score mapping against known values, X01 bust/finish cases, and
  the checkout generator against a published checkout table.
- `apps/web`: vitest + Testing Library for the scoring flows; the vision session
  state machine is tested headless with synthetic detection sequences.
- Scoring accuracy of the model is *not* a unit test. It is a separate
  evaluation run over held-out photographs, reported as numbers in
  [03 – Autoscorer](03-autoscorer.md).
