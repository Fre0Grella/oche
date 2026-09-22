# 07 — Roadmap

Two tracks. **Track A** is the app, which must be a good darts app with no camera
involved at all. **Track B** is the vision system, which is gated on data and on
measured accuracy. Track A never waits for Track B.

The ordering below is chosen so that data collection — the long pole — starts as
early as possible, and so that nothing is built before the thing that proves it
was needed.

**Order changed, 2026-09-22.** The deploy half of A7 moved ahead of A4: a browser
refuses camera access outside a secure context, so the capture lab cannot collect
a single frame until the app is served over HTTPS. It is live at
<https://fre0grella.github.io/oche/>; the PWA half of A7 is still outstanding.

## Track A — the app

### A1. Foundation — done
Monorepo, TypeScript strict, CI, licence, these docs.
`packages/core`: board geometry (mm-accurate segment map), the X01 engine
(in/out rules, bust, legs, sets), the checkout route generator, all unit tested.

**Done**: 50 core tests cover the board coordinate → score mapping, every bust
case, double/treble/master in and out, legs and sets, corrections, and the
checkout chart for 2–170 including the bogey scores.

### A2. Playable — done
Scoreboard, interactive board input, keypad, per-dart correction, undo, match
setup, IndexedDB event persistence, match history, checkout hints on screen.

**Done**: a match can be played end to end, closed and reopened without losing
state. Still to polish: a stats screen (A5), and the layout pass for phone
portrait and a TV-sized scoreboard (A7).

### A3. Caller — done, with the clip pack outstanding
`CallerVoice` with the `speechSynthesis` implementation, English phrase and
number-word data, caller toggle. The announcement logic is a pure function of
two snapshots, so it is unit tested without a speaker.

**Outstanding**: the recorded clip pack (doc 06), per-player mute, volume.

### A4. Capture lab — done
Camera preview, four-point calibration with the board wireframe drawn over the
image so the fit is checkable by eye, automatic capture when the board settles,
tip labelling by tapping the photograph, local storage, and a zip export in the
format `ml/` will read.

Plus the same thing inside a game: with the camera on, every settled throw is
photographed, and **Report** opens that photograph so anyone can say where the
dart actually landed. That corrects the score *and* files a labelled example —
which is exactly the flywheel the autoscorer needs, working before the
autoscorer exists.

**Outstanding**: the automatic trigger's thresholds have not been set against a
real board — the app shows the two numbers it measures so the first session can
set them, and "Capture now" works regardless. Also model-assisted pre-labelling
(markers placed by a first model, so labelling becomes nudging) and a review
screen for frames already labelled.

> From here, data collection runs in parallel with everything below.

### A5. Statistics
The classical tier in full, the positional tier for what tapped positions
support. Board heatmap, per-double table, trends, per-session view, export.

### A6. Voice scoring
Grammar + parser in core, Web Speech adapter with contextual biasing, push-to-talk
UI, caller echo of every voice score.

### A7. PWA and deploy — deploy done
GitHub Pages deploy from CI on every push to main, tests gating the deploy.

**Outstanding**: service worker, offline, installable, and the cross-device
layout pass (phone portrait, laptop, and a TV-sized scoreboard).

## Track B — vision

### B1. Data pipeline
DeepDarts D1/D2 import (CC BY, attribution recorded), own-capture import,
one canonical dataset format, deterministic train/val/test split with **all of
Marco's board held out by session**, so no frame from a test session ever appears
in training.

### B2. Board pose model
Keypoint heatmaps → RANSAC homography. Evaluated on rectification error in mm at
the double ring, not on keypoint loss.

### B3. Tip model
CenterNet-style tip + tail heatmaps on rectified crops. Trained on DeepDarts,
fine-tuned on own data. Ultralytics baseline trained in parallel for comparison
only, weights never shipped.

**Done when**: the evaluation table in [03 – Autoscorer](03-autoscorer.md) is
filled in with real numbers for both approaches.

### B4. Browser runtime
ONNX export (FP16, and INT8 evaluated), Worker-hosted ONNX Runtime Web session,
WebGPU with WASM fallback, and a benchmark page that reports median/p95 latency
on the actual devices.

### B5. Shadow mode
The full pipeline runs during ordinary manual games and records agreement with
what the player entered. No score is ever taken from the model. This produces the
only accuracy number that is not a benchmark.

### B6. Autoscoring, gated
Only when the gate in doc 03 is met: proposals become scores, with the confirm/
correct UI, the low-confidence question, and corrections fed back as training
data.

### B7. Paired mode
Signalling worker, QR pairing, WebRTC video + data channel, camera-role UI,
precision-still requests, reconnection. Deliberately after autoscoring works in
solo mode, because pairing multiplies the debugging surface of a system that must
already be known-good.

## What would make this fail, and the countermeasure

| Risk | Countermeasure |
|---|---|
| The model never gets good enough on a real board | Track A is a complete product without it; shadow mode makes the truth visible early instead of at the end |
| Data collection stalls because labelling is boring | A4 is scheduled before any training work, and labelling happens during normal practice on a rectified view, in taps |
| Scope creep into five game modes | v1 is X01 only, written down in doc 01 |
| Architecture built for a model that never arrives | No Rust, no database, no API service, no native shell. Nothing is added until Track A needs it |
| Licence contamination making the work unusable later | Doc 08, plus the rule that shipped weights come only from the permissive trainer |
