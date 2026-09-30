"""
Reads the DeepDarts dataset (McNally et al., CVPRW 2021; IEEE DataPort,
DOI 10.21227/05e7-xs69, CC BY). Attribution: see ml/README.md.

Checked against the authors' code (github.com/wmcnally/deep-darts:
`dataset/annotate.py` transform() and get_dart_scores(), `dataloader.py`), but
not yet run on the files themselves, which need an IEEE login. Before training
on it, run

    python -m oche_ml.preview --deepdarts ml/data/deepdarts --out ml/runs/preview-dd

and look at the pictures: the drawn board must sit on the real wires with the
20 at the top, and every drawn tip must be on a dart. If the board is rotated
by a sector or mirrored, fix DEEPDARTS_CALIBRATION_BOARD below — nothing else.

What it expects, as distributed:

    <root>/labels.pkl                     a pandas DataFrame, one row per image:
                                          img_folder, img_name, bbox, xy
    <root>/cropped_images/800/<img_folder>/<img_name>

`xy` is a list of points normalised to the cropped image (0–1): the first four
are calibration points on the outer edge of the double ring, the rest are dart
tips. The calibration points are NOT oche's four: DeepDarts puts them on the
sector wires 9° either side of the vertical and horizontal — top between the
20 and the 5, bottom between the 3 and the 17, left between the 11 and the 8,
right between the 6 and the 13.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from .board import DOUBLE_OUTER_RADIUS, solve_homography
from .samples import Sample

_R = DOUBLE_OUTER_RADIUS
_S = math.sin(math.radians(9))
_C = math.cos(math.radians(9))

# In board millimetres (+y up), in DeepDarts' order.
DEEPDARTS_CALIBRATION_BOARD = np.array(
    [
        [-_R * _S, _R * _C],  # top, on the 5/20 wire
        [_R * _S, -_R * _C],  # bottom, on the 17/3 wire
        [-_R * _C, -_R * _S],  # left, on the 8/11 wire
        [_R * _C, _R * _S],  # right, on the 13/6 wire
    ]
)


def _find_labels(root: Path) -> Path:
    for candidate in (root / "labels.pkl", root / "dataset" / "labels.pkl"):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"no labels.pkl under {root}")


def _find_image(root: Path, folder: str, name: str, size: int) -> Path | None:
    for base in (root, root / "dataset"):
        for candidate in (
            base / "cropped_images" / str(size) / folder / name,
            base / "cropped_images" / folder / name,
            base / "images" / folder / name,
        ):
            if candidate.exists():
                return candidate
    return None


def load_deepdarts(root: str | Path, image_size: int = 800) -> tuple[list[Sample], dict[str, int]]:
    import pandas as pd  # only needed here

    root = Path(root)
    table = pd.read_pickle(_find_labels(root))
    counts = {"rows": len(table), "kept": 0, "missing image": 0, "bad calibration": 0}
    samples: list[Sample] = []

    for row in table.itertuples(index=False):
        folder, name = str(row.img_folder), str(row.img_name)
        image = _find_image(root, folder, name, image_size)
        if image is None:
            counts["missing image"] += 1
            continue

        xy = np.asarray(row.xy, dtype=np.float64).reshape(-1, 2) * image_size
        if len(xy) < 4 or not np.isfinite(xy[:4]).all():
            counts["bad calibration"] += 1
            continue
        calib, tips = xy[:4], xy[4:]

        to_board = solve_homography(calib, DEEPDARTS_CALIBRATION_BOARD)
        samples.append(
            Sample(
                key=f"deepdarts:{folder}/{name}",
                source="deepdarts",
                # One folder is one recording session: the same board, light and
                # camera. Splitting by folder keeps near-copies out of the test set.
                group=f"deepdarts:{folder}",
                image_path=str(image),
                image_to_board=to_board,
                calib_image=calib,
                calib_board=DEEPDARTS_CALIBRATION_BOARD.copy(),
                tips_image=tips,
                meta={"folder": folder},
            )
        )
        counts["kept"] += 1

    return samples, counts
