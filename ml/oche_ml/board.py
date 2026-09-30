"""
Board geometry, scoring, and the rectified view the model sees.

A port of `packages/core/src/board/geometry.ts`. The two must agree to the
millimetre, so `tests/test_board.py` checks this file against the scores the
app itself wrote into every exported label.

Board millimetres: origin at the centre of the bull, +x right, +y up.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

BULL_RADIUS = 6.35
OUTER_BULL_RADIUS = 15.9
TREBLE_INNER_RADIUS = 99.0
TREBLE_OUTER_RADIUS = 107.0
DOUBLE_INNER_RADIUS = 162.0
DOUBLE_OUTER_RADIUS = 170.0
BOARD_RADIUS = 225.5

SECTORS = (20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5)
SECTOR_ARC = 360.0 / len(SECTORS)


@dataclass(frozen=True)
class Hit:
    sector: int  # 1–20, or 0 for the bull rings and a miss
    ring: str  # 'miss' | 'single' | 'double' | 'treble' | 'outerBull' | 'bull'
    value: int

    def label(self) -> str:
        if self.ring == "miss":
            return "0"
        if self.ring == "bull":
            return "BULL"
        if self.ring == "outerBull":
            return "25"
        return {"single": "", "double": "D", "treble": "T"}[self.ring] + str(self.sector)


MISS = Hit(0, "miss", 0)
OUTER_BULL = Hit(0, "outerBull", 25)
BULL = Hit(0, "bull", 50)


def sector_at_angle(deg: float) -> int:
    """The sector an angle (anticlockwise from +x) falls in; 20 is centred on +y."""
    # JavaScript's Math.round rounds halves up; Python's round() rounds them to
    # even. A dart exactly on a wire is the one case where that shows.
    index = math.floor(((90.0 - deg) % 360.0) / SECTOR_ARC + 0.5) % len(SECTORS)
    return SECTORS[index]


def score_at(x: float, y: float) -> Hit:
    r = math.hypot(x, y)
    if r <= BULL_RADIUS:
        return BULL
    if r <= OUTER_BULL_RADIUS:
        return OUTER_BULL
    if r > DOUBLE_OUTER_RADIUS:
        return MISS
    sector = sector_at_angle(math.degrees(math.atan2(y, x)))
    if TREBLE_INNER_RADIUS <= r <= TREBLE_OUTER_RADIUS:
        return Hit(sector, "treble", sector * 3)
    if r >= DOUBLE_INNER_RADIUS:
        return Hit(sector, "double", sector * 2)
    return Hit(sector, "single", sector)


def wire_distance(x: float, y: float) -> float:
    """Millimetres to the nearest wire: the closer, the less a score can be trusted."""
    r = math.hypot(x, y)
    radial = min(
        abs(r - edge)
        for edge in (
            BULL_RADIUS,
            OUTER_BULL_RADIUS,
            TREBLE_INNER_RADIUS,
            TREBLE_OUTER_RADIUS,
            DOUBLE_INNER_RADIUS,
            DOUBLE_OUTER_RADIUS,
        )
    )
    if r <= OUTER_BULL_RADIUS or r > DOUBLE_OUTER_RADIUS:
        return radial
    # Degrees clockwise from the middle of the 20; the radial wires sit half a
    # sector either side of every sector's middle.
    angle = (90.0 - math.degrees(math.atan2(y, x))) % 360.0
    past_wire = (angle - SECTOR_ARC / 2) % SECTOR_ARC
    off = min(past_wire, SECTOR_ARC - past_wire)
    return min(radial, r * math.sin(math.radians(off)))


# ---- homographies ------------------------------------------------------------


def to_matrix(h: list[float] | np.ndarray) -> np.ndarray:
    """The app's Matrix3 is row-major, nine numbers."""
    return np.asarray(h, dtype=np.float64).reshape(3, 3)


def apply_h(h: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Applies a 3×3 homography to an (N, 2) array of points."""
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    homogeneous = np.concatenate([pts, np.ones((len(pts), 1))], axis=1) @ h.T
    return homogeneous[:, :2] / homogeneous[:, 2:3]


# ---- the rectified view ------------------------------------------------------
#
# The model never sees the photograph as taken. It sees the board warped to a
# canonical square: RECT_SIZE pixels across, covering ±RECT_HALF_MM of board in
# both directions, bull at the centre, +y (the 20) at the top. The browser's
# inference code has to produce exactly this view, so the spec is also written
# down in docs/03-autoscorer.md; change one, change both.

RECT_SIZE = 512
RECT_HALF_MM = 230.0  # a little past the board's edge, so a miss is still in view
MM_PER_PX = 2 * RECT_HALF_MM / RECT_SIZE

# The tip model's output grid: one cell per STRIDE rectified pixels.
STRIDE = 4
OUT_SIZE = RECT_SIZE // STRIDE


def board_to_rect() -> np.ndarray:
    """Board millimetres → rectified pixels (pixel centres at integer + 0.5)."""
    s = RECT_SIZE / (2 * RECT_HALF_MM)
    return np.array(
        [
            [s, 0.0, RECT_SIZE / 2],
            [0.0, -s, RECT_SIZE / 2],  # image y points down, board y up
            [0.0, 0.0, 1.0],
        ]
    )


def rect_to_board() -> np.ndarray:
    return np.linalg.inv(board_to_rect())


def image_to_rect(image_to_board: np.ndarray) -> np.ndarray:
    """The warp that turns a photograph into the rectified view."""
    return board_to_rect() @ image_to_board


def solve_homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least-squares DLT for four or more correspondences, normalised so h[2,2] = 1."""
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    rows = []
    for (x, y), (u, v) in zip(src, dst):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.asarray(rows))
    h = vt[-1].reshape(3, 3)
    return h / h[2, 2]
