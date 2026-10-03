"""
Samples → rectified images and CenterNet targets.

Each photograph is warped to the rectified view (`board.RECT_*`): the model only
ever sees one geometry, a board filling the square with the bull in the middle.
Training adds three kinds of variation on top:

- calibration jitter: the four calibration points are moved by a few pixels
  before the warp is solved, because a person dragging markers on a phone is
  that accurate and no better. The tips go through the same jittered warp, so
  the labels stay exact; what changes is where the board sits in the square.
- rotation and mirroring of the rectified square: the model finds tips, it
  does not read numbers, so a turned board is just more boards.
- photometric damage: light, colour, blur, noise, JPEG. A model trained only on
  well-lit photographs is a model that works only in shops.

Augmentation is plain OpenCV/NumPy. Albumentations was the plan in docs/03, but
its maintained successor changed licence; this needs twenty lines, not a
dependency.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from .board import OUT_SIZE, RECT_SIZE, STRIDE, apply_h, board_to_rect, solve_homography
from .samples import Sample, read_image

SIGMA = 1.5  # in output cells: ≈ 5 mm on the board


def rect_warp(sample: Sample, calib_image: np.ndarray | None = None) -> np.ndarray:
    """Image pixels → rectified pixels, from the sample's own homography or re-solved from moved points."""
    if calib_image is None:
        return board_to_rect() @ sample.image_to_board
    return board_to_rect() @ solve_homography(calib_image, sample.calib_board)


def warp_to_rect(image: np.ndarray, warp: np.ndarray) -> np.ndarray:
    """
    Warps a photograph into the rectified square without aliasing.

    `warpPerspective` samples bilinearly and ignores INTER_AREA, so shrinking a
    4K photograph straight to 512² skips most of its pixels and a dart tip can
    fall between samples. When the warp shrinks by more than about 1.5× at the
    bull, the photograph is first resized with area averaging to roughly the
    right scale.
    """
    bull = np.linalg.inv(warp) @ np.array([RECT_SIZE / 2, RECT_SIZE / 2, 1.0])
    bull = bull[:2] / bull[2]
    step = apply_h(warp, np.array([bull, bull + (1, 0), bull + (0, 1)]))
    scale = math.sqrt(abs(np.linalg.det(np.stack([step[1] - step[0], step[2] - step[0]]))))
    if scale < 0.66:
        factor = min(1.0, scale * 1.5)
        image = cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
        warp = warp @ np.diag([1 / factor, 1 / factor, 1.0])
    return cv2.warpPerspective(image, warp, (RECT_SIZE, RECT_SIZE), flags=cv2.INTER_LINEAR)


def _rotate_flip(angle_deg: float, flip: bool) -> np.ndarray:
    c = RECT_SIZE / 2
    a = math.radians(angle_deg)
    to_origin = np.array([[1, 0, -c], [0, 1, -c], [0, 0, 1]], dtype=np.float64)
    back = np.array([[1, 0, c], [0, 1, c], [0, 0, 1]], dtype=np.float64)
    rotate = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    mirror = np.diag([-1.0 if flip else 1.0, 1.0, 1.0])
    return back @ rotate @ mirror @ to_origin


def photometric(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    out = image.astype(np.float32)
    # exposure and contrast
    out = (out - 128) * rng.uniform(0.6, 1.4) + 128 + rng.uniform(-40, 40)
    # white balance
    out *= rng.uniform(0.85, 1.15, size=3).astype(np.float32)
    out = np.clip(out, 0, 255)
    # gamma
    out = 255 * (out / 255) ** rng.uniform(0.7, 1.5)
    if rng.random() < 0.3:  # a lamp to one side
        yy, xx = np.mgrid[0:RECT_SIZE, 0:RECT_SIZE].astype(np.float32) / RECT_SIZE
        theta = rng.uniform(0, 2 * math.pi)
        ramp = (np.cos(theta) * (xx - 0.5) + np.sin(theta) * (yy - 0.5)) * rng.uniform(40, 120)
        out = out + ramp[..., None]
    if rng.random() < 0.3:
        k = int(rng.choice([3, 5]))
        out = cv2.GaussianBlur(out, (k, k), 0)
    if rng.random() < 0.4:
        out = out + rng.normal(0, rng.uniform(2, 10), out.shape).astype(np.float32)
    out = np.clip(out, 0, 255).astype(np.uint8)
    if rng.random() < 0.4:
        ok, buffer = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(40, 90))])
        if ok:
            out = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    return out


