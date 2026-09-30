"""
Draws what the model will be shown, for a person to check by eye.

    python -m oche_ml.preview --oche oche-captures.zip --out ml/runs/preview
    python -m oche_ml.preview --deepdarts ml/data/deepdarts --out ml/runs/preview-dd --limit 24

Each picture is the rectified board with the board's wires drawn over it from
the spec, and every labelled tip as a cross with its score. If the drawn wires
are not on the real ones, the homography or the calibration points are wrong,
and training on it would teach nonsense. Add --checkpoint to draw the model's
tips as well (circles, with confidence).
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import cv2
import numpy as np

from . import sources
from .board import (
    BULL_RADIUS,
    DOUBLE_INNER_RADIUS,
    DOUBLE_OUTER_RADIUS,
    OUTER_BULL_RADIUS,
    SECTOR_ARC,
    SECTORS,
    TREBLE_INNER_RADIUS,
    TREBLE_OUTER_RADIUS,
    apply_h,
    board_to_rect,
    score_at,
)
from .dataset import TipDataset, to_tensor


def draw_wires(image: np.ndarray) -> None:
    to_rect = board_to_rect()
    colour = (80, 255, 80)
    for radius in (BULL_RADIUS, OUTER_BULL_RADIUS, TREBLE_INNER_RADIUS, TREBLE_OUTER_RADIUS, DOUBLE_INNER_RADIUS, DOUBLE_OUTER_RADIUS):
        angles = np.linspace(0, 2 * math.pi, 180)
        ring = apply_h(to_rect, np.stack([radius * np.cos(angles), radius * np.sin(angles)], 1))
        cv2.polylines(image, [ring.round().astype(np.int32)], True, colour, 1, cv2.LINE_AA)
    for i, sector in enumerate(SECTORS):
        wire = math.radians(90 - i * SECTOR_ARC + SECTOR_ARC / 2)
        a, b = apply_h(to_rect, np.array([[OUTER_BULL_RADIUS * math.cos(wire), OUTER_BULL_RADIUS * math.sin(wire)], [DOUBLE_OUTER_RADIUS * math.cos(wire), DOUBLE_OUTER_RADIUS * math.sin(wire)]]))
        cv2.line(image, tuple(a.round().astype(int)), tuple(b.round().astype(int)), colour, 1, cv2.LINE_AA)
        middle = math.radians(90 - i * SECTOR_ARC)
        (x, y), = apply_h(to_rect, np.array([[190 * math.cos(middle), 190 * math.sin(middle)]]))
        cv2.putText(image, str(sector), (int(x) - 8, int(y) + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, colour, 1, cv2.LINE_AA)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sources.add_arguments(parser)
    parser.add_argument("--out", required=True)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--checkpoint", default=None)
    args = parser.parse_args()

    samples = sources.load(args)[: args.limit]
    dataset = TipDataset(samples, train=False)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    model = device = None
    if args.checkpoint:
        from .decode import decode
        from .train import load_checkpoint, pick_device

        device = pick_device()
        model = load_checkpoint(args.checkpoint, device).eval()

    for index, sample in enumerate(samples):
        rect, tips, _ = dataset.rectify(index)
        canvas = rect.copy()
        draw_wires(canvas)
        board = apply_h(np.linalg.inv(board_to_rect()), tips) if len(tips) else []
        for (x, y), (bx, by) in zip(tips, board):
            cv2.drawMarker(canvas, (int(round(x)), int(round(y))), (0, 0, 255), cv2.MARKER_CROSS, 14, 2)
            cv2.putText(canvas, score_at(bx, by).label(), (int(x) + 8, int(y) - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)
        if model is not None:
            import torch

            with torch.no_grad():
                heat, offset = model(to_tensor(rect).unsqueeze(0).to(device))
            for tip in decode(heat[0].cpu().numpy(), offset[0].cpu().numpy()):
                cv2.circle(canvas, (int(round(tip.x)), int(round(tip.y))), 9, (255, 200, 0), 2, cv2.LINE_AA)
                cv2.putText(canvas, f"{tip.hit.label()} {tip.confidence:.2f}", (int(tip.x) + 10, int(tip.y) + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 200, 0), 1, cv2.LINE_AA)
        name = sample.key.replace(":", "_").replace("/", "_")
        cv2.imwrite(str(out / f"{index:03d}_{name}.jpg"), canvas)

    print(f"wrote {len(samples)} previews to {out}")


if __name__ == "__main__":
    main()
