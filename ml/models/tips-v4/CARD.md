# tips-v4

Dart-tip detector for the treblewise autoscorer (model B, docs/03-autoscorer.md).

| | |
|---|---|
| File | `tips-v4.onnx` (5.9 MB) |
| SHA-256 | `b0a8de09e35b52fb835418ab45f658a0f714125b41369cbeb56ad7a3330947fc` |
| Backbone | `mobilenetv4_conv_small.e2400_r224_in1k` (timm, ImageNet-1k weights, Apache-2.0) |
| Input | `image` float32 [1,3,512,512], RGB 0–1, rectified board, ±230 mm, 0.898 mm/px, 20 at the top |
| Outputs | `heatmap` [1,1,128,128], `offset` [1,2,128,128]; tip = (cell + offset) × 4 |
| Trained | epoch 36, initialised from sideview/best.pt |
| ONNX vs PyTorch | max difference 9.5e-07 |

## Training data

- treblewise exports: oche-captures-2026-10-03.zip, treblewise-captures-2026-10-03.zip
- DeepDarts: yes — McNally, Vats, Wong, McPhee, *DeepDarts: Modeling Keypoints as Objects for Automatic Scorekeeping in Darts using a Single Camera*, CVPRW 2021. IEEE DataPort, DOI 10.21227/05e7-xs69, CC BY.
- dartscribe: yes — Ercan Akyürek, *dartscribe* dataset, Hugging Face `geforcefan/dartscribe`, CC BY-SA 4.0 (attribution and share-alike).

## Validation when the checkpoint was picked

```json
{
  "images": 12,
  "pcs": 0.4166666666666667,
  "dart_accuracy": 0.7083333333333334,
  "missed_rate": 0.16666666666666666,
  "phantom_rate": 0.25,
  "confidently_wrong": 0.1,
  "error_mm_median": 2.489754625612286,
  "error_mm_p95": 6.702147124664343,
  "kinds": {
    "right": 17,
    "missed dart": 4,
    "phantom dart": 6,
    "neighbouring segment": 3
  }
}
```

## The gate

Paste `python -m treblewise_ml.evaluate` on the held-out test split here before this model scores games.
