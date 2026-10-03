# ml/ — training the autoscorer

This trains **model B** of [docs/03](../docs/03-autoscorer.md): the dart-tip
detector. It takes a photograph, warps the board to a 512² top-down square
using the calibration you set in the app, and finds each tip on a heatmap. The
score then comes from where the tip is, by the same geometry the app uses.

Model A (board pose, which would replace the four markers you drag) is not built
yet. Until it is, the app's manual calibration provides the warp.

## Setup (once)

Windows, Python 3.10+, an NVIDIA GPU optional but worth having.

```powershell
cd ml
python -m venv .venv
.venv\Scripts\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pytest
```

GTX 16-series cards (the 1650 included) produce NaNs in half precision, so
training runs them in full precision automatically (`--amp auto`); a batch of 16
at 512² then takes about 2.4 GB.

For a CPU-only machine, install torch from the default index instead. Every
command below runs from `ml/` with `.venv\Scripts\python`, shortened to
`python` here.

## Data

Put things here; none of it is committed (see `.gitignore` and
[docs/08](../docs/08-licensing-and-data.md)):

```
ml/data/oche/        your exports from the app: treblewise-captures-YYYY-MM-DD.zip (older ones: oche-captures-…)
ml/data/deepdarts/   the DeepDarts dataset, unpacked (labels.pkl + cropped_images/)
ml/data/dartscribe/  the dartscribe dataset (throws/, boards/): side-view cameras
```

**Your exports.** In the app: Camera setup → Export. Check them first in
"Review photographs": a photograph confirmed there is exported with
`"reviewed": true`, and `--reviewed-only` trains on those alone. Keep every export; later
ones repeat earlier frames and the loader keeps each frame once. Frames are
checked on load: a label whose homography or score disagrees with itself is
rejected, and so is a game report with a dart left unplaced.

