# 01 — Product and scope

## The promise

Throw darts without stopping to do arithmetic or look at a screen. The score is
read by the camera when it can be, spoken out loud always, and corrected by you
in one tap when the camera is wrong.

The promise is explicitly **not** "the AI never misses". It is *fast,
explainable, confirmable scoring with a manual fallback that is good enough to
be the whole product on its own*. Every design decision below follows from that
sentence.

## v1 scope

### Game

- **X01**: 301, 401, 501, 701, 1001, plus any custom start score.
- **In rule**: straight / double / triple / master (double or triple).
- **Out rule**: straight / double / triple / master.
- Legs and sets, best-of or first-to, alternating throw order per leg.
- 1–8 players, local (everyone throws at the same board).
- Bust handling, including the "one dart left, score is 1 with double out" case.
- Undo of anything, at any point, including a corrected dart.

### Scoring input — three sources, one model

1. **Manual**: an interactive dartboard. You press where the dart landed, which
   records both the score *and* an approximate position.

   A treble bed is 8 mm wide — about six pixels on a phone, and completely
   hidden under a fingertip — so the board behaves like a text cursor on a
   touchscreen: pressing raises a **magnifying lens directly above the finger**,
   showing the board underneath at 3.2× with a crosshair on the exact point and
   the score it would give. Drag to adjust, lift to commit.

   The lens never moves relative to the finger. An earlier version slid it
   sideways near the top of the board to keep it within the frame, and crossing
   the 20 made it jump from one side to the other — a lens you have to re-find
   with your eyes is not a lens. It floats past the edge of the board instead,
   the way a phone's text loupe floats over whatever is above it.

   A keypad (single / double / treble plus the number) is there for when tapping
   the board is not wanted, and records the score without a position; the board
   is the default, because positions are what make the statistics interesting.
2. **Voice**: "treble twenty", "sixty", "double sixteen", "no score", "undo".
3. **Camera**: the autoscorer proposes, you confirm or correct.

All three write the same event with the same shape. A correction is a new
event, not a mutation — see [02 – Architecture](02-architecture.md).

### Caller

Spoken visit totals, remaining score, checkout call, leg/set results, whose
throw it is. Volume, voice and verbosity configurable; can be muted per player.

### Checkout help

For every remaining score that can be finished within the darts left, the
suggested route under the configured out rule, e.g. `T20 T20 D20` for 140.
Shown on the scoreboard and spoken when the caller is on.

### Statistics

See [04 – Statistics](04-stats.md) for the full catalogue. Two tiers:

- **Classical**, computable from scores alone, so they work in fully manual games.
- **Positional**, which need dart coordinates: heatmaps, grouping, miss
  direction, and a personalised optimal aim map.

### Device modes

**Solo (one device).** A phone on a stand does everything: camera, inference,
scoring, calling. Inference only runs on settle events, never per frame, which
is what keeps the phone cool and the battery alive.

**Paired (two devices).** A laptop/desktop browser is the *hub*: it runs the
vision pipeline, holds the game state and shows the scoreboard. The phone
becomes a camera and nothing else — no inference, dimmed screen, wake lock on —
streaming over WebRTC with its hardware encoder.

Pairing is two QR codes and no server: the laptop shows one, the phone reads it
and shows its answer back, and the laptop's webcam reads that. Nothing touches
the internet, so it works on a hotspot with no data. See
[05 – Dual device](05-dual-device.md).

Which mode you are in is chosen on the way into the app, from a page that shows
what each one does rather than describing it.

The hub is a browser tab. There is no desktop app to install and no server that
has to be running for a game to work.

## Explicitly not in v1

- Cricket, practice modes, party games, bot opponents. The engine is written so
  that a second game mode is a new rules module, not a rewrite — but one mode,
  finished, beats five half-modes.
- Online multiplayer against a remote opponent.
- Accounts, cloud sync, any server-side storage. Data is local, with export and
  import. A sync boundary exists in the storage layer so this can be added later
  without touching the game code.
- Native iOS/Android apps.
- Soft-tip boards and non-standard boards.

## Why freemium later is still possible

Everything above is free and open source and stays that way. A paid tier, if it
ever happens, would be hosted storage and cross-device history — a separate
service behind the existing sync boundary. Nothing in the scoring or vision path
depends on it, and none of it is designed to be crippled to create an upsell.

## Constraints that shaped this

- **The camera cannot be trusted silently.** A single camera physically cannot
  always see a dart tip hidden behind another dart's barrel. The UI therefore
  always shows what it believes and makes correcting it a single tap.
- **Corrections are the training set.** Every correction is a labelled example
  from exactly the setup and lighting we care about. This is designed in from
  the first version, not bolted on. Frames are only kept when you opt in, and
  they stay on your device until you choose to export them.
- **Poor light and part-hidden darts are the normal case**, not the edge case.
  A garage, one lamp, three darts in a cluster. Evaluation data must look like
  that or the accuracy numbers are lies.
