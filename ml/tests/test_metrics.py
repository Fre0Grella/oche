import numpy as np

from oche_ml.board import score_at
from oche_ml.decode import Tip
from oche_ml.metrics import Tally


def tip(x, y, confidence=0.9):
    return Tip(0, 0, confidence, (x, y), score_at(x, y), 5.0)


def test_a_perfect_visit_counts_as_correct():
    tally = Tally()
    tally.add(np.array([[0, 103], [0, 50]]), [tip(0.5, 103), tip(0, 51)])
    s = tally.summary()
    assert s["pcs"] == 1 and s["dart_accuracy"] == 1 and s["confidently_wrong"] == 0


def test_a_missed_dart_and_a_confident_wrong_ring_are_both_reported():
    tally = Tally()
    # truth: T20 and a 3; model: a single 20 (wrong ring, confident), missed the 3
    tally.add(np.array([[0, 103], [0, -50]]), [tip(0, 110)])
    s = tally.summary()
    assert s["pcs"] == 0
    assert s["missed_rate"] == 0.5
    assert s["kinds"]["right segment, wrong ring"] == 1
    assert s["confidently_wrong"] > 0
