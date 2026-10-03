"""
Reads the dartscribe dataset (Ercan Akyürek; Hugging Face,
geforcefan/dartscribe, CC BY-SA 4.0). Attribution: see ml/README.md.

Why it is here: DeepDarts is shot face-on (tilt 2° in D1, at most 29° in D2),
where a dart's flight sits over its tip. A model trained on it marks the flight
as the tip on a side camera (issue #5). dartscribe is the opposite end: three
cameras on a ring around the board, about 40 cm from the bull and tilted 34–56°,
where the tip is the board end of a long streak and the flight is far away.

What it holds, as downloaded (`huggingface_hub.snapshot_download`):

    throws/<session>/<group>/data.yaml
    throws/<session>/<group>/throw-<n>-device-<i>.jpg

`throw-0` is the empty board, `throw-<n>` the board after dart n, once per
camera. data.yaml gives, for each camera, the bull and the 80 crossings of the
ring wires and radial wires in pixels; and for each dart its segment,
multiplier and position on the board.

Two things that are easy to get wrong:

- positions are in units of the double ring's outer radius (1.0 = 170 mm), +y
  up, not in metres;
- most positions (`source: detected`) were placed by dartscribe's own
  three-camera triangulation, not by a person; a few are `corrected`. Checked
  on a sample: the positions land on the tips, and every stated score agrees
  with its position.

A group with a dart that has no position (a bounce-out, presumably) is left out
whole: which later photographs still show that dart is not recorded.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from .board import DOUBLE_OUTER_RADIUS, SECTORS, apply_h, solve_homography
from .capture_export import CALIBRATION_BOARD
from .samples import Sample

# Which sessions are held out. A hash of the session name, as used elsewhere,
# happened to put the largest session (a quarter of the data) in the test set,
# which a dataset this small cannot afford. So the split is written down: one
# session with the phone-on-a-stand camera and two ring-only sessions to test
# on, two small ones to validate on, and everything else, including any session
# added to the dataset later, to train on.
TEST_SESSIONS = {
    "2fa0f210-aebd-4579-b3f0-0458a336718b",  # four cameras: the ring, and a phone about 2 m back
    "10214cc2-b1a4-4392-b50b-13dc54f0424e",
    "975ec190-05c8-42dd-b0cc-4f8245556316",
}
VAL_SESSIONS = {
    "b19fc72c-aa2a-4ed4-816e-e47e310ebd1b",
    "f37ba759-7841-478c-b246-367745d7b985",
}


def session_split(session: str) -> str:
    return "test" if session in TEST_SESSIONS else "val" if session in VAL_SESSIONS else "train"


RING_KEYS = {
    "DoubleOuter": ("double_outer_diameter", None),
    "DoubleInner": ("double_outer_diameter", "double_bed_size"),
    "TrebleOuter": ("treble_outer_diameter", None),
    "TrebleInner": ("treble_outer_diameter", "treble_bed_size"),
}


def wire_angle(name: str) -> float:
    """'Between20And1' → the board angle of the wire between the 20 and the 1, in radians."""
    first, second = name.removeprefix("Between").split("And")
    index = SECTORS.index(int(first))
    if SECTORS[(index + 1) % len(SECTORS)] != int(second):
        raise ValueError(f"not neighbouring sectors: {name}")
    return math.radians(90 - (index + 0.5) * 360 / len(SECTORS))


def ring_radius(board: dict, ring: str) -> float:
    outer, bed = RING_KEYS[ring]
    return board[outer] / 2 - (board[bed] if bed else 0.0)


def camera_to_board(board: dict, camera: dict) -> tuple[np.ndarray, float]:
    """Image pixels → board mm from the 80 crossings, and the fit's RMS error in pixels."""
    crossings = camera["board_points"]["crossings"]
    image = np.array([[c["position"]["x"], c["position"]["y"]] for c in crossings], dtype=np.float64)
    points = []
    for c in crossings:
        radius, angle = ring_radius(board, c["ring_wire"]), wire_angle(c["radial_wire"])
        points.append([radius * math.cos(angle), radius * math.sin(angle)])
    points = np.asarray(points)
    to_board = solve_homography(image, points)
    to_image = np.linalg.inv(to_board)
    rms = float(np.sqrt(((apply_h(to_image, points) - image) ** 2).sum(axis=1).mean()))
    return to_board, rms


def load_dartscribe(root: str | Path, max_fit_px: float = 3.0) -> tuple[list[Sample], dict[str, int]]:
    import yaml  # only needed here

    root = Path(root)
    counts = {"groups": 0, "kept": 0, "empty boards": 0, "dart without a position": 0, "poor calibration": 0, "missing image": 0}
    samples: list[Sample] = []

    for label in sorted(root.glob("throws/*/*/data.yaml")):
        counts["groups"] += 1
        data = yaml.safe_load(label.read_text(encoding="utf-8"))
        throws = sorted(data.get("dart_throws") or [], key=lambda t: t["throw_number"])
        if any("hit" not in t for t in throws):
            counts["dart without a position"] += 1
            continue
        scale = data["board"]["double_outer_diameter"] / 2
        if abs(scale - DOUBLE_OUTER_RADIUS) > 1:
            raise ValueError(f"{label}: a board with a {scale} mm double ring is not a standard board")
        tips_board = np.array(
            [[t["hit"]["board_position"]["x"] * scale, t["hit"]["board_position"]["y"] * scale] for t in throws],
            dtype=np.float64,
        ).reshape(-1, 2)
        session, group = label.parts[-3], label.parts[-2]

        for camera in data["cameras"]:
            to_board, rms = camera_to_board(data["board"], camera)
            if rms > max_fit_px:
                counts["poor calibration"] += 1
                continue
            to_image = np.linalg.inv(to_board)
            # The four landmarks treblewise calibrates with, as this camera sees them:
            # training jitters these, as a person dragging markers would.
            calib_image = apply_h(to_image, CALIBRATION_BOARD)

            for n in range(len(throws) + 1):  # photograph n shows darts 1..n; 0 is the empty board
                image = label.parent / f"throw-{n}-{camera['name']}.jpg"
                if not image.exists():
                    counts["missing image"] += 1
                    continue
                in_board = tips_board[:n]
                samples.append(
                    Sample(
                        key=f"dartscribe:{session}/{group}/{image.name}",
                        source="dartscribe",
                        # One session is one evening on one board with the cameras
                        # fixed: its photographs are near-copies, and the three
                        # cameras of a visit show the very same darts.
                        group=f"dartscribe:{session}",
                        image_path=str(image),
                        image_to_board=to_board,
                        calib_image=calib_image,
                        calib_board=CALIBRATION_BOARD.copy(),
                        tips_image=apply_h(to_image, in_board) if n else np.zeros((0, 2)),
                        meta={
                            "session": session,
                            "camera": camera["name"],
                            # The ring cameras are 1280×720, 40 cm from the bull; the
                            # portrait one is a phone on a stand, much further back.
                            "camera_kind": "phone" if camera["resolution"]["height"] > camera["resolution"]["width"] else "ring",
                            "darts": n,
                            "fit_px": rms,
                            "split": session_split(session),
                        },
                    )
                )
                counts["kept"] += 1
                counts["empty boards"] += n == 0

    return samples, counts
