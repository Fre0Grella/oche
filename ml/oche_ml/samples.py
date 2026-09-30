"""
The one shape every dataset is turned into before training.

A sample is a photograph, the homography from its pixels to board millimetres,
the four calibration points it was built from, and the dart tips in image
pixels. Nothing downstream knows which dataset a sample came from, except for
the `group` used to split it: frames that are near-copies of each other (one
visit, one recording session) always land on the same side of the split.
"""

from __future__ import annotations

import hashlib
import zipfile
from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class Sample:
    key: str
    source: str  # 'oche' | 'deepdarts'
    group: str
    image_path: str  # a file, or '<zip>::<member>'
    image_to_board: np.ndarray  # 3×3
    calib_image: np.ndarray  # (4, 2) image pixels
    calib_board: np.ndarray  # (4, 2) board millimetres, same order
    tips_image: np.ndarray  # (N, 2) image pixels; N may be 0
    meta: dict = field(default_factory=dict)


def read_image(path: str) -> np.ndarray:
    """BGR uint8, from a file or from inside a zip."""
    if "::" in path:
        archive, member = path.split("::", 1)
        with zipfile.ZipFile(archive) as z:
            data = np.frombuffer(z.read(member), dtype=np.uint8)
    else:
        data = np.fromfile(path, dtype=np.uint8)  # np.fromfile copes with non-ASCII Windows paths
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"could not decode {path}")
    return image


def split_of(group: str, test_percent: int = 20, val_percent: int = 10) -> str:
    """
    A group's split, from a hash of its name: stable across re-exports, so a
    frame that was in the test set stays there and no run ever trains on it.
    """
    bucket = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) % 100
    if bucket < test_percent:
        return "test"
    if bucket < test_percent + val_percent:
        return "val"
    return "train"
