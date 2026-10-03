"""Loading the datasets named on a command line, and splitting them."""

from __future__ import annotations

import argparse
import glob
from pathlib import Path

from .dartscribe import load_dartscribe
from .deepdarts import load_deepdarts
from .capture_export import load_export
from .samples import Sample, split_of


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--oche", nargs="*", default=[], help="capture-lab exports: zips or unzipped folders")
    parser.add_argument("--deepdarts", default=None, help="the DeepDarts dataset folder (holds labels.pkl)")
    parser.add_argument("--dartscribe", default=None, help="the dartscribe dataset folder (holds throws/): side-view cameras")
    parser.add_argument("--reviewed-only", action="store_true", help="of your own photographs, use only those confirmed in the app's review screen")


def load(args: argparse.Namespace, verbose: bool = True) -> list[Sample]:
    samples: list[Sample] = []
    seen: set[str] = set()
    # PowerShell hands "data/oche/*.zip" over unexpanded.
    paths = [match for pattern in args.oche for match in (sorted(glob.glob(pattern)) or [pattern])]
    for path in paths:
        loaded, report = load_export(Path(path))
        # The same frame arrives again in every later export; keep it once.
        fresh = [s for s in loaded if s.key not in seen]
        if getattr(args, "reviewed_only", False):
            unchecked = [s for s in fresh if not s.meta.get("reviewed")]
            fresh = [s for s in fresh if s.meta.get("reviewed")]
            if verbose and unchecked:
                print(f"{path}: left out {len(unchecked)} photographs not yet reviewed")
        seen.update(s.key for s in fresh)
        samples += fresh
        if verbose:
            skipped = ", ".join(f"{n} {why}" for why, n in report.skipped.items()) or "none"
            print(f"{path}: {report.frames} frames, kept {len(fresh)} new, skipped: {skipped}")
            for problem in report.problems[:5]:
                print(f"    {problem}")
    if args.deepdarts:
        loaded, counts = load_deepdarts(Path(args.deepdarts))
        samples += loaded
        if verbose:
            print(f"{args.deepdarts}: {counts}")
    if getattr(args, "dartscribe", None):
        loaded, counts = load_dartscribe(Path(args.dartscribe))
        samples += loaded
        if verbose:
            print(f"{args.dartscribe}: {counts}")
    if not samples:
        raise SystemExit("no samples: pass --oche, --deepdarts and/or --dartscribe")
    return samples


def split(samples: list[Sample]) -> dict[str, list[Sample]]:
    parts: dict[str, list[Sample]] = {"train": [], "val": [], "test": []}
    # A visit where the model proposed anything would grade the model against
    # its own answers, so the whole visit only ever trains. Whole visit, not
    # just that photograph: the photographs of a visit are near-copies, and one
    # of them in test with its siblings in train is a leak.
    involved = {s.group for s in samples if s.meta.get("model_involved")}
    for sample in samples:
        # A dataset may fix its own split (dartscribe does); otherwise it is the
        # hash of the group's name.
        part = sample.meta.get("split") or split_of(sample.group)
        parts["train" if sample.group in involved else part].append(sample)
    return parts


def describe(parts: dict[str, list[Sample]]) -> str:
    def count(items: list[Sample]) -> str:
        by_source: dict[str, int] = {}
        for s in items:
            by_source[s.source] = by_source.get(s.source, 0) + 1
        darts = sum(len(s.tips_image) for s in items)
        return f"{len(items)} images, {darts} darts {by_source}"

    return "\n".join(f"  {name:5} {count(items)}" for name, items in parts.items())
