"""
Checks an exported tip model against the contract the browser relies on.

    python -m treblewise_ml.validate_onnx exports/tips-v1.onnx --sha256 <expected>

Needs only numpy and onnxruntime — no torch — because it also runs in the
GitHub Action that publishes a model release, before anything is made public:

- the file's SHA-256 matches the one in the committed model card, so what gets
  published is exactly what was evaluated;
- input and output names and shapes are the documented ones;
- the rectified-view spec stored in the file matches board.py;
- a run on a random board returns finite values in 0–1.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np

from .board import OUT_SIZE, RECT_HALF_MM, RECT_SIZE, STRIDE

# The keys keep the project's old name on purpose: every released model
# already carries them.
SPEC = {
    "oche.rect_size": str(RECT_SIZE),
    "oche.rect_half_mm": f"{RECT_HALF_MM:g}",
    "oche.stride": str(STRIDE),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(path: Path, expected_sha256: str | None = None) -> list[str]:
    """Every way the file breaks the contract; empty when it is fine."""
    import onnxruntime as ort

    problems: list[str] = []
    if expected_sha256 and sha256(path) != expected_sha256.lower():
        problems.append(f"SHA-256 is {sha256(path)}, the card says {expected_sha256}")

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    inputs = [(i.name, i.shape) for i in session.get_inputs()]
    outputs = [(o.name, o.shape) for o in session.get_outputs()]
    if inputs != [("image", [1, 3, RECT_SIZE, RECT_SIZE])]:
        problems.append(f"inputs are {inputs}")
    if outputs != [("heatmap", [1, 1, OUT_SIZE, OUT_SIZE]), ("offset", [1, 2, OUT_SIZE, OUT_SIZE])]:
        problems.append(f"outputs are {outputs}")

    meta = session.get_modelmeta().custom_metadata_map
    for key, value in SPEC.items():
        if meta.get(key) != value:
            problems.append(f"metadata {key} is {meta.get(key)!r}, expected {value!r}")

    if not problems:
        image = np.random.default_rng(0).random((1, 3, RECT_SIZE, RECT_SIZE), dtype=np.float32)
        for name, value in zip(("heatmap", "offset"), session.run(None, {"image": image})):
            if not np.isfinite(value).all() or value.min() < 0 or value.max() > 1:
                problems.append(f"{name} has values outside 0–1 or not finite")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("model")
    parser.add_argument("--sha256", default=None)
    args = parser.parse_args()
    problems = validate(Path(args.model), args.sha256)
    for problem in problems:
        print(f"FAIL: {problem}")
    if problems:
        sys.exit(1)
    print(f"ok: {args.model} ({sha256(Path(args.model))})")


if __name__ == "__main__":
    main()
