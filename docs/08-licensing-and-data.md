# 08 — Licensing, data provenance, and what must not be copied

This project is public, is meant to stay free and open source, and may one day
have a paid hosted tier alongside it. That only works if every input is traced.
Read this before importing code, weights or images from anywhere.

## This repository

**AGPL-3.0.** Chosen deliberately: the scorer and the autoscorer stay open even
for someone who runs them as a hosted service, which is exactly the guarantee
wanted. A paid tier remains possible — AGPL forbids nothing about charging money,
and as sole copyright holder Marco can license the code differently to whoever he
likes, including himself. That last point only holds while every line is his (or
contributed under terms that allow relicensing), so `CONTRIBUTING.md` asks
contributors to agree to that.

## Prior art: what may and may not be used

| Project | Licence | Verdict |
|---|---|---|
| [`bnww/dart-sense`](https://github.com/bnww/dart-sense) (cloned locally on this machine) | CC BY-NC 4.0, README states **non-commercial, non-distributable** | **Do not** copy code. **Do not** ship `weights.pt`, or train on top of it. Fine to read, as prior art, and to run locally for personal comparison. Its README is a good description of the problem and is cited as such. |
| [`wmcnally/deep-darts`](https://github.com/wmcnally/deep-darts) | no licence file → all rights reserved | Code off-limits. The *paper* (McNally et al., CVPRW 2021) is citable and its ideas — keypoints-as-objects, homography from four calibration points — are ideas, not code. |
| [`Der-Penz/Scored`](https://github.com/Der-Penz/Scored) | no licence file | Code off-limits. Design reference only (4 board keypoints + dart tip + flight is a sound keypoint set). |
| [`nick-kuhle/darts-180`](https://github.com/nick-kuhle/darts-180) | NOASSERTION | Not used. Cited in doc 03 as a cautionary example of architecture-before-perception. |
| [`hanneshoettinger/opencv-steel-darts`](https://github.com/hanneshoettinger/opencv-steel-darts), `OpenDartboard` | check per repo before touching | Multi-camera Raspberry Pi systems; different problem, not needed. |

Board geometry constants (451 mm board, 170 mm double outer radius, 107 mm treble
outer radius, 8 mm ring beds, 6.35/15.9 mm bull radii, 18° sectors, the segment
order) are **physical measurements of a standardised object**, not anyone's
expression. They are re-derived from the WDF/PDC board specification in
`packages/core/src/board/geometry.ts`, with the spec cited in comments.

## Datasets

| Dataset | Licence | Obligation |
|---|---|---|
| **DeepDarts D1 + D2** — McNally, Vats, Wong, McPhee, *DeepDarts: Modeling Keypoints as Objects for Automatic Scorekeeping in Darts using a Single Camera*, CVPRW 2021. IEEE DataPort, DOI 10.21227/05e7-xs69 | CC BY (IEEE DataPort submission terms) | Attribution in `ml/README.md`, in the model card, and in the app's about screen. Download needs a free IEEE account — fetch it manually, never scripted past a login. Not redistributed from this repository. |
| **Own captures** (Marco's board) | ours | Stay local by default. If ever published, they get their own licence statement and no faces or identifiable rooms in frame. |
| **In-game corrections** | ours, and the user's | Opt-in. Frames never leave the device unless exported deliberately. Doc 01 states this to the user, not just here. |

## Model training stack

Shipped weights must be trainable under permissive terms, so that the project
keeps the option of a native app or a differently-licensed distribution later.

**Allowed in the shipping path**: PyTorch (BSD-3), `timm` (Apache-2.0, with
per-weight licences checked — ImageNet backbones used here are Apache-2.0 or
BSD), `albumentations` (MIT), `onnx`/`onnxruntime` (MIT), `opencv-python`
(Apache-2.0).

**Allowed for comparison only**: Ultralytics YOLO (AGPL-3.0). This repository's
licence is compatible with it, so an Ultralytics baseline may live here, clearly
marked. But Ultralytics' position is that AGPL extends to models trained with
their code, and a shipped AGPL weight file would permanently block an app-store
release. Therefore: **no weight file produced by Ultralytics is ever committed to
`apps/web/public/models/` or referenced by a release manifest.** The baseline
exists to tell us whether our own trainer is competitive.

**Not allowed**: anything with a non-commercial clause (that includes the
`dart-sense` weights and YOLO-NAS weights), and any model whose training data
provenance cannot be stated.

## Model cards

Every shipped model gets a card in `ml/models/<name>/CARD.md` recording: training
data and its licences, augmentation, hyperparameters, the evaluation table from
doc 03, the device latencies measured, known failure modes, the commit and the
SHA-256 of the exported file. If a model cannot produce that card, it does not
ship.

## Naming and trademarks

"oche" is a common noun for the throwing line and is used as the project name.
DartsMind is a separate product referenced only as prior art. No PDC/WDF
branding, no dartboard manufacturer's marks, and no claim of certification is
used anywhere in the app.