**DeepDarts** (McNally, Vats, Wong, McPhee, *DeepDarts: Modeling Keypoints as
Objects for Automatic Scorekeeping in Darts using a Single Camera*, CVPRW 2021).
IEEE DataPort, DOI [10.21227/05e7-xs69](https://doi.org/10.21227/05e7-xs69),
licensed CC BY. It needs a free IEEE account, so it is downloaded by hand, never
by a script. About 16 000 images, mostly one face-on setup: it teaches what a
dart tip looks like, not what your room looks like.

> The DeepDarts reader (`treblewise_ml/deepdarts.py`) has not yet been run on the
> real download. Before the first training run, look at it:
> `python -m treblewise_ml.preview --deepdarts data/deepdarts --out runs/preview-dd --limit 30`.
> The green board must sit on the real wires, with the 20 at the top. If it is
> rotated by a sector or mirrored, the fix is the four points in
> `DEEPDARTS_CALIBRATION_BOARD` and nothing else.

**dartscribe** (Ercan Akyürek; Hugging Face
[`geforcefan/dartscribe`](https://huggingface.co/datasets/geforcefan/dartscribe),
**CC BY-SA 4.0**: attribution and share-alike). Three cameras on a ring around
the board, about 40 cm from the bull and tilted 34–56°, plus in two sessions a
phone on a stand about 2 m back. 312 visits, each photographed empty and after
every dart: about 2 900 photographs with darts in the board and 980 without.
Every camera has the bull and the 80 wire crossings labelled; every dart has
its position on the board, most placed by dartscribe's own three-camera
triangulation rather than by hand.

It is here because DeepDarts is face-on (2° of tilt in D1, at most 29° in D2),
where a flight sits over its tip, and a model trained on it marks the flight
on a side camera: tips-v1 scores 0.5% of dartscribe's held-out photographs
right. Your phone, at about 45° and 70 cm, sits between the two datasets.

```powershell
python -c "from huggingface_hub import snapshot_download; snapshot_download('geforcefan/dartscribe', repo_type='dataset', local_dir='data/dartscribe', allow_patterns=['README.md','throws/*/*/data.yaml','throws/*/*/throw-*.jpg','boards/*/*'])"
python -m treblewise_ml.preview --dartscribe data/dartscribe --out runs/preview-ds --limit 30
```

Whether share-alike reaches a model trained on the data is not settled law. A
model card that used dartscribe says so; decide before shipping such a model
in anything that is not itself open.

## Splits

Photographs are split into train / val / test by **group**, never by single
frame: all photographs of one visit (the same darts, one more each time), one
match, or one DeepDarts recording session go to the same side. Otherwise
the test set would be near-copies of training images, and the number it gives
would flatter the model. The split is a hash of the group's name, so it is the
same on every run and every later export: nothing that was test ever becomes
train.

With only a few visits the test split can be empty, and the commands say so.

## Workflow

```powershell
# 0. Look before you train. Rectified boards, wires drawn from the spec, your tips.
python -m treblewise_ml.preview --oche data/oche/*.zip --out runs/preview

# 1. Pretrain on DeepDarts. The first epoch prints how long one takes.
python -m treblewise_ml.train --deepdarts data/deepdarts --epochs 40 --out runs/pretrain

# 2. Fine-tune on your board.
python -m treblewise_ml.train --oche data/oche/*.zip --init runs/pretrain/best.pt --epochs 60 --lr 3e-4 --out runs/finetune
#    or both together, showing your photographs more often:
python -m treblewise_ml.train --oche data/oche/*.zip --deepdarts data/deepdarts --oche-repeat 20 --init runs/pretrain/best.pt --out runs/mixed

# 3. The number that matters: held-out photographs of your board.
python -m treblewise_ml.evaluate --checkpoint runs/finetune/best.pt --oche data/oche/*.zip

# 4. See what it got wrong.
python -m treblewise_ml.preview --oche data/oche/*.zip --checkpoint runs/finetune/best.pt --out runs/preview-model

# 5. Export for the browser. Checks ONNX against PyTorch, writes a model card.
python -m treblewise_ml.export --checkpoint runs/finetune/best.pt --name tips-v2
#    then release it: see "Releasing a model" below.
```

`python -m treblewise_ml.train --oche <one export> --overfit --epochs 150 --out runs/overfit`
is the smoke test: with augmentation off it should memorise a handful of
photographs almost exactly. If it cannot, something in the pipeline is broken,
and no amount of data will help.

## Retraining, in one command

`retrain.ps1` does all of the below in order and stops at the first failure:

```powershell
cd ml
.\retrain.ps1 -Name tips-v1 -Publish     # DeepDarts only: no data/oche/*.zip yet
.\retrain.ps1 -Name tips-v2 -Publish     # with your exports in data/oche/: fine-tunes on them
```

It pretrains on DeepDarts only if `runs/pretrain/best.pt` is missing (or with
`-Pretrain`), fine-tunes when there are exports in `data/oche/`, evaluates,
exports, and with `-Publish` uploads the draft release. The two steps that
touch the public repository are then yours: commit and push the model card,
and `gh workflow run model-release.yml -f name=<name>`.

## Version 1: DeepDarts only

The first model is trained on DeepDarts alone, before there are enough clean
photographs of your own board to fine-tune on:

```powershell
python -m treblewise_ml.preview --deepdarts data/deepdarts --out runs/preview-dd --limit 30   # look first
python -m treblewise_ml.train --deepdarts data/deepdarts --epochs 40 --out runs/pretrain
python -m treblewise_ml.evaluate --checkpoint runs/pretrain/best.pt --deepdarts data/deepdarts
python -m treblewise_ml.export --checkpoint runs/pretrain/best.pt --name tips-v1
```

DeepDarts is mostly shot face-on; your camera is well off to the side. The
warp removes most of that difference, but expect v1 to miss darts on your board.
That is what it is for: it proposes in the capture lab, you correct it, and the
corrections are the photographs the fine-tuned v2 learns most from. Its card
says "gate not evaluated", and it never scores a game.

## Releasing a model

What stays on this machine, always: the `.pt` checkpoints, `runs/`, every
photograph and every dataset. What becomes public: the `.onnx` file and its
card. The ONNX file *is* the weights, in another format — there is no way to
run a model in a visitor's browser without giving the browser the model, and
the site and the repository are public. Only a server could keep it private.

```powershell
python -m treblewise_ml.export --checkpoint runs/pretrain/best.pt --name tips-v1
python -m treblewise_ml.publish --name tips-v1        # uploads a DRAFT release: visible only to you
git add models/tips-v1/CARD.md; git commit -m "Model card for tips-v1"; git push
gh workflow run model-release.yml -f name=tips-v1
```

The "Publish model" workflow (`.github/workflows/model-release.yml`) checks the
draft's file against the SHA-256 in the committed card and against the
browser's contract, publishes the release, and starts CI/CD on the default
branch, which deploys once the checks pass. The deploy copies the newest published model into the site as
`models/<name>-<hash>.onnx` with a `manifest.json`; the app checks the hash
before running it. Before a release trained on DeepDarts, confirm on the
[DataPort page](https://ieee-dataport.org/open-access/deepdarts-dataset) that
its licence allows it (the card attributes it as CC BY).

To try a model in the app without releasing it, put the file and a
`manifest.json` in `apps/web/public/models/` (gitignored) and run `npm run dev`.

## Proposals in the capture lab

With a model shipped, "Try it" proposes: the model marks the new dart and calls
it; if it is right you just throw the next one, if not you drag the mark. Marks
the model placed are exported with `"by": "model"`, and any photograph holding
one only ever goes to the training split: testing on it would grade the model
against its own answer. One visit in five is left for you to mark from
scratch — a whole visit, because a visit is one unit to the split — and any
visit where the model proposed anything goes to training entirely. The price:
test visits come only from those, so a session with proposals switched off
grows the test set faster.

## The gate

From docs/03. Autoscoring leaves shadow mode only when, on the held-out test
split of your own board:

| | |
|---|---|
| PCS, the visit's total exactly right | ≥ 90 % |
| Confidently wrong darts | ≤ 1 % |

`evaluate` prints both and says whether they pass. Latency is measured in the
browser, not here.

## How much data

Rough expectations, not promises: with DeepDarts pretraining, a few hundred
photographs of your board should get the tip error down to a few millimetres;
the last few per cent of PCS come from the hard photographs (grouped darts,
a flight covering a tip, poor light), so collect those deliberately. Throw
whole visits without pulling the darts: the app marks the ones already in the
board for you.

## Files

| | |
|---|---|
| `treblewise_ml/board.py` | Scoring (a port of `packages/core`), homographies, the rectified-view spec |
| `treblewise_ml/capture_export.py` | Reads and checks the app's export zip |
| `treblewise_ml/deepdarts.py` | Reads DeepDarts |
| `treblewise_ml/dartscribe.py` | Reads dartscribe (side-view cameras), with its own fixed split |
| `treblewise_ml/dataset.py` | Warping, augmentation, heatmap targets |
| `treblewise_ml/model.py` | The network and its losses |
| `treblewise_ml/decode.py` | Heatmaps → tips → scores; the reference for the browser's decoder |
| `treblewise_ml/metrics.py` | PCS, per-dart accuracy, error kinds, confidently-wrong |
| `treblewise_ml/validate_onnx.py` | The browser's contract for an exported model; also run by the release workflow |
| `treblewise_ml/parity_fixture.py` | Writes the fixture that holds the TypeScript decoder (`packages/core/src/vision/tips.ts`) to this package |
| `treblewise_ml/{train,evaluate,preview,export,publish}.py` | The commands |

## Licences

Code: AGPL-3.0-or-later, like the rest of the repository. Backbone weights:
timm's ImageNet-1k MobileNetV4, Apache-2.0. DeepDarts: CC BY, attribution above
and in every model card that used it. No Ultralytics code or weights are used,
so trained models stay free of AGPL inheritance (docs/03, docs/08).
