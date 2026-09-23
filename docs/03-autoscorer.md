# 03 — The autoscorer

This is the hard part, so this doc is the longest. It covers the runtime choice,
the pipeline, the model, how data is collected, and the bar the model has to
clear before it is allowed to score a real game.

## The honest problem statement

One camera, a phone or a webcam, looking at a steel-tip board from a metre away.
Three darts land one after another. We need the score of each within a second or
two of it landing, in a garage with one lamp, when the third dart's tip is
half-hidden behind the second dart's barrel.

Two things are commonly got wrong here, and both are worth stating up front:

**Latency is not the hard constraint.** A nano-class convolutional model at
512×512 runs in 20–80 ms on WebGPU and 150–400 ms on WASM SIMD with threads.
Even the slow path fits inside the 1–2 s budget with room to spare, because
inference does not run per frame — it runs once per settled dart. What costs
time is *waiting for the board to be still*, and that is a fixed ~300 ms.

**The hard constraint is data and occlusion.** A public reference project with a
far larger engineering surface than this one
([`nick-kuhle/darts-180`](https://github.com/nick-kuhle/darts-180)) built the
monorepo, the contracts, the workers and the API, and its own field reports say
the phone recorded *none* of the darts shown to it, because it had no lawfully
trained model. The lesson is copied here as a rule: **the vision track is gated
on measured accuracy, and the game is fully playable without it.**

## Runtime choice

Graded on what was asked for: accuracy under poor light, robustness to
semi-occluded darts, and speed. The first two are properties of the *model and
the pipeline*, not the runtime — every runtime below runs the same weights.
Where runtimes differ is what models they can run at all, how fast, and on which
phones.

| Runtime | Speed | Model freedom | Browser reach | Verdict |
|---|---|---|---|---|
| **ONNX Runtime Web** (WebGPU EP, WASM SIMD+threads fallback) | WebGPU ≈ 20× multithreaded WASM; 20–80 ms for a nano CNN at 512² | Anything exportable from PyTorch, including custom heads. FP16 and INT8 supported. | WebGPU in Chrome/Edge (desktop + Android), Firefox, and Safari 26 on iOS/macOS; WASM everywhere else | **Chosen** |
| TensorFlow.js | WebGPU backend competitive, WebGL backend slower and quirky | Needs a TF/TFLite conversion step; custom PyTorch ops are a porting exercise | Broad | Rejected: conversion tax for no gain |
| LiteRT.js / MediaPipe Tasks | Fast, well-tuned kernels | Tied to the task templates or TFLite conversion; custom keypoint heads are awkward | Good | Rejected: our head is custom by design |
| WebNN | Potentially best (NPU) | Still limited op coverage, patchy shipping | Narrow | Revisit later as an optional EP; ORT can target it without changing the model |
| OpenCV.js / classical CV only | Fast | n/a | Broad | Rejected as the primary detector: colour/edge segmentation is exactly what falls apart in bad light and with darts covering the board. Kept for homography maths only — and even that is ~40 lines of TS, so the 8 MB dependency is not worth it |

Practical consequences of choosing ONNX Runtime Web:

- The session lives in a **dedicated Worker**, fed `ImageBitmap`s. The UI thread
  never blocks and the caller never stutters.
- The exported graph must avoid NMS and other exotic ops, so it maps cleanly to
  both the WebGPU and WASM execution providers. Heatmap heads give us that for
  free (peak-picking is done in TS, on a tiny tensor).
- Model bytes are fetched once, cached by the service worker, and version-pinned
  by content hash, so a released app always runs the model it was evaluated with.

## Pipeline

```
 video frame
     │
 ┌───▼──────────────┐   64×64 grey crop of the board: still, and changed
 │ 1. capture       │   since the last photograph → take a frame
 └───┬──────────────┘   built; thresholds not yet set against a real board
     │ settled
 ┌───▼──────────────┐   board keypoint model, once per setup + on drift
 │ 2. board pose    │   keypoints → homography H (board mm ↔ image px)
 └───┬──────────────┘   today: the four points are placed by hand in the
     │                  capture lab, and the maths below it is built and tested
     │
 ┌───▼──────────────┐   warp the frame to a canonical top-down 512×512 board
 │ 3. rectify       │   (GPU, one draw call)
 └───┬──────────────┘
     │
 ┌───▼──────────────┐   tip-detection model on the rectified board
 │ 4. detect tips   │   heatmap → sub-pixel peaks → up to 3 tips + tail points
 └───┬──────────────┘
     │
 ┌───▼──────────────┐   which tips are new since the last confirmed state?
 │ 5. reconcile     │   masked pixel diff confirms the new dart's region
 └───┬──────────────┘
     │
 ┌───▼──────────────┐   canonical mm → polar → sector/ring → score
 │ 6. score         │   + confidence: peak sharpness × distance to nearest wire
 └───┬──────────────┘
     │
 ┌───▼──────────────┐   high confidence → call it, show it, let it stand
 │ 7. propose       │   low confidence or count mismatch → ask, don't guess
 └──────────────────┘
```

### Why the trigger is not a motion detector

The obvious design is "wait for movement, then for stillness". On a real board
it never fires, and the reason is worth keeping written down.

The camera is a metre from the board; the player throws from 2.37 m *behind*
it. Their arm never enters the frame. The dart is visible for two or three
motion-blurred frames and then covers a few per cent of the board. Averaged over
a whole video frame, a dart landing in the treble 20 moves the mean by less than
half a grey level — indistinguishable from sensor noise. A gate waiting for
"movement" waits forever. (The trap is easy to fall into in testing: a webcam
test pattern animates the whole frame, so a whole-frame metric looks like it
works right up until it meets a dartboard.)

So the trigger works on two numbers instead, both computed on a 64×64 greyscale
crop of **the board region only**, which the calibration homography gives us:

- **motion** — mean absolute difference from the previous frame. "Is something
  happening right now?" A hand reaching in, a dart in flight, a knocked camera.
- **change** — the largest per-block mean difference from a *reference* frame:
  the board as it was when it was last photographed. "Is there something on the
  board that was not there before?" A dart is small but locally dense, so an
  8×8 block sees it at ~30 grey levels where the whole-frame average sees 0.4.
  The blocks overlap by half, so a dart straddling a boundary is not lost.

A frame is taken when the scene is still *and* the board has changed. Pulling
the darts out is a change too, which re-arms the reference for the next visit.

The thresholds shipped today are reasoned starting points, not measurements. The
capture lab shows both numbers live, so the first session on a real board sets
them — and until it has, "Capture now" is the path that is known to work, which
the app says rather than implies.

### Why rectify before detecting

Warping the board to a canonical top-down view before the tip model sees it
means the model only ever looks at one geometry: board fills the frame, 20 at
the top, fixed scale. Camera angle, distance and rotation stop being things the
model has to learn to ignore, which is worth a large amount of training data.
It also makes the output coordinate *already* the scoring coordinate.

The cost: a dart's barrel and flight stick out of the board plane, so they smear
under the warp. The tip, which is what we need, is in the plane and maps exactly.
The parallax smear is actually a useful cue — it points at the camera — and the
model is trained on warped crops, so it learns it rather than fighting it.

The un-warped alternative (detect calibration points and tips in the raw frame
in one pass, as DeepDarts does) is kept as the baseline to beat, because it is
one model instead of two. Both are evaluated; the doc will record which won.

### Occlusion: the part that actually matters

Four mechanisms, in order of how much they buy:

1. **Detect each dart as it lands.** Darts are thrown one at a time. Dart 3 can
   hide dart 2's tip, but dart 2 was already read and locked when it was the
   only new thing on the board. Scoring incrementally, rather than reading three
   darts from one final photo, removes most occlusion cases outright. This is
   the single biggest win and it is a pipeline decision, not a model one.
2. **Tip + tail keypoints per dart.** When a tip is genuinely hidden, the visible
   barrel/flight gives an axis; the tip is extrapolated along it. Less accurate,
   flagged as lower confidence, and usually still right about the segment.
3. **Refuse rather than invent.** If the model sees two darts where three were
   thrown, the UI asks. A wrong silent score costs more trust than a question.
4. **A second camera later.** The hub architecture already accepts N sources;
   a second phone at a different angle turns most remaining occlusions into a
   solved problem. Not in v1.

### Poor light

- Heavy photometric augmentation at training time: brightness, contrast, gamma,
  colour temperature, sensor noise, motion blur, JPEG artefacts, and simulated
  glare/hotspots on the board.
- Collection deliberately includes bad conditions — see *Data* below. A model
  trained only on well-lit photographs is a model that works only in shops.
- A runtime **setup coach**, built: it measures where the board sits in the
  picture (from the calibration homography) and what the picture looks like
  (brightness, glare, sharpness, and how much has changed since calibration),
  and says one thing at a time in a colour you can read from the oche — "the
  board is cut off, turn the camera left", "almost straight on, move to one
  side", "too dark, put a lamp on the board", "the camera has moved". It is
  better to say that than to score badly in silence. The numbers behind it are
  shown too, because their thresholds still have to be set against real boards.

## The model

Two small networks, both ours, both exported to ONNX:

**A. Board pose.** Input 384², output heatmaps for calibration keypoints. Rather
than DeepDarts' 4 points, it predicts the 20 outer-double-wire intersections
plus the 4 cardinal points; the homography is then fitted with RANSAC over
whatever subset is visible. Four points is the minimum for a homography and
gives no redundancy, which is why a single occluded calibration point is a
common DeepDarts failure. Twenty gives slack. Runs once per setup, then only
when the scene drifts, so its cost is irrelevant.

**B. Dart tips.** Input: the rectified 512² board. Output: a tip heatmap and a
tail heatmap plus a small offset field for sub-pixel peaks — CenterNet-style,
which is the same "keypoints as objects" idea DeepDarts introduced, expressed as
heatmaps so that localisation is sub-pixel and no NMS op is needed in the graph.
Backbone: an ImageNet-pretrained mobile CNN (MobileNetV4-small class) with a
light FPN decoder, ~2–4 M parameters.

Both are implemented in this repository with PyTorch + `timm` + `albumentations`
(all permissive licences), for one reason: the weights must be unencumbered so
that the project keeps every option open, including one day shipping in an app
store. Ultralytics' YOLO is excellent and this repository's AGPL-3.0 licence is
compatible with it, but models trained with Ultralytics inherit AGPL, which
would close that door forever. Ultralytics may be used as an *offline baseline
for comparison*; its weights must never be shipped. See
[08 – Licensing & data](08-licensing-and-data.md).

Sub-pixel precision matters more than it sounds: at 512² rectified, one pixel is
≈0.9 mm on the board, and the double ring is 8 mm wide. A 3-pixel error can turn
a D20 into a single 20. Confidence therefore includes **distance to the nearest
wire**: a tip 1 mm inside the treble is reported with lower confidence than one
in the middle of the bed, and the UI asks.

## Data

| Source | Size | Licence | Role |
|---|---|---|---|
| DeepDarts D1 + D2 (McNally et al. 2021, IEEE DataPort) | ~16 k images | CC BY — attribution required | Bulk pretraining. Mostly one face-on setup, so it teaches "what a dart tip looks like", not "what your garage looks like". Download needs a free IEEE account. |
| Marco's board | target 500–2000 images, growing | ours | Fine-tuning and, critically, the held-out test set. Deliberately includes bad light, glare, clustered darts, different angles, different flights. |
| In-game corrections | grows with every session | ours | The flywheel: each correction is a labelled sample from the exact setup that matters. |

### Collecting it without it being a chore

A **camera setup screen with a practice round in it**, built and usable during
ordinary practice:

1. **Calibrate once per camera position.** Drag four markers onto the outer edge
   of the double ring on the centre lines of the 20, 6, 3 and 11. Those four
   landmarks were chosen because a person can find them without a diagram and
   hit them within a millimetre or two — "the upper-left corner of the 20
   segment" is a guess on a phone screen. The app then draws the whole board
   through the resulting homography, over the photograph: if the drawn wires sit
   on the real ones the calibration is right, and if they drift you can see
   exactly where. It also reports the fit in pixels.
2. **Try it.** Throw a dart. The board settles, the app photographs it, you tap
   the dart in the picture, and the score is called back out loud. Tap, hear,
   throw again.

   That one loop does three jobs. It proves the camera is set up properly — a
   wrong calibration gives a wrong score and you hear it. It is the least
   tedious way to label data, because a dart you have just thrown is a dart you
   can still see. And one throw is one labelled sample, so the counter going up
   *is* the training set being built.

   An earlier version photographed everything and queued it for labelling
   later. Forty near-identical photographs of a board is a chore nobody
   finishes, and it was not obvious what it was for. Now nothing is stored
   unless it has been marked: an unmarked frame is replaced by the next one.
3. **Export** a zip of frames plus `labels.json` in the format `ml/` reads.

The same flow runs inside a game, and that is the path meant for everyday use:
with the camera on, the end of every visit offers **Mark where they landed**,
which opens the photograph of that throw with a marker already on each dart, and
asks the one question worth asking. The answer corrects the score and files a
labelled example from exactly the setup and lighting that produced it. The
capture lab is then only for setting the camera up and for throwing without a
game on.

Once a first model exists, the same screens place the markers themselves, so
labelling becomes nudging: several times faster again.

## Evaluation and the gate

Metrics, computed on a **held-out set of photos from Marco's board that no
training run has seen**:

- **PCS** (percent correct score): fraction of images where the *total* of the
  visit is exactly right. The number that matters to a player.
- **Per-dart accuracy**, plus a confusion breakdown by error type: right segment
  wrong ring, adjacent segment, missed dart, phantom dart.
- **Missed / extra dart rates**, since these break the game flow worst.
- **Latency**, measured in the browser on real devices — a mid-range Android
  phone and a laptop — split into settle, inference and total, reported as
  median and p95.
- **Abstention quality**: of the darts the model chose to ask about, how many
  would have been wrong? A good model is allowed to ask; it is not allowed to be
  confidently wrong.

The gate for wiring autoscoring into the game, rather than shadow mode:

| Gate | Threshold |
|---|---|
| PCS on held-out own-board set | ≥ 90 % |
| Confidently-wrong darts (high confidence, incorrect) | ≤ 1 % |
| Median total latency, dart landing → score shown, laptop hub | ≤ 1.0 s |
| p95 total latency, mid-range Android, solo mode | ≤ 2.0 s |

Until then, the camera runs in **shadow mode**: it proposes, the player scores
manually, and the app records how often the two agreed. That number, gathered
during real games, is the most honest evaluation available, and it costs the
player nothing.
