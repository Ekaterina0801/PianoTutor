from __future__ import annotations
import argparse
from pathlib import Path
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader

from app.assistant.corrector_model import PianoRollCorrector
from app.assistant.train_corrector.dataset import CorrectorDataset

def main():
    ap = argparse.ArgumentParser("train_corrector")
    ap.add_argument("--manifest", type=str, required=True, help="CSV/JSON with columns audio,midi[,name]")
    ap.add_argument("--sr", type=int, default=16000)
    ap.add_argument("--segment-s", type=float, default=10.0)
    ap.add_argument("--hop-s", type=float, default=0.02)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--num-workers", type=int, default=0)
    ap.add_argument("--no-augment", action="store_true")
    ap.add_argument("--cache-dir", type=str, default="data/cache_corrector")
    ap.add_argument("--device", type=str, default="auto", help="auto|cpu|cuda|mps")
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

    ds = CorrectorDataset(
        manifest=args.manifest,
        sr=args.sr,
        segment_s=args.segment_s,
        hop_s=args.hop_s,
        cache_dir=args.cache_dir,
        augment=not args.no_augment,
    )
    def collate_pad(batch):
        max_t = max(int(x.shape[-1]) for x, _ in batch)
        xs = []
        ys = []
        for x, y in batch:
            pad = max_t - int(x.shape[-1])
            xs.append(F.pad(x, (0, pad)))
            ys.append(F.pad(y, (0, pad)))
        return torch.stack(xs, dim=0), torch.stack(ys, dim=0)

    dl = DataLoader(
        ds,
        batch_size=args.batch,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=(device!="cpu"),
        collate_fn=collate_pad,
    )

    channels = 88 * 3
    model = PianoRollCorrector(channels=channels, layers=6, k=5).to(device)

    bce = nn.BCEWithLogitsLoss()
    mse = nn.MSELoss()

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-3)

    def split_roll(z):
        # z: (B, C, T) with C=3*88
        P = 88
        onset = z[:, :P, :]
        frame = z[:, P:2*P, :]
        vel = z[:, 2*P:3*P, :]
        return onset, frame, vel

    model.train()
    for epoch in range(1, args.epochs + 1):
        total = 0.0
        n = 0
        for x, y in dl:
            x = x.to(device, non_blocking=True)  # teacher roll (binary-ish)
            y = y.to(device, non_blocking=True)  # gt roll (binary)

            # normalize velocity channel to [-1,1] for stability (optional)
            # Here keep [0,1] but the model outputs logits; for vel we use sigmoid.
            pred = model(x)

            p_on, p_fr, p_vel = split_roll(pred)
            y_on, y_fr, y_vel = split_roll(y)

            loss_on = bce(p_on, y_on)
            loss_fr = bce(p_fr, y_fr)
            # velocity only where onset is present (gt)
            vel_mask = (y_on > 0.5).float()
            p_vel_sig = torch.sigmoid(p_vel)
            loss_vel = mse(p_vel_sig * vel_mask, y_vel * vel_mask)

            loss = loss_on + loss_fr + 0.5 * loss_vel

            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

            total += float(loss.item())
            n += 1

        avg = total / max(1, n)
        print(f"epoch {epoch:03d}  loss={avg:.4f}  device={device}  batches={n}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "meta": vars(args)}, out)
    print(f"Saved checkpoint: {out}")

if __name__ == "__main__":
    main()
