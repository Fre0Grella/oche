"""
Heatmaps → dart tips, and tips → scores.

Written with NumPy on purpose: the browser will do the same few steps in
TypeScript on the two arrays the ONNX model returns, and this is the reference
it has to match.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .board import STRIDE, Hit, apply_h, rect_to_board, score_at, wire_distance

THRESHOLD = 0.3
MAX_DARTS = 6  # more than a visit: a dart left in from the last one still has to be seen


@dataclass
class Tip:
    x: float  # rectified pixels
    y: float
    confidence: float
    board: tuple[float, float]  # millimetres
    hit: Hit
    wire_mm: float


def peaks(heat: np.ndarray, threshold: float = THRESHOLD, k: int = MAX_DARTS) -> list[tuple[int, int, float]]:
    """Local maxima in a 3×3 window above the threshold, strongest first: (ix, iy, value)."""
    h = heat.squeeze()
    padded = np.pad(h, 1, constant_values=-np.inf)
    windows = np.lib.stride_tricks.sliding_window_view(padded, (3, 3))
    is_peak = (h >= windows.max(axis=(-1, -2))) & (h >= threshold)
    ys, xs = np.nonzero(is_peak)
    order = np.argsort(-h[ys, xs])[:k]
    return [(int(xs[i]), int(ys[i]), float(h[ys[i], xs[i]])) for i in order]


def decode(heat: np.ndarray, offset: np.ndarray, threshold: float = THRESHOLD, k: int = MAX_DARTS) -> list[Tip]:
    """`heat` is (1, S, S) or (S, S) after sigmoid, `offset` (2, S, S) in 0–1."""
    offset = offset.reshape(2, offset.shape[-2], offset.shape[-1])
    tips: list[Tip] = []
    for ix, iy, value in peaks(heat, threshold, k):
        x = (ix + float(offset[0, iy, ix])) * STRIDE
        y = (iy + float(offset[1, iy, ix])) * STRIDE
        bx, by = apply_h(rect_to_board(), np.array([[x, y]]))[0]
        tips.append(Tip(x, y, value, (float(bx), float(by)), score_at(bx, by), wire_distance(bx, by)))
    return tips
