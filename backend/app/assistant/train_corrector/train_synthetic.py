from __future__ import annotations

import argparse
from pathlib import Path
from typing import List, Tuple

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from app.assistant.corrector_model import PianoRollCorrector
from app.assistant.train_corrector.roll import RollConfig, notes_to_roll
from app.core.research import corrupt_notes, generate_pattern


class SyntheticCorrectorDataset(Dataset):
    """Builds X=corrupted roll and Y=clean roll for TCN post-correction."""

    def __init__(
        self,
        samples: int,
        seed: int,
        hop_s: float,
        jitter_s: float,
        miss_prob: float,
        extra_prob: float,
    ):
        self.samples = int(samples)
        self.seed = int(seed)
        self.cfg = RollConfig(hop_s=float(hop_s))
        self.jitter_s = float(jitter_s)
        self.miss_prob = float(miss_prob)
        self.extra_prob = float(extra_prob)

    def __len__(self) -> int:
        return self.samples

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        clean = generate_pattern(self.seed, idx)
        corrupt, _ = corrupt_notes(
            clean,
            seed=self.seed + idx * 71,
            jitter_s=self.jitter_s,
            miss_prob=self.miss_prob,
            extra_prob=self.extra_prob,
        )
        duration = max(
            [n.offset_s for n in clean] + [n.offset_s for n in corrupt] + [1.0]
        ) + 0.25
        n_frames = int(np.ceil(duration / self.cfg.hop_s)) + 1
        x = notes_to_roll(corrupt, n_frames=n_frames, cfg=self.cfg).astype(np.float32)
        y = notes_to_roll(clean, n_frames=n_frames, cfg=self.cfg).astype(np.float32)
        return torch.from_numpy(x), torch.from_numpy(y)


def collate_pad(batch):
    max_t = max(int(x.shape[-1]) for x, _ in batch)
    xs: List[torch.Tensor] = []
    ys: List[torch.Tensor] = []
    for x, y in batch:
        pad = max_t - int(x.shape[-1])
        xs.append(F.pad(x, (0, pad)))
        ys.append(F.pad(y, (0, pad)))
    return torch.stack(xs, dim=0), torch.stack(ys, dim=0)


def weighted_bce(logits: torch.Tensor, target: torch.Tensor, pos_weight: float) -> torch.Tensor:
    loss = F.binary_cross_entropy_with_logits(logits, target, reduction="none")
    weight = 1.0 + target * float(pos_weight)
    return (loss * weight).mean()


def main():
    ap = argparse.ArgumentParser("train_synthetic_corrector")
    ap.add_argument("--samples", type=int, default=512)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--hop-s", type=float, default=0.02)
    ap.add_argument("--jitter-s", type=float, default=0.045)
    ap.add_argument("--miss-prob", type=float, default=0.08)
    ap.add_argument("--extra-prob", type=float, default=0.08)
    ap.add_argument("--lr", type=float, default=4e-4)
    ap.add_argument("--device", type=str, default="auto")
    ap.add_argument("--out", type=str, default="data/corrector_ckpt.pt")
    args = ap.parse_args()

    device = args.device
    if device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

    ds = SyntheticCorrectorDataset(
        samples=args.samples,
        seed=args.seed,
        hop_s=args.hop_s,
        jitter_s=args.jitter_s,
        miss_prob=args.miss_prob,
        extra_prob=args.extra_prob,
    )
    dl = DataLoader(ds, batch_size=args.batch, shuffle=True, num_workers=0, collate_fn=collate_pad)

    model = PianoRollCorrector(channels=88 * 3, layers=6, k=5).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-3)

    def split(z):
        p = 88
        return z[:, :p, :], z[:, p:2*p, :], z[:, 2*p:3*p, :]

    model.train()
    for epoch in range(1, args.epochs + 1):
        total = 0.0
        batches = 0
        for x, y in dl:
            x = x.to(device)
            y = y.to(device)
            pred = model(x)
            p_on, p_fr, p_vel = split(pred)
            y_on, y_fr, y_vel = split(y)

            loss_on = weighted_bce(p_on, y_on, pos_weight=90.0)
            loss_fr = weighted_bce(p_fr, y_fr, pos_weight=14.0)
            vel_mask = (y_on > 0.5).float()
            loss_vel = F.mse_loss(torch.sigmoid(p_vel) * vel_mask, y_vel * vel_mask)
            loss = loss_on + loss_fr + 0.25 * loss_vel

            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

            total += float(loss.item())
            batches += 1
        print(f"epoch {epoch:03d}  loss={total/max(1,batches):.4f}  device={device}  batches={batches}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "meta": vars(args), "training_kind": "synthetic_corruption"}, out)
    print(f"Saved checkpoint: {out}")


if __name__ == "__main__":
    main()
