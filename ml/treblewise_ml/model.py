"""
The dart-tip network: model B in docs/03-autoscorer.md.

An ImageNet-pretrained mobile backbone from timm, a light FPN that brings its
features back to stride 4, and two CenterNet heads on the 128×128 grid:

- `heatmap`: the probability that a tip is in each cell (sigmoid applied);
- `offset`: where in the cell, 0–1 in x and y, for sub-pixel precision.

The input is RGB in 0–1, 1×3×512×512, the rectified board. Normalisation is
inside the graph so the browser hands over pixels and nothing else.

docs/03 also plans a tail heatmap. The labels do not have tails yet, so the
model does not either; adding one is another head and another label field.
"""

from __future__ import annotations

import timm
import torch
import torch.nn.functional as F
from torch import nn

DEFAULT_BACKBONE = "mobilenetv4_conv_small.e2400_r224_in1k"
PRIOR = 0.01  # CenterNet's starting belief that any given cell holds a tip


class TipNet(nn.Module):
    def __init__(self, backbone: str = DEFAULT_BACKBONE, pretrained: bool = True, width: int = 64):
        super().__init__()
        self.backbone_name = backbone
        self.backbone = timm.create_model(backbone, pretrained=pretrained, features_only=True, out_indices=(1, 2, 3, 4))
        channels = self.backbone.feature_info.channels()
        reductions = self.backbone.feature_info.reduction()
        if reductions[0] != 4:
            raise ValueError(f"{backbone}: first feature map is stride {reductions[0]}, this model needs stride 4")

        config = self.backbone.pretrained_cfg
        self.register_buffer("mean", torch.tensor(config.get("mean", (0.485, 0.456, 0.406))).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(config.get("std", (0.229, 0.224, 0.225))).view(1, 3, 1, 1))

        self.lateral = nn.ModuleList(nn.Conv2d(c, width, 1) for c in channels)
        self.smooth = nn.Sequential(
            nn.Conv2d(width, width, 3, padding=1, bias=False),
            nn.BatchNorm2d(width),
            nn.ReLU(inplace=True),
            nn.Conv2d(width, width, 3, padding=1, bias=False),
            nn.BatchNorm2d(width),
            nn.ReLU(inplace=True),
        )
        self.heat = nn.Sequential(nn.Conv2d(width, width, 3, padding=1), nn.ReLU(inplace=True), nn.Conv2d(width, 1, 1))
        self.offset = nn.Sequential(nn.Conv2d(width, width, 3, padding=1), nn.ReLU(inplace=True), nn.Conv2d(width, 2, 1))
        nn.init.constant_(self.heat[-1].bias, -torch.log(torch.tensor((1 - PRIOR) / PRIOR)).item())

    def logits(self, image: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.backbone((image - self.mean) / self.std)
        x = self.lateral[-1](features[-1])
        for lateral, feature in zip(reversed(self.lateral[:-1]), reversed(features[:-1])):
            x = F.interpolate(x, size=feature.shape[-2:], mode="nearest") + lateral(feature)
        x = self.smooth(x)
        return self.heat(x), self.offset(x)

    def forward(self, image: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        heat, offset = self.logits(image)
        return torch.sigmoid(heat), torch.sigmoid(offset)


def focal_loss(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """CenterNet's penalty-reduced focal loss, averaged over the number of tips."""
    pred = torch.sigmoid(logits).clamp(1e-4, 1 - 1e-4)
    positive = target.eq(1).float()
    negative = 1 - positive
    pos_loss = -torch.log(pred) * (1 - pred) ** 2 * positive
    neg_loss = -torch.log(1 - pred) * pred**2 * (1 - target) ** 4 * negative
    count = positive.sum().clamp(min=1)
    return (pos_loss.sum() + neg_loss.sum()) / count


def offset_loss(logits: torch.Tensor, target: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    return (F.l1_loss(torch.sigmoid(logits), target, reduction="none") * mask).sum() / mask.sum().clamp(min=1)
