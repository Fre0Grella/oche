# tips-v3

Dart-tip detector for the oche autoscorer (model B, docs/03-autoscorer.md).

| | |
|---|---|
| File | `tips-v3.onnx` (5.9 MB) |
| SHA-256 | `7346c2bcf189cb21415f26e57739568690af403c5668020ff07c841e682da136` |
| Backbone | `mobilenetv4_conv_small.e2400_r224_in1k` (timm, ImageNet-1k weights, Apache-2.0) |
| Input | `image` float32 [1,3,512,512], RGB 0–1, rectified board, ±230 mm, 0.898 mm/px, 20 at the top |
| Outputs | `heatmap` [1,1,128,128], `offset` [1,2,128,128]; tip = (cell + offset) × 4 |
| Trained | epoch 20, initialised from sideview/best.pt |
| ONNX vs PyTorch | max difference 8.9e-07 |

## Training data

- oche exports: `oche-captures-2026-10-03.zip`, 62 photographs of the target board (21 visits, 123 darts), all in training (see the gate)
- DeepDarts: yes — McNally, Vats, Wong, McPhee, *DeepDarts: Modeling Keypoints as Objects for Automatic Scorekeeping in Darts using a Single Camera*, CVPRW 2021. IEEE DataPort, DOI 10.21227/05e7-xs69, CC BY.
- dartscribe: yes — Ercan Akyürek, *dartscribe* dataset, Hugging Face `geforcefan/dartscribe`, CC BY-SA 4.0 (attribution and share-alike).

## Validation when the checkpoint was picked

```json
{
  "images": 273,
  "pcs": 0.8058608058608059,
  "dart_accuracy": 0.87468671679198,
  "missed_rate": 0.09774436090225563,
  "phantom_rate": 0.09022556390977443,
  "confidently_wrong": 0.011494252873563218,
  "error_mm_median": 1.991305090835571,
  "error_mm_p95": 7.379876646407653,
  "kinds": {
    "missed dart": 39,
    "phantom dart": 36,
    "right": 349,
    "neighbouring segment": 2,
    "right segment, wrong ring": 7,
    "other": 2
  }
}
```

## The gate

Not evaluated: no held-out photographs of the target board. Every visit in
the export had a proposal from tips-v2 in it, so the split puts all of them in
training (a model must not be graded on labels it proposed). No visit was
blind because of a bug in the capture lab, fixed in 2823c8d: the blind roll was
repeated on every photograph of an empty board. This model may propose darts
in the capture lab; it may not score games.

## Held-out side-view test

dartscribe sessions no training run saw (777 photographs), against tips-v2.

| | tips-v2 | tips-v3 |
|---|---|---|
| Photographs exactly right | 64.4 % | 67.3 % |
| Darts scored right | 81.6 % | 81.8 % |
| Missed darts | 13.7 % | 14.0 % |
| Phantom darts | 13.8 % | 14.0 % |
| Confidently wrong | 2.2 % | 1.7 % |
| Tip error, median / p95 | 1.71 / 6.86 mm | 1.70 / 6.79 mm |

## On the target board (trained on: not a test)

The 62 photographs above, replayed through the capture lab's proposal rule:
the darts already marked on the visit's previous photograph each claim their
nearest detection within 10 mm, and the strongest detection left is the one
proposal. These are photographs tips-v3 trained on, so its column is
optimistic; tips-v2 never saw them, but some of their labels are its own
accepted proposals, which flatters it.

| Proposal on the new dart | tips-v2 | tips-v3 |
|---|---|---|
| Right score | 35 (56.5 %) | 53 (85.5 %) |
| On the dart, wrong score | 3 | 4 |
| Phantom, far from the new dart | 15 (24.2 %) | 3 (4.8 %) |
| Nothing proposed | 9 | 2 |

By dart in the visit, right / phantom: tips-v2 15/3, 9/8, 11/4; tips-v3
19/0, 18/1, 16/2 (of 21, 21, 20).
