"""
Scores a checkpoint on held-out photographs and says whether it passes the gate.

    python -m oche_ml.evaluate --checkpoint ml/runs/finetune/best.pt --oche ml/data/oche/*.zip

By default only the `test` split is used: groups no training run has seen.
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import torch

from . import sources
from .board import apply_h
from .dataset import TipDataset, to_tensor
from .decode import THRESHOLD, decode
from .metrics import Tally, gate_passed
from .samples import Sample
from .train import load_checkpoint, pick_device


@torch.no_grad()
def evaluate(model: torch.nn.Module, samples: list[Sample], device: torch.device, threshold: float = THRESHOLD) -> dict:
    model.eval()
    dataset = TipDataset(samples, train=False)
    tally = Tally()
    for index, sample in enumerate(samples):
        rect, _, _ = dataset.rectify(index)
        heat, offset = model(to_tensor(rect).unsqueeze(0).to(device))
        tips = decode(heat[0].float().cpu().numpy(), offset[0].float().cpu().numpy(), threshold)
        truth = apply_h(sample.image_to_board, sample.tips_image) if len(sample.tips_image) else np.zeros((0, 2))
        tally.add(truth, tips)
    return tally.summary()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--split", default="test", choices=["train", "val", "test", "all"])
    parser.add_argument("--threshold", type=float, default=THRESHOLD)
    sources.add_arguments(parser)
    args = parser.parse_args()

    device = pick_device()
    model = load_checkpoint(args.checkpoint, device)
    samples = sources.load(args)
    parts = sources.split(samples)
    chosen = samples if args.split == "all" else parts[args.split]
    if not chosen:
        raise SystemExit(f"the {args.split} split is empty; with very few visits, try --split all (and say so)")

    for source in sorted({s.source for s in chosen}):
        subset = [s for s in chosen if s.source == source]
        summary = evaluate(model, subset, device, args.threshold)
        print(f"\n{source} ({args.split}):")
        print(json.dumps(summary, indent=2))
        if source == "oche" and args.split == "test":
            print("gate:", "PASSED" if gate_passed(summary) else "not passed", "(PCS >= 90%, confidently wrong <= 1%)")
        elif source == "oche":
            print(f"gate: not judged; the {args.split} split is not held out, so this says nothing about new photographs")


if __name__ == "__main__":
    main()