def encode_targets(tips_rect: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Heatmap (1, S, S), offset (2, S, S) and offset mask (1, S, S) for tips in rectified pixels."""
    heat = np.zeros((1, OUT_SIZE, OUT_SIZE), dtype=np.float32)
    offset = np.zeros((2, OUT_SIZE, OUT_SIZE), dtype=np.float32)
    mask = np.zeros((1, OUT_SIZE, OUT_SIZE), dtype=np.float32)
    yy, xx = np.mgrid[0:OUT_SIZE, 0:OUT_SIZE].astype(np.float32)
    for x, y in tips_rect:
        cx, cy = x / STRIDE, y / STRIDE
        ix, iy = int(math.floor(cx)), int(math.floor(cy))
        if not (0 <= ix < OUT_SIZE and 0 <= iy < OUT_SIZE):
            continue
        blob = np.exp(-((xx - ix) ** 2 + (yy - iy) ** 2) / (2 * SIGMA**2))
        heat[0] = np.maximum(heat[0], blob)
        heat[0, iy, ix] = 1.0
        offset[:, iy, ix] = (cx - ix, cy - iy)
        mask[0, iy, ix] = 1.0
    return heat, offset, mask


def to_tensor(image_bgr: np.ndarray) -> torch.Tensor:
    """BGR uint8 → RGB float 0–1, CHW. The model normalises internally."""
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    return torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255)


class TipDataset(Dataset):
    def __init__(self, samples: list[Sample], train: bool, seed: int = 0, jitter_px: float = 4.0):
        self.samples = samples
        self.train = train
        self.seed = seed
        self.jitter_px = jitter_px
        # Counts draws in *this* copy of the dataset. DataLoader workers each
        # hold their own copy for the whole run (persistent workers), so an
        # epoch number set from the main process never reaches them; a counter
        # that advances inside the worker does, and it makes the N copies of
        # `--oche-repeat` differ too.
        self._draws = 0

    def __len__(self) -> int:
        return len(self.samples)

    def rectify(self, index: int, rng: np.random.Generator | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """The rectified image, the tips in it, and the warp used."""
        sample = self.samples[index]
        image = read_image(sample.image_path)
        if rng is None:
            warp = rect_warp(sample)
        else:
            jitter = rng.normal(0, self.jitter_px / 2, sample.calib_image.shape).clip(-self.jitter_px, self.jitter_px)
            warp = rect_warp(sample, sample.calib_image + jitter)
            warp = _rotate_flip(rng.uniform(0, 360), bool(rng.random() < 0.5)) @ warp
        rect = warp_to_rect(image, warp)
        tips = apply_h(warp, sample.tips_image) if len(sample.tips_image) else np.zeros((0, 2))
        return rect, tips, warp

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        rng = None
        if self.train:
            # torch.initial_seed() differs per worker and follows torch.manual_seed.
            rng = np.random.default_rng((self.seed, torch.initial_seed() % 2**63, index, self._draws))
            self._draws += 1
        rect, tips, _ = self.rectify(index, rng)
        if rng is not None:
            rect = photometric(rect, rng)
        heat, offset, mask = encode_targets(tips)
        return {
            "image": to_tensor(rect),
            "heatmap": torch.from_numpy(heat),
            "offset": torch.from_numpy(offset),
            "mask": torch.from_numpy(mask),
            "index": torch.tensor(index),
        }
