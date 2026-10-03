"""
The numbers in docs/03-autoscorer.md, "Evaluation and the gate".

- PCS, percent correct score: the photograph's total is exactly right. The
  number a player feels.
- per-dart accuracy, and what kind of wrong: right segment wrong ring,
  neighbouring segment, missed dart, phantom dart.
- confidently wrong: a dart scored wrong with confidence above the bar. The
  model is allowed to ask; it is not allowed to be sure and wrong.
- localisation error in millimetres, which is what improves first.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .board import SECTORS, Hit, score_at
from .decode import Tip

MATCH_MM = 15.0  # a prediction further than this from every real dart is a phantom
CONFIDENT = 0.7

GATE = {"pcs": 0.90, "confidently_wrong": 0.01}


def _kind(truth: Hit, guess: Hit) -> str:
    if truth == guess:
        return "right"
    if truth.sector == guess.sector and truth.sector != 0:
        return "right segment, wrong ring"
    if truth.sector and guess.sector:
        i, j = SECTORS.index(truth.sector), SECTORS.index(guess.sector)
        if min((i - j) % 20, (j - i) % 20) == 1:
            return "neighbouring segment"
    return "other"


@dataclass
class Tally:
    images: int = 0
    correct_total: int = 0
    darts: int = 0
    darts_right: int = 0
    missed: int = 0
    phantom: int = 0
    confidently_wrong: int = 0
    predicted: int = 0
    errors_mm: list[float] = field(default_factory=list)
    kinds: Counter = field(default_factory=Counter)

    def add(self, truth_board: np.ndarray, tips: list[Tip]) -> None:
        """One photograph: the real tips in board millimetres, and what the model found."""
        truths = [score_at(x, y) for x, y in truth_board]
        self.images += 1
        self.darts += len(truths)
        self.predicted += len(tips)
        if sum(h.value for h in truths) == sum(t.hit.value for t in tips) and len(truths) == len(tips):
            self.correct_total += 1

        # Greedy matching, nearest pair first: with at most a handful of darts
        # that is the optimal assignment in all but contrived cases.
        pairs = sorted(
            (float(np.hypot(*(np.array(t.board) - truth_board[i]))), i, j)
            for i in range(len(truths))
            for j, t in enumerate(tips)
        )
        used_truth: set[int] = set()
        used_tip: set[int] = set()
        for distance, i, j in pairs:
            if distance > MATCH_MM or i in used_truth or j in used_tip:
                continue
            used_truth.add(i)
            used_tip.add(j)
            self.errors_mm.append(distance)
            kind = _kind(truths[i], tips[j].hit)
            self.kinds[kind] += 1
            if kind == "right":
                self.darts_right += 1
            elif tips[j].confidence >= CONFIDENT:
                self.confidently_wrong += 1

        self.missed += len(truths) - len(used_truth)
        self.phantom += len(tips) - len(used_tip)
        self.kinds["missed dart"] += len(truths) - len(used_truth)
        self.kinds["phantom dart"] += len(tips) - len(used_tip)
        for j in set(range(len(tips))) - used_tip:
            if tips[j].confidence >= CONFIDENT:
                self.confidently_wrong += 1

    def summary(self) -> dict:
        darts = max(self.darts, 1)
        errors = np.array(self.errors_mm) if self.errors_mm else np.array([np.nan])
        return {
            "images": self.images,
            "pcs": self.correct_total / max(self.images, 1),
            "dart_accuracy": self.darts_right / darts,
            "missed_rate": self.missed / darts,
            "phantom_rate": self.phantom / darts,
            "confidently_wrong": self.confidently_wrong / max(self.darts + self.phantom, 1),
            "error_mm_median": float(np.median(errors)),
            "error_mm_p95": float(np.percentile(errors, 95)),
            "kinds": dict(self.kinds),
        }


def gate_passed(summary: dict) -> bool:
    return summary["pcs"] >= GATE["pcs"] and summary["confidently_wrong"] <= GATE["confidently_wrong"]
