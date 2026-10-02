# tips-v2

Dart-tip detector for the oche autoscorer (model B, docs/03-autoscorer.md).

| | |
|---|---|
| File | `tips-v2.onnx` (5.9 MB) |
| SHA-256 | `c96758492c2f982a8e1a8bc7658895aabc17a4c7ff70b306c7dadd131c7832b3` |
| Backbone | `mobilenetv4_conv_small.e2400_r224_in1k` (timm, ImageNet-1k weights, Apache-2.0) |
| Input | `image` float32 [1,3,512,512], RGB 0–1, rectified board, ±230 mm, 0.898 mm/px, 20 at the top |
| Outputs | `heatmap` [1,1,128,128], `offset` [1,2,128,128]; tip = (cell + offset) × 4 |
| Trained | epoch 38, initialised from pretrain/best.pt |
| ONNX vs PyTorch | max difference 8.6e-07 |

## Training data

- oche exports: none
- DeepDarts: yes — McNally, Vats, Wong, McPhee, *DeepDarts: Modeling Keypoints as Objects for Automatic Scorekeeping in Darts using a Single Camera*, CVPRW 2021. IEEE DataPort, DOI 10.21227/05e7-xs69, CC BY.
- dartscribe: yes — Ercan Akyürek, *dartscribe* dataset, Hugging Face `geforcefan/dartscribe`, CC BY-SA 4.0 (attribution and share-alike).

## Validation when the checkpoint was picked

```json
{
  "images": 273,
  "pcs": 0.717948717948718,
  "dart_accuracy": 0.8897243107769424,
  "missed_rate": 0.07769423558897243,
  "phantom_rate": 0.14536340852130325,
  "confidently_wrong": 0.0175054704595186,
  "error_mm_median": 1.8848378235957346,
  "error_mm_p95": 8.22366324517592,
  "kinds": {
    "missed dart": 31,
    "phantom dart": 58,
    "right": 355,
    "neighbouring segment": 3,
    "right segment, wrong ring": 7,
    "other": 3
  }
}
```

## The gate

Not evaluated: no held-out photographs of the target board were used. This model may propose darts in the capture lab; it may not score games.

## Held-out side-view test

dartscribe sessions no training run saw (777 photographs: three ring
cameras about 40 cm from the bull, and a phone on a stand about 2 m back).
tips-v1, trained on face-on DeepDarts alone, is shown for comparison.

| | tips-v1 | tips-v2 |
|---|---|---|
| Photographs exactly right | 0.5 % | 64.4 % |
| Darts scored right | 23.2 % | 81.6 % |
| Missed darts | 70.5 % | 13.7 % |
| Phantom darts | 165.7 % | 13.8 % |
| Confidently wrong | 5.7 % | 2.2 % |
| Tip error, median / p95 | 5.91 / 13.70 mm | 1.71 / 6.86 mm |

By camera, tips-v2: ring cameras (717 photographs) 69.6 % exactly right,
9.3 % phantoms. Phone on a stand (60 photographs): 84.4 % of darts
right and 7.8 % missed, with the detections on the tips rather than the
flights, but 66.7 % phantoms, nearly all one fixed object at the board's edge,
so only 1.7 % of those photographs come out exactly right.

Not checked: how much face-on accuracy it kept (DeepDarts was not on the
machine at export), and anything on the board this app is used with, which is
about 45° off face-on and 73 cm from the bull, between the two datasets.
