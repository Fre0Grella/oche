import numpy as np
import pytest
import torch

from treblewise_ml.board import STRIDE, apply_h, board_to_rect
from treblewise_ml.dataset import TipDataset, encode_targets
from treblewise_ml.decode import decode
from treblewise_ml.capture_export import load_export

from .conftest import real_exports


def test_synthetic_export_loads_and_skips_the_incomplete_report(synthetic_export):
    samples, report = load_export(synthetic_export)
    assert [len(s.tips_image) for s in samples] == [1, 2, 3]
    assert report.skipped == {"dart left unplaced in a game report": 1}
    # the three photographs of one visit are one group, so they split together
    assert len({s.group for s in samples}) == 1


@pytest.mark.parametrize("export", real_exports(), ids=lambda p: p.name)
def test_real_export_labels_agree_with_their_homographies_and_scores(export):
    samples, report = load_export(export)
    assert report.problems == [], report.problems
    assert samples, "nothing loaded"


def test_rectified_tips_land_where_the_board_says(synthetic_export):
    samples, _ = load_export(synthetic_export)
    dataset = TipDataset(samples, train=False)
    rect, tips, _ = dataset.rectify(2)
    expected = apply_h(board_to_rect(), np.array([[0, 103], [20, 100], [-60, -60]]))
    assert np.allclose(tips, expected, atol=1e-6)
    # and there is a dark dot under each one in the warped picture
    for x, y in tips:
        assert rect[int(round(y)), int(round(x))].mean() < 120


def test_training_augmentation_moves_tips_with_the_picture(synthetic_export):
    samples, _ = load_export(synthetic_export)
    dataset = TipDataset(samples, train=True, seed=3)
    rect, tips, _ = dataset.rectify(2, np.random.default_rng(1))
    for x, y in tips:
        if 2 <= x < rect.shape[1] - 2 and 2 <= y < rect.shape[0] - 2:
            assert rect[int(round(y)) - 1 : int(round(y)) + 2, int(round(x)) - 1 : int(round(x)) + 2].min() < 120


def test_augmentation_changes_every_epoch_even_in_persistent_workers(synthetic_export):
    from torch.utils.data import DataLoader

    samples, _ = load_export(synthetic_export)
    dataset = TipDataset(samples, train=True)
    loader = DataLoader(dataset, batch_size=len(samples), num_workers=2, persistent_workers=True)
    first, second = (next(iter(loader))["image"] for _ in range(2))
    assert not torch.equal(first, second)


def test_repeated_copies_of_one_dataset_are_augmented_differently(synthetic_export):
    samples, _ = load_export(synthetic_export)
    dataset = TipDataset(samples, train=True)
    assert not torch.equal(dataset[0]["image"], dataset[0]["image"])


def test_targets_decode_back_to_the_same_tips():
    tips = np.array([[100.3, 200.9], [300.0, 50.25], [256.0, 256.0]])
    heat, offset, _ = encode_targets(tips)
    found = decode(heat, offset, threshold=0.5)
    got = sorted((t.x, t.y) for t in found)
    assert np.allclose(got, sorted(map(tuple, tips)), atol=1e-4)


def test_dataset_item_shapes(synthetic_export):
    samples, _ = load_export(synthetic_export)
    item = TipDataset(samples, train=True)[0]
    assert item["image"].shape == (3, 512, 512)
    assert item["heatmap"].shape == (1, 512 // STRIDE, 512 // STRIDE)
    assert item["image"].dtype == torch.float32


def test_photographs_the_model_marked_never_reach_val_or_test(synthetic_export, tmp_path):
    import json
    import zipfile

    from treblewise_ml import sources
    from treblewise_ml.samples import split_of

    marked = tmp_path / "marked.zip"
    with zipfile.ZipFile(synthetic_export) as src, zipfile.ZipFile(marked, "w") as dst:
        labels = json.loads(src.read("labels.json"))
        for frame in labels["frames"]:
            for dart in frame["darts"]:
                dart["by"] = "model"
        for item in src.namelist():
            if item != "labels.json":
                dst.writestr(item, src.read(item))
        dst.writestr("labels.json", json.dumps(labels))

    samples, _ = load_export(marked)
    for sample in samples:  # whichever way the hash falls, they train
        sample.group = next(g for g in (f"g{i}" for i in range(1000)) if split_of(g) == "test")
    parts = sources.split(samples)
    assert len(parts["train"]) == len(samples) and not parts["test"] and not parts["val"]


def test_one_model_marked_photograph_sends_its_whole_visit_to_train(synthetic_export):
    from treblewise_ml import sources
    from treblewise_ml.samples import split_of

    samples, _ = load_export(synthetic_export)
    test_group = next(g for g in (f"g{i}" for i in range(1000)) if split_of(g) == "test")
    for sample in samples:
        sample.group = test_group
    samples[-1].meta["model_involved"] = True
    parts = sources.split(samples)
    assert len(parts["train"]) == len(samples) and not parts["test"]


def test_reviewed_only_keeps_the_photographs_a_person_checked(synthetic_export, tmp_path):
    import argparse
    import json
    import zipfile

    from treblewise_ml import sources

    checked = tmp_path / "checked.zip"
    with zipfile.ZipFile(synthetic_export) as src, zipfile.ZipFile(checked, "w") as dst:
        labels = json.loads(src.read("labels.json"))
        labels["frames"][0]["reviewed"] = True
        for item in src.namelist():
            if item != "labels.json":
                dst.writestr(item, src.read(item))
        dst.writestr("labels.json", json.dumps(labels))

    everything = sources.load(argparse.Namespace(oche=[str(checked)], deepdarts=None, reviewed_only=False), verbose=False)
    reviewed = sources.load(argparse.Namespace(oche=[str(checked)], deepdarts=None, reviewed_only=True), verbose=False)
    assert len(everything) == 3 and len(reviewed) == 1
    assert reviewed[0].meta["reviewed"] is True
