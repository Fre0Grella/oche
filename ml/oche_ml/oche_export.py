"""
Reads the zip the capture lab exports (`apps/web/src/storage/frames.ts`).

Every frame is checked on the way in, because a label that is quietly wrong
teaches a model something wrong and nothing downstream would notice:

- the frame's own homography must take each dart's pixel position to its
  board position (catches a matrix read in the wrong order);
- the score written by the app must be what `board.score_at` says (catches the
  Python port drifting from the TypeScript);
- a frame from a game where a dart was left unplaced is skipped: it has a dart
  in the picture with no label on it.
"""

from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .board import DOUBLE_OUTER_RADIUS, apply_h, score_at, to_matrix
from .samples import Sample

# The four landmarks the user drags onto the board, in this order
# (packages/core/src/vision/calibration.ts): the outer edge of the double ring
# on the centre lines of the 20, 6, 3 and 11.
CALIBRATION_BOARD = np.array(
    [[0, DOUBLE_OUTER_RADIUS], [DOUBLE_OUTER_RADIUS, 0], [0, -DOUBLE_OUTER_RADIUS], [-DOUBLE_OUTER_RADIUS, 0]],
    dtype=np.float64,
)

# A new visit starts after a pause this long, even with darts still carried.
VISIT_GAP_MS = 5 * 60 * 1000


@dataclass
class LoadReport:
    frames: int = 0
    kept: int = 0
    skipped: dict[str, int] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)

    def skip(self, reason: str, detail: str | None = None) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1
        if detail:
            self.problems.append(detail)


def _read_labels(path: Path) -> tuple[dict, str]:
    """labels.json and how to address images, for a zip or an unzipped folder."""
    if path.is_dir():
        return json.loads((path / "labels.json").read_text(encoding="utf-8")), str(path)
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("labels.json")), f"{path}::"


def _image_path(base: str, file: str) -> str:
    return base + file if base.endswith("::") else str(Path(base) / file)


def _visit_groups(frames: list[dict]) -> dict[str, str]:
    """
    Frame id → group. Lab frames of one visit are near-copies (the same darts,
    one more each time), so a visit is the unit that goes to train or test.
    Game frames are grouped by match, for the same reason.
    """
    groups: dict[str, str] = {}
    current: str | None = None
    previous: dict | None = None
    for frame in sorted(frames, key=lambda f: f["ts"]):
        if frame.get("source") == "game" and frame.get("matchId"):
            groups[frame["id"]] = f"oche:match:{frame['matchId']}"
            continue
        starts_visit = (
            previous is None
            or current is None
            or frame["ts"] - previous["ts"] > VISIT_GAP_MS
            or len(frame["darts"]) <= len(previous["darts"])
            or frame["calibration"]["imagePoints"] != previous["calibration"]["imagePoints"]
        )
        if starts_visit:
            current = f"oche:visit:{frame['id']}"
        groups[frame["id"]] = current  # type: ignore[assignment]
        previous = frame
    return groups


def load_export(path: str | Path, tolerance_mm: float = 0.05) -> tuple[list[Sample], LoadReport]:
    path = Path(path)
    labels, base = _read_labels(path)
    if labels.get("version") != 1:
        raise ValueError(f"{path}: labels.json version {labels.get('version')!r}, this reader knows version 1")

    report = LoadReport(frames=len(labels["frames"]))
    groups = _visit_groups(labels["frames"])
    samples: list[Sample] = []

    for frame in labels["frames"]:
        darts = frame.get("darts", [])
        reported = frame.get("reported")
        if reported and len(reported.get("dartIds", [])) > len(darts):
            report.skip("dart left unplaced in a game report")
            continue
        if not darts:
            report.skip("no darts marked")
            continue

        calibration = frame["calibration"]
        to_board = to_matrix(calibration["toBoard"])
        tips = np.array([[d["img"]["x"], d["img"]["y"]] for d in darts], dtype=np.float64)
        boards = np.array([[d["board"]["x"], d["board"]["y"]] for d in darts], dtype=np.float64)

        error = float(np.abs(apply_h(to_board, tips) - boards).max())
        if error > tolerance_mm:
            report.skip("homography disagrees with the labels", f"{frame['id']}: {error:.3f} mm")
            continue

        wrong = [
            (d["hit"], score_at(*b))
            for d, b in zip(darts, boards)
            if (d["hit"]["ring"], d["hit"]["value"]) != (score_at(*b).ring, score_at(*b).value)
        ]
        if wrong:
            report.skip("score disagrees with board.score_at", f"{frame['id']}: {wrong}")
            continue

        samples.append(
            Sample(
                key=f"oche:{frame['id']}",
                source="oche",
                group=groups[frame["id"]],
                image_path=_image_path(base, frame["file"]),
                image_to_board=to_board,
                calib_image=np.array([[p["x"], p["y"]] for p in calibration["imagePoints"]], dtype=np.float64),
                calib_board=CALIBRATION_BOARD.copy(),
                tips_image=tips,
                meta={
                    "ts": frame["ts"],
                    "width": frame["width"],
                    "height": frame["height"],
                    "origin": frame["source"],
                    # The model proposed on this photograph (let stand or
                    # corrected, a person saw its answer): fine to learn from,
                    # never fine to test on.
                    "model_involved": bool(frame.get("model")) or any(d.get("by") == "model" for d in darts),
                },
            )
        )
        report.kept += 1

    return samples, report
