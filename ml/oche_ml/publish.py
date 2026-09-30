"""
Uploads an exported model as a DRAFT GitHub release, for the Action to publish.

    python -m oche_ml.publish --name tips-v1

What leaves this machine: `exports/<name>.onnx` and its card. Nothing else —
not the .pt checkpoints, not the photographs, not the runs. The ONNX file is the
model's weights in another format and it will be public, because the app is a
public web page that downloads it; that is the price of scoring in the browser
with no server.

Steps, and who does them:

1. (here) check the file against its card, then `gh release create --draft`.
   A draft is visible only to people with write access to the repository.
2. (you) commit and push ml/models/<name>/CARD.md: the Action compares the
   draft's file with the SHA-256 written in the committed card.
3. (you) run the "Publish model" workflow, which validates the file, publishes
   the release and redeploys the app with the model in it:
       gh workflow run model-release.yml -f name=<name>
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

from .validate_onnx import sha256, validate

ML = Path(__file__).resolve().parent.parent


def card_sha(card: Path) -> str | None:
    match = re.search(r"SHA-256 \| `([0-9a-f]{64})`", card.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()

    model = ML / "exports" / f"{args.name}.onnx"
    card = ML / "models" / args.name / "CARD.md"
    if not model.exists() or not card.exists():
        sys.exit(f"missing {model} or {card}: run python -m oche_ml.export first")
    if card_sha(card) != sha256(model):
        sys.exit(f"{card} does not describe {model} (SHA-256 differs): export again")
    problems = validate(model)
    if problems:
        sys.exit("the model breaks the contract: " + "; ".join(problems))
    if shutil.which("gh") is None:
        sys.exit("needs the GitHub CLI (gh), logged in: https://cli.github.com")

    if "DeepDarts: yes" in card.read_text(encoding="utf-8"):
        print("This model was trained on DeepDarts. Before publishing, check the licence shown on")
        print("https://ieee-dataport.org/open-access/deepdarts-dataset allows it (the card attributes it as CC BY).")

    tag = f"model-{args.name}"
    subprocess.run(
        ["gh", "release", "create", tag, str(model), "--draft", "--title", f"Model {args.name}", "--notes-file", str(card)],
        check=True,
    )
    print(f"\ndraft release {tag} created. Next:")
    print(f"  git add {card.relative_to(ML.parent).as_posix()} && git commit -m \"Model card for {args.name}\" && git push")
    print(f"  gh workflow run model-release.yml -f name={args.name}")


if __name__ == "__main__":
    main()
