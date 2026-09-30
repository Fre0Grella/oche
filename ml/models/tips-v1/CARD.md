# tips-v1

Dart-tip detector for the oche autoscorer (model B, docs/03-autoscorer.md).

| | |
|---|---|
| File | `tips-v1.onnx` (5.9 MB) |
| SHA-256 | `5eb4e560813b0f1809f9d95a56a41981d0e4a95c7fa935b58fef43d9b88cf4e0` |
| Backbone | `mobilenetv4_conv_small.e2400_r224_in1k` (timm, ImageNet-1k weights, Apache-2.0) |
| Input | `image` float32 [1,3,512,512], RGB 0–1, rectified board, ±230 mm, 0.898 mm/px, 20 at the top |
| Outputs | `heatmap` [1,1,128,128], `offset` [1,2,128,128]; tip = (cell + offset) × 4 |
| Trained | epoch 38 |
| ONNX vs PyTorch | max difference 1.0e-06 |

## Training data

- oche exports: none
- DeepDarts: yes — McNally, Vats, Wong, McPhee, *DeepDarts: Modeling Keypoints as Objects for Automatic Scorekeeping in Darts using a Single Camera*, CVPRW 2021. IEEE DataPort, DOI 10.21227/05e7-xs69, CC BY.

## Validation when the checkpoint was picked

```json
{
  "images": 837,
  "pcs": 0.8303464755077659,
  "dart_accuracy": 0.9407364787111623,
  "missed_rate": 0.023590333716915997,
  "phantom_rate": 0.05005753739930955,
  "confidently_wrong": 0.025753424657534246,
  "error_mm_median": 1.1569666428445402,
  "error_mm_p95": 3.530820947857235,
  "kinds": {
    "right": 1635,
    "missed dart": 41,
    "phantom dart": 87,
    "neighbouring segment": 20,
    "right segment, wrong ring": 28,
    "other": 14
  }
}
```

## The gate

Not evaluated: no held-out photographs of the target board were used. This model may propose darts in the capture lab; it may not score games.

## Held-out DeepDarts test

`python -m oche_ml.evaluate --checkpoint runs/pretrain/best.pt --deepdarts data/deepdarts`,
on the DeepDarts recording sessions no training run saw (4740 photographs):

| | |
|---|---|
| PCS, the visit's total exactly right | 81.2 % |
| Darts scored right | 94.8 % |
| Missed darts | 1.7 % |
| Phantom darts | 6.8 % |
| Confidently wrong | 2.5 % |
| Tip error, median / p95 | 1.16 mm / 3.66 mm |

These are DeepDarts' boards and cameras, mostly face-on. On an oche board
seen from the side it will do worse; that is what fine-tuning is for.
