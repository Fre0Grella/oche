"""
Trains the dart-tip model.

Two stages, as docs/03 plans them:

    # 1. learn what a dart tip looks like, from DeepDarts
    python -m oche_ml.train --deepdarts ml/data/deepdarts --epochs 40 --out ml/runs/pretrain

    # 2. learn your board, your light and your camera angle
    python -m oche_ml.train --oche ml/data/oche/*.zip --init ml/runs/pretrain/best.pt \\
        --epochs 60 --lr 3e-4 --out ml/runs/finetune

Both at once also works (`--oche ... --deepdarts ...`), with `--oche-repeat` to
show your own photographs more often than their number alone would.

    # smoke test: memorise a handful of photographs, no augmentation
    python -m oche_ml.train --oche oche-captures.zip --overfit --epochs 150 --out ml/runs/overfit
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import torch
from torch.utils.data import ConcatDataset, DataLoader

from . import sources
from .board import RECT_HALF_MM, RECT_SIZE
from .dataset import TipDataset
from .model import DEFAULT_BACKBONE, TipNet, focal_loss, offset_loss


def pick_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def use_amp(device: torch.device, choice: str) -> bool:
    """
    Mixed precision, unless the GPU cannot do it. GTX 16-series cards produce
    NaNs in half precision (the backbone's first batch is already NaN on a
    GTX 1650), so 'auto' leaves them in full precision.
    """
    if device.type != "cuda" or choice == "off":
        return False
    if choice == "on":
        return True
    return "GTX 16" not in torch.cuda.get_device_name(device)


def save_checkpoint(path: Path, model: TipNet, epoch: int, val: dict | None, args: argparse.Namespace) -> None:
    torch.save(
        {
            "model": model.state_dict(),
            "backbone": model.backbone_name,
            "rect": {"size": RECT_SIZE, "half_mm": RECT_HALF_MM},
            "epoch": epoch,
            "val": val,
            "args": {k: v for k, v in vars(args).items() if isinstance(v, (str, int, float, bool, list, type(None)))},
        },
        path,
    )


def load_checkpoint(path: str | Path, device: torch.device, pretrained: bool = False) -> TipNet:
    state = torch.load(path, map_location=device, weights_only=False)
    rect = state.get("rect", {})
    if rect and (rect["size"] != RECT_SIZE or rect["half_mm"] != RECT_HALF_MM):
        raise SystemExit(f"{path} was trained on a different rectified view: {rect}")
    model = TipNet(state["backbone"], pretrained=pretrained)
    model.load_state_dict(state["model"])
    return model.to(device)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sources.add_arguments(parser)
    parser.add_argument("--out", required=True)
    parser.add_argument("--init", default=None, help="start from this checkpoint (fine-tuning)")
    parser.add_argument("--backbone", default=DEFAULT_BACKBONE)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch", type=int, default=16, help="16 takes about 2.4 GB in full precision")
    parser.add_argument("--amp", choices=["auto", "on", "off"], default="auto", help="mixed precision; auto is off on GTX 16xx")
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--oche-repeat", type=int, default=1, help="show each own photograph this many times per epoch")
    parser.add_argument("--overfit", action="store_true", help="train and validate on everything, no augmentation")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    # Imported here so --help works without loading the metrics' dependencies.
    from .evaluate import evaluate

    torch.manual_seed(args.seed)
    device = pick_device()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    samples = sources.load(args)
    if args.overfit:
        parts = {"train": samples, "val": samples, "test": []}
    else:
        parts = sources.split(samples)
    print("split:\n" + sources.describe(parts))
    if not parts["train"]:
        raise SystemExit("nothing to train on in the train split")

    own = [s for s in parts["train"] if s.source == "oche"]
    other = [s for s in parts["train"] if s.source != "oche"]
    datasets = [TipDataset(own, train=not args.overfit, seed=args.seed)] * max(args.oche_repeat, 1) if own else []
    if other:
        datasets.append(TipDataset(other, train=not args.overfit, seed=args.seed + 1))
    train_set = ConcatDataset(datasets)

    # Validate on your own board when there is any of it: that is the number
    # that matters. Failing that, on side-view photographs (dartscribe), which
    # are the hard case; face-on DeepDarts is the last resort.
    val = (
        [s for s in parts["val"] if s.source == "oche"]
        or [s for s in parts["val"] if s.source == "dartscribe"]
        or parts["val"]
    )

    loader = DataLoader(
        train_set,
        batch_size=min(args.batch, len(train_set)),
        shuffle=True,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
        persistent_workers=args.workers > 0,
        drop_last=len(train_set) > args.batch,
    )

    model = load_checkpoint(args.init, device) if args.init else TipNet(args.backbone).to(device)
    optimiser = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps = args.epochs * len(loader)
    warmup = min(500, steps // 10)
    schedule = torch.optim.lr_scheduler.LambdaLR(
        optimiser,
        lambda step: (step + 1) / max(warmup, 1) if step < warmup else 0.5 * (1 + math.cos(math.pi * (step - warmup) / max(steps - warmup, 1))),
    )
    amp = use_amp(device, args.amp)
    scaler = torch.amp.GradScaler(enabled=amp)

    best = (-1.0, -math.inf)
    log = (out / "log.jsonl").open("a", encoding="utf-8")
    print(f"training on {device} ({'mixed' if amp else 'full'} precision), {len(train_set)} images per epoch, {args.epochs} epochs")

    for epoch in range(1, args.epochs + 1):
        model.train()
        started = time.time()
        totals = {"heat": 0.0, "offset": 0.0}
        for batch in loader:
            image = batch["image"].to(device, non_blocking=True)
            with torch.autocast(device.type, enabled=amp):
                heat_logits, offset_logits = model.logits(image)
            heat_logits, offset_logits = heat_logits.float(), offset_logits.float()
            l_heat = focal_loss(heat_logits, batch["heatmap"].to(device))
            l_offset = offset_loss(offset_logits, batch["offset"].to(device), batch["mask"].to(device))
            loss = l_heat + l_offset

            optimiser.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(optimiser)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(optimiser)
            scaler.update()
            schedule.step()
            totals["heat"] += l_heat.item()
            totals["offset"] += l_offset.item()

        record: dict = {
            "epoch": epoch,
            "seconds": round(time.time() - started, 1),
            "loss_heat": totals["heat"] / len(loader),
            "loss_offset": totals["offset"] / len(loader),
            "lr": schedule.get_last_lr()[0],
        }
        summary = evaluate(model, val, device) if val else None
        if summary:
            record["val"] = {k: v for k, v in summary.items() if k != "kinds"}
        print(json.dumps(record))
        log.write(json.dumps(record) + "\n")
        log.flush()

        save_checkpoint(out / "last.pt", model, epoch, summary, args)
        # An epoch that matched no darts has a NaN median error, and NaN compares
        # False with everything: count it as infinitely far instead.
        error = summary["error_mm_median"] if summary and math.isfinite(summary["error_mm_median"]) else math.inf
        score = (summary["pcs"], -error) if summary else (0.0, -record["loss_heat"])
        if score > best:
            best = score
            save_checkpoint(out / "best.pt", model, epoch, summary, args)

    print(f"done. best: PCS {best[0]:.3f}; checkpoints in {out}")


if __name__ == "__main__":
    main()
