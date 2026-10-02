import math

import cv2
import numpy as np
import pytest
import yaml

from oche_ml import sources
from oche_ml.board import SECTORS, apply_h, board_to_rect
from oche_ml.dartscribe import load_dartscribe, session_split, wire_angle
from oche_ml.dataset import TipDataset

from .conftest import TO_IMAGE, draw_board

BOARD = {
    "board_diameter": 450.0,
    "double_outer_diameter": 340.0,
    "double_bed_size": 10.0,
    "treble_outer_diameter": 214.0,
    "treble_bed_size": 10.0,
    "bull_outer_diameter": 34.0,
    "bull_inner_diameter": 14.0,
}
RADII = {"DoubleOuter": 170, "DoubleInner": 160, "TrebleOuter": 107, "TrebleInner": 97}


def _camera(name: str) -> dict:
    crossings = []
    for ring, radius in RADII.items():
        for i in range(20):
            wire = f"Between{SECTORS[i]}And{SECTORS[(i + 1) % 20]}"
            angle = wire_angle(wire)
            (x, y), = apply_h(TO_IMAGE, np.array([[radius * math.cos(angle), radius * math.sin(angle)]]))
            crossings.append({"ring_wire": ring, "radial_wire": wire, "position": {"x": float(x), "y": float(y)}})
    (bx, by), = apply_h(TO_IMAGE, np.zeros((1, 2)))
    return {"name": name, "resolution": {"width": 720, "height": 1280}, "board_points": {"bull": {"x": float(bx), "y": float(by)}, "crossings": crossings}}


def _throw(n: int, x_mm: float, y_mm: float) -> dict:
    # dartscribe writes positions in units of the double ring's radius
    return {"throw_number": n, "source": "detected", "hit": {"segment": 20, "multiplier": 1, "score": 20, "board_position": {"x": x_mm / 170, "y": y_mm / 170}}}


@pytest.fixture
def dartscribe_root(tmp_path):
    darts = [(0.0, 103.0), (20.0, 100.0), (-60.0, -60.0)]
    for session, throws in (("s-one", [_throw(i + 1, *d) for i, d in enumerate(darts)]), ("s-bounce", [_throw(1, 0, 50), {"throw_number": 2, "source": "detected"}])):
        group = tmp_path / "throws" / session / "g1"
        group.mkdir(parents=True)
        (group / "data.yaml").write_text(yaml.safe_dump({"board": BOARD, "cameras": [_camera("device-0"), _camera("device-1")], "dart_throws": throws}), encoding="utf-8")
        for n in range(len(throws) + 1):
            image = draw_board()
            for bx, by in darts[:n]:
                (ix, iy), = apply_h(TO_IMAGE, np.array([[bx, by]]))
                cv2.circle(image, (int(ix), int(iy)), 3, (0, 0, 0), -1)
            for device in ("device-0", "device-1"):
                cv2.imwrite(str(group / f"throw-{n}-{device}.jpg"), image)
    return tmp_path


def test_wire_names_map_to_board_angles():
    assert math.degrees(wire_angle("Between20And1")) == pytest.approx(81)
    assert math.degrees(wire_angle("Between5And20")) % 360 == pytest.approx(99)
    with pytest.raises(ValueError):
        wire_angle("Between20And18")


def test_loads_every_photograph_with_the_darts_it_shows(dartscribe_root):
    samples, counts = load_dartscribe(dartscribe_root)
    # 4 photographs (empty, then after each of 3 darts) × 2 cameras; the group
    # with a dart that has no position is left out whole.
    assert counts["kept"] == 8 and counts["dart without a position"] == 1
    assert sorted(len(s.tips_image) for s in samples) == [0, 0, 1, 1, 2, 2, 3, 3]
    assert {s.group for s in samples} == {"dartscribe:s-one"}
    assert max(s.meta["fit_px"] for s in samples) < 1e-6


def test_positions_are_read_in_double_ring_units_and_land_on_the_darts(dartscribe_root):
    samples, _ = load_dartscribe(dartscribe_root)
    index = next(i for i, s in enumerate(samples) if len(s.tips_image) == 3)
    rect, tips, _ = TipDataset(samples, train=False).rectify(index)
    expected = apply_h(board_to_rect(), np.array([[0, 103], [20, 100], [-60, -60]]))
    assert np.allclose(tips, expected, atol=1e-4)
    for x, y in tips:
        assert rect[int(round(y)), int(round(x))].mean() < 120  # the dark dot of the dart


def test_the_split_is_the_one_written_down(dartscribe_root):
    assert session_split("2fa0f210-aebd-4579-b3f0-0458a336718b") == "test"
    assert session_split("b19fc72c-aa2a-4ed4-816e-e47e310ebd1b") == "val"
    assert session_split("a session added later") == "train"
    samples, _ = load_dartscribe(dartscribe_root)
    parts = sources.split(samples)
    assert len(parts["train"]) == len(samples)
