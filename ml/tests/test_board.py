import math

import numpy as np
import pytest

from treblewise_ml.board import (
    RECT_SIZE,
    apply_h,
    board_to_rect,
    image_to_rect,
    rect_to_board,
    score_at,
    solve_homography,
    wire_distance,
)
from treblewise_ml.deepdarts import DEEPDARTS_CALIBRATION_BOARD


@pytest.mark.parametrize(
    ("x", "y", "label"),
    [
        (0, 0, "BULL"),
        (0, 10, "25"),
        (0, 103, "T20"),
        (0, 166, "D20"),
        (0, 171, "0"),
        (103, 0, "T6"),
        (0, -50, "3"),
        (-166, 0, "D11"),
        # the 20 spans 81°–99°; just past 99° is the 5
        (math.cos(math.radians(99.5)) * 50, math.sin(math.radians(99.5)) * 50, "5"),
        (math.cos(math.radians(98.5)) * 50, math.sin(math.radians(98.5)) * 50, "20"),
    ],
)
def test_scores_match_the_app(x, y, label):
    assert score_at(x, y).label() == label


def test_rectified_view_puts_the_20_at_the_top_and_the_bull_in_the_middle():
    (cx, cy), (tx, ty) = apply_h(board_to_rect(), np.array([[0, 0], [0, 170]]))
    assert (cx, cy) == (RECT_SIZE / 2, RECT_SIZE / 2)
    assert tx == pytest.approx(RECT_SIZE / 2)
    assert ty < cy


def test_rect_round_trip():
    points = np.array([[12.5, -80], [-150, 30]])
    back = apply_h(rect_to_board(), apply_h(board_to_rect(), points))
    assert np.allclose(back, points)


def test_solve_homography_recovers_a_known_warp():
    truth = np.array([[0.9, 0.1, 300], [-0.05, 1.2, 500], [1e-4, 2e-4, 1]])
    board = np.array([[0, 170], [170, 0], [0, -170], [-170, 0]], dtype=float)
    image = apply_h(truth, board)
    to_board = solve_homography(image, board)
    probe = np.array([[40.0, -12.0]])
    assert np.allclose(apply_h(to_board, apply_h(truth, probe)), probe, atol=1e-6)
    assert np.allclose(apply_h(image_to_rect(to_board), apply_h(truth, probe)), apply_h(board_to_rect(), probe), atol=1e-6)


def test_wire_distance():
    assert wire_distance(0, 50) == pytest.approx(50 * math.sin(math.radians(9)))  # middle of the 20
    assert wire_distance(0, 103) == pytest.approx(4)  # middle of the treble bed
    wire = math.radians(81)
    assert wire_distance(60 * math.cos(wire), 60 * math.sin(wire)) == pytest.approx(0, abs=1e-9)


def test_deepdarts_calibration_points_sit_on_the_double_ring_on_sector_wires():
    for x, y in DEEPDARTS_CALIBRATION_BOARD:
        assert math.hypot(x, y) == pytest.approx(170)
        assert wire_distance(x * 0.9, y * 0.9) == pytest.approx(0, abs=1e-6)  # on a radial wire
