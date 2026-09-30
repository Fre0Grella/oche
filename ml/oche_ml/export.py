"""
Exports a checkpoint to ONNX for ONNX Runtime Web, and proves the export.

    python -m oche_ml.export --checkpoint ml/runs/finetune/best.pt --name tips-v1

Writes ml/exports/<name>.onnx and ml/models/<name>/CARD.md. The card is public
(it becomes the release notes) and names data by file name only. The export is
checked, not trusted: the ONNX file is run with onnxruntime on the same input as
PyTorch, and the two must agree. The card records what docs/08 requires of every
model that could ship — its data, its metrics and the file's SHA-256.

Graph contract, which the browser code relies on:

    input   image    float32 [1, 3, 512, 512]  RGB 0–1, the rectified board
    output  heatmap  float32 [1, 1, 128, 128]  tip probability per cell
    output  offset   float32 [1, 2, 128, 128]  x, y within the cell, 0–1
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from .board import MM_PER_PX, OUT_SIZE, RECT_HALF_MM, RECT_SIZE, STRIDE
from .train import load_checkpoint
from .validate_onnx import SPEC, sha256, validate

ML = Path(__file__).resolve().parent.parent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--name", required=True, help="e.g. tips-v1")
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    import onnx
    import onnxruntime as ort

    device = torch.device("cpu")
    model = load_checkpoint(args.checkpoint, device).eval()
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=False)

    exports = ML / "exports"
    exports.mkdir(exist_ok=True)
    onnx_path = exports / f"{args.name}.onnx"
    example = torch.rand(1, 3, RECT_SIZE, RECT_SIZE)
    torch.onnx.export(
        model,
        (example,),
        str(onnx_path),
        input_names=["image"],
        output_names=["heatmap", "offset"],
        opset_version=args.opset,
        dynamo=False,
    )

    # The rectified-view spec travels inside the file, so a model can never be
    # paired with the wrong warp without the validator noticing.
    graph = onnx.load(str(onnx_path))
    for key, value in SPEC.items():
        graph.metadata_props.add(key=key, value=value)
    graph.metadata_props.add(key="oche.name", value=args.name)
    onnx.save(graph, str(onnx_path))

    problems = validate(onnx_path)
    if problems:
        raise SystemExit("export breaks the contract: " + "; ".join(problems))

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    with torch.no_grad():
        expected = [t.numpy() for t in model(example)]
    got = session.run(None, {"image": example.numpy()})
    worst = max(float(np.abs(a - b).max()) for a, b in zip(expected, got))
    if worst > 1e-3:
        raise SystemExit(f"ONNX and PyTorch disagree by {worst:.2e}; not writing a card for this file")

    digest = sha256(onnx_path)
    size_mb = onnx_path.stat().st_size / 1e6
    card_dir = ML / "models" / args.name
    card_dir.mkdir(parents=True, exist_ok=True)
    val = state.get("val") or {}
    run_args = state.get("args") or {}
    # The card is published with the release: file names only, never a path
    # from this machine.
    oche_used = [Path(p).name for p in run_args.get("oche") or []]
    deepdarts_used = bool(run_args.get("deepdarts"))
    init = Path(run_args["init"]).parent.name + "/" + Path(run_args["init"]).name if run_args.get("init") else None
    card = f"""# {args.name}

Dart-tip detector for the oche autoscorer (model B, docs/03-autoscorer.md).

| | |
|---|---|
| File | `{args.name}.onnx` ({size_mb:.1f} MB) |
| SHA-256 | `{digest}` |
| Backbone | `{state['backbone']}` (timm, ImageNet-1k weights, Apache-2.0) |
| Input | `image` float32 [1,3,{RECT_SIZE},{RECT_SIZE}], RGB 0–1, rectified board, ±{RECT_HALF_MM:g} mm, {MM_PER_PX:.3f} mm/px, 20 at the top |
| Outputs | `heatmap` [1,1,{OUT_SIZE},{OUT_SIZE}], `offset` [1,2,{OUT_SIZE},{OUT_SIZE}]; tip = (cell + offset) × {STRIDE} |
| Trained | epoch {state.get('epoch')}{f', initialised from {init}' if init else ''} |
| ONNX vs PyTorch | max difference {worst:.1e} |

## Training data

- oche exports: {', '.join(oche_used) or 'none'}
- DeepDarts: {'yes — McNally, Vats, Wong, McPhee, *DeepDarts: Modeling Keypoints as Objects for Automatic Scorekeeping in Darts using a Single Camera*, CVPRW 2021. IEEE DataPort, DOI 10.21227/05e7-xs69, CC BY.' if deepdarts_used else 'not used'}

## Validation when the checkpoint was picked

```json
{json.dumps(val, indent=2)}
```

## The gate

{'Not evaluated: no held-out photographs of the target board were used. This model may propose darts in the capture lab; it may not score games.' if not oche_used else 'Paste `python -m oche_ml.evaluate` on the held-out test split here before this model scores games.'}
"""
    (card_dir / "CARD.md").write_text(card, encoding="utf-8")
    print(f"wrote {onnx_path} ({size_mb:.1f} MB, sha256 {digest[:16]}...), ONNX matches PyTorch to {worst:.1e}")
    print(f"wrote {card_dir / 'CARD.md'}")
    print(f"next: python -m oche_ml.publish --name {args.name}")


if __name__ == "__main__":
    main()
