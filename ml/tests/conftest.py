import json
import zipfile
from pathlib import Path

import cv2
import numpy as np
import pytest

from oche_ml.board import apply_h, score_at, solve_homography
from oche_ml.oche_export import CALIBRATION_BOARD

REPO = Path(__file__).resolve().parents[2]

# A camera that sees the board from below and to the left, like a phone on a stand.
TO_IMAGE = np.array([[0.9, -0.2, 360.0], [0.05, -1.1, 640.0], [1e-4, -3e-4, 1.0]])


def _hit(x, y):
    h = score_at(x, y)
    return {"sector": h.sector, "ring": h.ring, "value": h.value}


def draw_board(width=720, height=1280) -> np.ndarray:
    """A crude board: rings and a dark dart tip at each position, enough to warp and look at."""
    image = np.full((height, width, 3), 200, np.uint8)
    angles = np.linspace(0, 2 * np.pi, 120)
    for radius in (170, 162, 107, 99, 15.9, 6.35):
        ring = apply_h(TO_IMAGE, np.stack([radius * np.cos(angles), radius * np.sin(angles)], 1))
        cv2.polylines(image, [ring.round().astype(np.int32)], True, (40, 40, 40), 2)
    return image


@pytest.fixture
def synthetic_export(tmp_path: Path) -> Path:
    """An export zip in exactly the app's format, from a known camera: one visit of three darts."""
    to_board = solve_homography(apply_h(TO_IMAGE, CALIBRATION_BOARD), CALIBRATION_BOARD)
    darts_board = [(0.0, 103.0), (20.0, 100.0), (-60.0, -60.0)]
    frames = []
    archive = tmp_path / "export.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for n in range(1, 4):  # the same visit photographed after each dart
            image = draw_board()
            darts = []
            for bx, by in darts_board[:n]:
                (ix, iy), = apply_h(TO_IMAGE, np.array([[bx, by]]))
                cv2.circle(image, (int(ix), int(iy)), 3, (0, 0, 0), -1)
                darts.append({"img": {"x": ix, "y": iy}, "board": {"x": bx, "y": by}, "hit": _hit(bx, by)})
            ok, jpeg = cv2.imencode(".jpg", image)
            assert ok
            z.writestr(f"frames/f{n}.jpg", jpeg.tobytes())
            frames.append(
                {
                    "id": f"f{n}",
                    "ts": 1_000_000 + n * 20_000,
                    "source": "lab",
                    "file": f"frames/f{n}.jpg",
                    "width": 720,
                    "height": 1280,
                    "calibration": {
                        "imagePoints": [{"x": x, "y": y} for x, y in apply_h(TO_IMAGE, CALIBRATION_BOARD)],
                        "toImage": TO_IMAGE.flatten().tolist(),
                        "toBoard": to_board.flatten().tolist(),
                        "error": 0,
                    },
                    "darts": darts,
                }
            )
        # a game report with a dart left unplaced: must be skipped
        incomplete = json.loads(json.dumps(frames[1]))
        incomplete.update(id="g1", source="game", matchId="m1", reported={"hits": ["T20", "?", "?"], "dartIds": ["a", "b", "c"], "source": "manual"})
        frames.append(incomplete)
        z.writestr("labels.json", json.dumps({"version": 1, "exportedAt": 0, "frames": frames}))
    return archive


def real_exports() -> list[Path]:
    return sorted(REPO.glob("oche-captures-*.zip")) + sorted((REPO / "ml" / "data" / "oche").glob("*.zip"))
