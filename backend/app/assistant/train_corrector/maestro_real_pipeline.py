from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, pstdev
from typing import Dict, Iterable, List, Sequence, Tuple

import numpy as np
import torch
import torch.nn.functional as F
from scipy.stats import wilcoxon
from torch.utils.data import DataLoader, Dataset

from app.assistant.corrector import AssistantCorrector, CorrectorConfig
from app.assistant.corrector_model import build_corrector_model
from app.assistant.train_corrector.midi_gt import midi_file_to_notes
from app.assistant.train_corrector.roll import RollConfig, notes_to_roll, roll_to_notes
from app.core.audio_io import load_audio
from app.core.btd_transcriber import BTDTranscriber
from app.core.postprocessing import postprocess_notes
from app.core.preprocessing import preprocess_audio
from app.core.research import run_synthetic_ablation
from app.core.scoring import score
from app.models import NoteEvent


CHANNELS = 88 * 3


@dataclass(frozen=True)
class Excerpt:
    id: str
    split: str
    year: int
    audio_path: str
    midi_path: str
    start_s: float
    duration_s: float
    composer: str
    title: str


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _safe_id(text: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in text)[:180]


def _hash_to_float(key: str, lo: float, hi: float) -> float:
    if hi <= lo:
        return lo
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()
    v = int(h[:12], 16) / float(16**12 - 1)
    return lo + v * (hi - lo)


def _metadata_rows(data_root: Path) -> List[Dict]:
    meta_path = data_root / "maestro-v3.0.0.json"
    raw = json.loads(meta_path.read_text(encoding="utf-8"))
    keys = sorted(int(k) for k in raw["audio_filename"].keys())
    rows = []
    for i in keys:
        k = str(i)
        audio = data_root / raw["audio_filename"][k]
        midi = data_root / raw["midi_filename"][k]
        if not audio.exists() or not midi.exists():
            continue
        duration = float(raw["duration"][k])
        rows.append(
            {
                "index": i,
                "split": raw["split"][k],
                "year": int(raw["year"][k]),
                "audio_path": str(audio),
                "midi_path": str(midi),
                "duration": duration,
                "composer": raw["canonical_composer"][k],
                "title": raw["canonical_title"][k],
            }
        )
    return rows


def _take_diverse(rows: Sequence[Dict], count: int, seed: int, duration_s: float) -> List[Dict]:
    rng = random.Random(seed)
    usable = [r for r in rows if float(r["duration"]) >= duration_s + 4.0]
    by_year: Dict[int, List[Dict]] = {}
    for r in usable:
        by_year.setdefault(int(r["year"]), []).append(r)
    for xs in by_year.values():
        rng.shuffle(xs)
    selected: List[Dict] = []
    years = sorted(by_year)
    cursor = 0
    while len(selected) < count and years:
        year = years[cursor % len(years)]
        bucket = by_year[year]
        if bucket:
            selected.append(bucket.pop())
        years = [y for y in years if by_year[y]]
        cursor += 1
    return selected[:count]


def build_manifest(data_root: Path, out: Path, samples: int, duration_s: float, seed: int) -> List[Excerpt]:
    rows = _metadata_rows(data_root)
    targets = {
        "train": max(8, int(round(samples * 0.60))),
        "validation": max(4, int(round(samples * 0.20))),
    }
    targets["test"] = max(4, samples - targets["train"] - targets["validation"])
    while sum(targets.values()) > samples:
        targets["train"] -= 1
    while sum(targets.values()) < samples:
        targets["train"] += 1

    excerpts: List[Excerpt] = []
    for split, count in targets.items():
        split_rows = [r for r in rows if r["split"] == split]
        picked = _take_diverse(split_rows, count, seed + len(excerpts) * 17, duration_s)
        for r in picked:
            max_start = max(0.0, float(r["duration"]) - duration_s - 1.0)
            start = _hash_to_float(f"{r['index']}:{seed}:{duration_s}", 1.0, max_start) if max_start > 1.0 else 0.0
            ex_id = _safe_id(f"maestro_{split}_{r['year']}_{r['index']}_{int(start * 1000)}")
            excerpts.append(
                Excerpt(
                    id=ex_id,
                    split=split,
                    year=int(r["year"]),
                    audio_path=r["audio_path"],
                    midi_path=r["midi_path"],
                    start_s=round(float(start), 3),
                    duration_s=float(duration_s),
                    composer=str(r["composer"]),
                    title=str(r["title"]),
                )
            )

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(Excerpt.__dataclass_fields__.keys()))
        writer.writeheader()
        for ex in excerpts:
            writer.writerow(ex.__dict__)
    return excerpts


def read_excerpts(path: Path) -> List[Excerpt]:
    with path.open("r", encoding="utf-8", newline="") as f:
        out = []
        for row in csv.DictReader(f):
            out.append(
                Excerpt(
                    id=row["id"],
                    split=row["split"],
                    year=int(row["year"]),
                    audio_path=row["audio_path"],
                    midi_path=row["midi_path"],
                    start_s=float(row["start_s"]),
                    duration_s=float(row["duration_s"]),
                    composer=row.get("composer", ""),
                    title=row.get("title", ""),
                )
            )
        return out


def _notes_to_json(notes: Sequence[NoteEvent]) -> List[Dict]:
    return [n.model_dump() for n in notes]


def _notes_from_json(xs: Sequence[Dict]) -> List[NoteEvent]:
    return [NoteEvent(**x) for x in xs]


def _crop_notes(notes: Sequence[NoteEvent], start_s: float, duration_s: float) -> List[NoteEvent]:
    end_s = start_s + duration_s
    out: List[NoteEvent] = []
    for n in notes:
        if n.offset_s <= start_s or n.onset_s >= end_s:
            continue
        onset = max(0.0, float(n.onset_s) - start_s)
        offset = min(duration_s, float(n.offset_s) - start_s)
        if offset <= onset:
            offset = min(duration_s, onset + 0.04)
        out.append(NoteEvent(onset_s=onset, offset_s=offset, midi_note=int(n.midi_note), velocity=int(n.velocity)))
    out.sort(key=lambda x: (x.onset_s, x.midi_note))
    return out


def prepare_cache(manifest: Path, cache_dir: Path, hop_s: float, rebuild: bool = False) -> List[Path]:
    excerpts = read_excerpts(manifest)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cfg = RollConfig(hop_s=hop_s)
    transcriber = BTDTranscriber()
    midi_cache: Dict[str, List[NoteEvent]] = {}
    cache_paths: List[Path] = []

    for ix, ex in enumerate(excerpts, start=1):
        npz_path = cache_dir / f"{_safe_id(ex.id)}.npz"
        meta_path = cache_dir / f"{_safe_id(ex.id)}.json"
        cache_paths.append(npz_path)
        if npz_path.exists() and meta_path.exists() and not rebuild:
            print(f"cache {ix:03d}/{len(excerpts)} hit {ex.id}", flush=True)
            continue

        audio, sr = load_audio(ex.audio_path, target_sr=44100)
        s0 = max(0, int(ex.start_s * sr))
        s1 = min(audio.shape[0], int((ex.start_s + ex.duration_s) * sr))
        processed, pre_meta = preprocess_audio(audio[s0:s1], sr)
        trim_start = float(pre_meta.get("trim", {}).get("trim_start_s", 0.0) or 0.0)
        final_duration = float(pre_meta.get("final", {}).get("duration_s", processed.shape[0] / sr) or 0.0)
        n_frames = int(math.ceil(final_duration / cfg.hop_s)) + 1

        if ex.midi_path not in midi_cache:
            midi_cache[ex.midi_path] = midi_file_to_notes(ex.midi_path)
        gt_notes = _crop_notes(midi_cache[ex.midi_path], ex.start_s + trim_start, final_duration)
        teacher_notes = [] if processed.size == 0 else transcriber.transcribe(processed, sr)
        x = notes_to_roll(teacher_notes, n_frames=n_frames, cfg=cfg).astype(np.float32)
        y = notes_to_roll(gt_notes, n_frames=n_frames, cfg=cfg).astype(np.float32)
        np.savez_compressed(npz_path, x=x, y=y)
        meta_path.write_text(
            json.dumps(
                {
                    "excerpt": ex.__dict__,
                    "preprocessing": pre_meta,
                    "teacher_notes": _notes_to_json(teacher_notes),
                    "ground_truth_notes": _notes_to_json(gt_notes),
                    "n_frames": n_frames,
                    "hop_s": hop_s,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"cache {ix:03d}/{len(excerpts)} built {ex.id} teacher={len(teacher_notes)} gt={len(gt_notes)}", flush=True)
    return cache_paths


class CachedRollDataset(Dataset):
    def __init__(self, cache_paths: Sequence[Path]):
        self.cache_paths = list(cache_paths)

    def __len__(self) -> int:
        return len(self.cache_paths)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        data = np.load(self.cache_paths[idx])
        return torch.from_numpy(data["x"].astype(np.float32)), torch.from_numpy(data["y"].astype(np.float32))


def collate_pad(batch: Sequence[Tuple[torch.Tensor, torch.Tensor]]) -> Tuple[torch.Tensor, torch.Tensor]:
    max_t = max(int(x.shape[-1]) for x, _ in batch)
    xs, ys = [], []
    for x, y in batch:
        pad = max_t - int(x.shape[-1])
        xs.append(F.pad(x, (0, pad)))
        ys.append(F.pad(y, (0, pad)))
    return torch.stack(xs, dim=0), torch.stack(ys, dim=0)


def split_roll(z: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    p = 88
    return z[:, :p, :], z[:, p : 2 * p, :], z[:, 2 * p : 3 * p, :]


def roll_loss(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    p_on, p_fr, p_vel = split_roll(logits)
    y_on, y_fr, y_vel = split_roll(target)
    loss_on = F.binary_cross_entropy_with_logits(p_on, y_on, pos_weight=torch.tensor(90.0, device=logits.device))
    loss_fr = F.binary_cross_entropy_with_logits(p_fr, y_fr, pos_weight=torch.tensor(14.0, device=logits.device))
    vel_mask = (y_on > 0.5).float()
    loss_vel = F.mse_loss(torch.sigmoid(p_vel) * vel_mask, y_vel * vel_mask)
    return loss_on + loss_fr + 0.25 * loss_vel


def raw_and_anchored_logits(model: torch.nn.Module, x: torch.Tensor, residual_anchor: bool) -> Tuple[torch.Tensor, torch.Tensor]:
    raw = model(x)
    if not residual_anchor:
        return raw, raw
    base = torch.logit(x.clamp(1e-4, 1.0 - 1e-4))
    return raw, raw + base


def anchored_logits(model: torch.nn.Module, x: torch.Tensor, residual_anchor: bool) -> torch.Tensor:
    _, anchored = raw_and_anchored_logits(model, x, residual_anchor)
    return anchored


def zero_output_head(model: torch.nn.Module) -> None:
    """Initialize residual correctors as identity: output residual starts at zero."""
    candidates = []
    if hasattr(model, "out"):
        candidates.append(getattr(model, "out"))
    if hasattr(model, "output"):
        output = getattr(model, "output")
        if isinstance(output, torch.nn.Sequential):
            candidates.extend(m for m in output.modules() if isinstance(m, (torch.nn.Linear, torch.nn.Conv1d)))
        else:
            candidates.append(output)
    for module in candidates:
        if isinstance(module, (torch.nn.Linear, torch.nn.Conv1d)):
            torch.nn.init.zeros_(module.weight)
            if module.bias is not None:
                torch.nn.init.zeros_(module.bias)


def evaluate_loss(model: torch.nn.Module, dl: DataLoader, device: str, residual_anchor: bool, residual_l2: float) -> float:
    model.eval()
    vals = []
    with torch.no_grad():
        for x, y in dl:
            x = x.to(device)
            y = y.to(device)
            raw, anchored = raw_and_anchored_logits(model, x, residual_anchor)
            loss = roll_loss(anchored, y)
            if residual_anchor and residual_l2 > 0.0:
                loss = loss + float(residual_l2) * torch.mean(raw * raw)
            vals.append(float(loss.item()))
    model.train()
    return float(mean(vals)) if vals else float("inf")


def _cache_paths_by_split(excerpts: Sequence[Excerpt], cache_dir: Path, split: str) -> List[Path]:
    return [cache_dir / f"{_safe_id(ex.id)}.npz" for ex in excerpts if ex.split == split]


def train_architecture(
    arch: str,
    train_paths: Sequence[Path],
    val_paths: Sequence[Path],
    out_dir: Path,
    *,
    device: str,
    epochs: int,
    batch: int,
    lr: float,
    patience: int,
    residual_anchor: bool,
    residual_l2: float,
    zero_residual_head: bool,
    init_ckpt: Path | None = None,
) -> Dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    model = build_corrector_model(arch, channels=CHANNELS).to(device)
    if arch == "tcn" and init_ckpt and init_ckpt.exists():
        state = torch.load(init_ckpt, map_location="cpu")
        sd = state.get("state_dict", state) if isinstance(state, dict) else state
        model.load_state_dict(sd, strict=False)
    if residual_anchor and zero_residual_head:
        zero_output_head(model)

    train_dl = DataLoader(CachedRollDataset(train_paths), batch_size=batch, shuffle=True, collate_fn=collate_pad)
    val_dl = DataLoader(CachedRollDataset(val_paths), batch_size=batch, shuffle=False, collate_fn=collate_pad)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-3)
    best = float("inf")
    bad_epochs = 0
    history = []
    best_path = out_dir / f"{arch}_maestro.pt"

    for epoch in range(1, epochs + 1):
        total = 0.0
        batches = 0
        model.train()
        for x, y in train_dl:
            x = x.to(device)
            y = y.to(device)
            raw, anchored = raw_and_anchored_logits(model, x, residual_anchor)
            loss = roll_loss(anchored, y)
            if residual_anchor and residual_l2 > 0.0:
                loss = loss + float(residual_l2) * torch.mean(raw * raw)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            total += float(loss.item())
            batches += 1
        train_loss = total / max(1, batches)
        val_loss = evaluate_loss(model, val_dl, device, residual_anchor, residual_l2)
        history.append({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss})
        print(f"{arch} epoch {epoch:03d} train={train_loss:.4f} val={val_loss:.4f}", flush=True)

        if val_loss < best - 1e-4:
            best = val_loss
            bad_epochs = 0
            torch.save(
                {
                    "state_dict": model.state_dict(),
                    "architecture": arch,
                    "history": history,
                    "meta": {
                        "residual_anchor": residual_anchor,
                        "residual_l2": residual_l2,
                        "zero_residual_head": zero_residual_head,
                        "training_kind": "maestro_teacher_to_gt",
                    },
                    "residual_anchor": residual_anchor,
                },
                best_path,
            )
        else:
            bad_epochs += 1
            if bad_epochs >= patience:
                print(f"{arch} early_stop epoch={epoch} best_val={best:.4f}", flush=True)
                break

    return {
        "architecture": arch,
        "checkpoint": str(best_path),
        "best_val_loss": best,
        "history": history,
        "residual_anchor": residual_anchor,
        "residual_l2": residual_l2,
        "zero_residual_head": zero_residual_head,
    }


def _load_model(arch: str, checkpoint: Path, device: str) -> Tuple[torch.nn.Module, bool]:
    model = build_corrector_model(arch, channels=CHANNELS).to(device)
    state = torch.load(checkpoint, map_location=device)
    model.load_state_dict(state["state_dict"], strict=False)
    model.eval()
    meta = state.get("meta", {}) or {}
    return model, bool(meta.get("residual_anchor", False) or state.get("residual_anchor", False))


def _load_cache_meta(npz_path: Path) -> Dict:
    return json.loads(npz_path.with_suffix(".json").read_text(encoding="utf-8"))


def _score_final_notes(notes: Sequence[NoteEvent], gt_notes: Sequence[NoteEvent]) -> Tuple[Dict, Dict, List[NoteEvent]]:
    final_notes, post_meta = postprocess_notes(list(notes))
    summary, _ = score(final_notes, list(gt_notes), onset_tol=0.12)
    return summary, post_meta, final_notes


def _predict_probs(model: torch.nn.Module, residual_anchor: bool, x: np.ndarray, device: str) -> Tuple[np.ndarray, torch.Tensor, torch.Tensor]:
    xt = torch.from_numpy(x).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = anchored_logits(model, xt, residual_anchor)
        probs = torch.sigmoid(logits).squeeze(0).cpu().numpy()
    return probs, logits.detach().cpu(), xt.detach().cpu()


def select_thresholds(
    validation_paths: Sequence[Path],
    models: Dict[str, Tuple[torch.nn.Module, bool]],
    *,
    device: str,
    hop_s: float,
) -> Dict[str, Dict]:
    cfg = RollConfig(hop_s=hop_s)
    onset_grid = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]
    frame_grid = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60]
    out: Dict[str, Dict] = {}
    for arch, (model, residual_anchor) in models.items():
        best = {
            "onset_thr": 0.50,
            "frame_thr": 0.45,
            "validation_f1": -1.0,
            "validation_robustness": -1.0,
            "validation_chord_f1": -1.0,
        }
        for onset_thr in onset_grid:
            for frame_thr in frame_grid:
                summaries = []
                for npz_path in validation_paths:
                    data = np.load(npz_path)
                    meta = _load_cache_meta(npz_path)
                    gt_notes = _notes_from_json(meta["ground_truth_notes"])
                    probs, _, _ = _predict_probs(model, residual_anchor, data["x"].astype(np.float32), device)
                    notes = roll_to_notes(probs, cfg=cfg, onset_thr=onset_thr, frame_thr=frame_thr)
                    summary, _, _ = _score_final_notes(notes, gt_notes)
                    summaries.append(summary)
                if not summaries:
                    continue
                f1 = float(mean(float(s.get("f1", 0.0) or 0.0) for s in summaries))
                chord = float(mean(float(s.get("chord_f1", 0.0) or 0.0) for s in summaries))
                robustness = float(mean(float(s.get("robustness_score", 0.0) or 0.0) for s in summaries))
                if (robustness, f1, chord) > (best["validation_robustness"], best["validation_f1"], best["validation_chord_f1"]):
                    best = {
                        "onset_thr": float(onset_thr),
                        "frame_thr": float(frame_thr),
                        "validation_f1": f1,
                        "validation_robustness": robustness,
                        "validation_chord_f1": chord,
                    }
        out[arch] = best
        print(
            f"{arch} thresholds onset={best['onset_thr']:.2f} frame={best['frame_thr']:.2f} "
            f"val_f1={best['validation_f1']:.3f} val_rob={best['validation_robustness']:.3f}",
            flush=True,
        )
    return out


def evaluate_models(
    cache_paths: Sequence[Path],
    checkpoints: Sequence[Dict],
    device: str,
    hop_s: float,
    validation_paths: Sequence[Path],
) -> Tuple[List[Dict], Dict, Dict]:
    cfg = RollConfig(hop_s=hop_s)
    models = {c["architecture"]: _load_model(c["architecture"], Path(c["checkpoint"]), device) for c in checkpoints}
    thresholds = select_thresholds(validation_paths, models, device=device, hop_s=hop_s)
    rows: List[Dict] = []
    calibration: Dict[str, Dict] = {}

    for npz_path in cache_paths:
        data = np.load(npz_path)
        x = data["x"].astype(np.float32)
        y = data["y"].astype(np.float32)
        meta = _load_cache_meta(npz_path)
        gt_notes = _notes_from_json(meta["ground_truth_notes"])
        teacher_original_notes = _notes_from_json(meta["teacher_notes"])
        summary, post_meta, final_teacher_original = _score_final_notes(teacher_original_notes, gt_notes)
        rows.append(
            {
                "id": meta["excerpt"]["id"],
                "split": meta["excerpt"]["split"],
                "year": meta["excerpt"]["year"],
                "model": "teacher_original",
                "summary": summary,
                "postprocessing": post_meta,
                "thresholds": None,
                "lineage": {
                    "teacher_notes": len(teacher_original_notes),
                    "final_notes": len(final_teacher_original),
                    "ground_truth_notes": len(gt_notes),
                    "source": "raw teacher note events",
                },
            }
        )

        teacher_roll_notes = roll_to_notes(x, cfg=cfg, onset_thr=0.50, frame_thr=0.45)
        summary, post_meta, final_teacher_roll = _score_final_notes(teacher_roll_notes, gt_notes)
        rows.append(
            {
                "id": meta["excerpt"]["id"],
                "split": meta["excerpt"]["split"],
                "year": meta["excerpt"]["year"],
                "model": "teacher_roll",
                "summary": summary,
                "postprocessing": post_meta,
                "thresholds": {"onset_thr": 0.50, "frame_thr": 0.45},
                "lineage": {
                    "teacher_notes": len(teacher_roll_notes),
                    "final_notes": len(final_teacher_roll),
                    "ground_truth_notes": len(gt_notes),
                    "source": "teacher roll decoded at fixed threshold",
                },
            }
        )

        heuristic_notes = AssistantCorrector(CorrectorConfig(mode="heuristic")).correct(teacher_original_notes)
        summary, post_meta, final_heuristic = _score_final_notes(heuristic_notes, gt_notes)
        rows.append(
            {
                "id": meta["excerpt"]["id"],
                "split": meta["excerpt"]["split"],
                "year": meta["excerpt"]["year"],
                "model": "heuristic_original",
                "summary": summary,
                "postprocessing": post_meta,
                "thresholds": None,
                "lineage": {
                    "teacher_notes": len(teacher_original_notes),
                    "final_notes": len(final_heuristic),
                    "ground_truth_notes": len(gt_notes),
                    "source": "heuristic over raw teacher note events",
                },
            }
        )

        yt = torch.from_numpy(y).unsqueeze(0).to(device)
        for arch, (model, residual_anchor) in models.items():
            probs, logits, _ = _predict_probs(model, residual_anchor, x, device)
            th = thresholds.get(arch, {"onset_thr": 0.50, "frame_thr": 0.45})
            notes = roll_to_notes(probs, cfg=cfg, onset_thr=float(th["onset_thr"]), frame_thr=float(th["frame_thr"]))
            summary, post_meta, final_notes = _score_final_notes(notes, gt_notes)
            rows.append(
                {
                    "id": meta["excerpt"]["id"],
                    "split": meta["excerpt"]["split"],
                    "year": meta["excerpt"]["year"],
                    "model": arch,
                    "summary": summary,
                    "postprocessing": post_meta,
                    "thresholds": th,
                    "lineage": {
                        "teacher_notes": len(teacher_original_notes),
                        "final_notes": len(final_notes),
                        "ground_truth_notes": len(gt_notes),
                        "source": "neural residual roll corrector",
                    },
                }
            )
            calibration.setdefault(arch, _new_calibration())
            _update_calibration(calibration[arch], logits.detach().cpu(), yt.detach().cpu())

    for arch, cal in calibration.items():
        calibration[arch] = _finalize_calibration(cal)
    return rows, calibration, thresholds


def _new_calibration(bins: int = 10) -> Dict:
    return {"bins": bins, "count": [0] * bins, "confidence_sum": [0.0] * bins, "accuracy_sum": [0.0] * bins}


def _update_calibration(cal: Dict, logits: torch.Tensor, target: torch.Tensor) -> None:
    p = 88
    probs = torch.sigmoid(logits[:, :p, :]).reshape(-1).numpy()
    labels = target[:, :p, :].reshape(-1).numpy()
    bins = int(cal["bins"])
    idxs = np.minimum(bins - 1, np.floor(probs * bins).astype(int))
    for b in range(bins):
        mask = idxs == b
        if not np.any(mask):
            continue
        cal["count"][b] += int(np.sum(mask))
        cal["confidence_sum"][b] += float(np.sum(probs[mask]))
        cal["accuracy_sum"][b] += float(np.sum(labels[mask]))


def _finalize_calibration(cal: Dict) -> Dict:
    total = max(1, sum(cal["count"]))
    rows = []
    ece = 0.0
    for b, count in enumerate(cal["count"]):
        conf = cal["confidence_sum"][b] / max(1, count)
        acc = cal["accuracy_sum"][b] / max(1, count)
        ece += (count / total) * abs(conf - acc)
        rows.append({"bin": b, "count": count, "avg_confidence": conf, "empirical_accuracy": acc})
    return {"ece": float(ece), "bins": rows}


def aggregate_rows(rows: Sequence[Dict], baseline_model: str = "teacher_original") -> List[Dict]:
    grouped: Dict[str, List[Dict]] = {}
    for r in rows:
        grouped.setdefault(r["model"], []).append(r)
    out = []
    for model, xs in grouped.items():
        item = {"model": model, "samples": len(xs)}
        for key in ["f1", "chord_f1", "mae_s", "robustness_score", "left_f1", "right_f1"]:
            vals = [float(x["summary"].get(key, 0.0) or 0.0) for x in xs]
            item[key] = float(mean(vals)) if vals else 0.0
            item[f"{key}_std"] = float(pstdev(vals)) if len(vals) > 1 else 0.0
        out.append(item)
    baseline = next((x for x in out if x["model"] == baseline_model), out[0] if out else {})
    for item in out:
        item["delta_f1"] = float(item.get("f1", 0.0) - baseline.get("f1", 0.0))
        item["delta_robustness"] = float(item.get("robustness_score", 0.0) - baseline.get("robustness_score", 0.0))
    out.sort(key=lambda x: (x["robustness_score"], x["f1"]), reverse=True)
    return out


def permutation_pvalue(diffs: Sequence[float], rounds: int = 20000, seed: int = 123) -> float:
    xs = np.array(list(diffs), dtype=np.float64)
    xs = xs[np.isfinite(xs)]
    if xs.size == 0:
        return 1.0
    observed = abs(float(np.mean(xs)))
    rng = np.random.default_rng(seed)
    hits = 0
    for _ in range(rounds):
        signs = rng.choice([-1.0, 1.0], size=xs.size)
        if abs(float(np.mean(xs * signs))) >= observed:
            hits += 1
    return float((hits + 1) / (rounds + 1))


def significance(rows: Sequence[Dict], baseline: str = "teacher_original") -> List[Dict]:
    by_id_model: Dict[Tuple[str, str], Dict] = {(r["id"], r["model"]): r for r in rows}
    ids = sorted({r["id"] for r in rows if (r["id"], baseline) in by_id_model})
    models = sorted({r["model"] for r in rows if r["model"] != baseline})
    out = []
    for model in models:
        for metric in ["f1", "chord_f1", "robustness_score"]:
            diffs = []
            for ex_id in ids:
                a = by_id_model.get((ex_id, model))
                b = by_id_model.get((ex_id, baseline))
                if not a or not b:
                    continue
                diffs.append(float(a["summary"].get(metric, 0.0) or 0.0) - float(b["summary"].get(metric, 0.0) or 0.0))
            if not diffs:
                continue
            try:
                p_w = float(wilcoxon(diffs).pvalue) if any(abs(d) > 1e-12 for d in diffs) else 1.0
            except Exception:
                p_w = 1.0
            out.append(
                {
                    "model": model,
                    "metric": metric,
                    "n": len(diffs),
                    "mean_delta": float(mean(diffs)),
                    "permutation_p": permutation_pvalue(diffs),
                    "wilcoxon_p": p_w,
                }
            )
    return out


def seed_significance(checkpoint: Path, samples: int, seed_count: int) -> Dict:
    res = run_synthetic_ablation(
        {
            "samples": samples,
            "seed": 42,
            "seed_count": seed_count,
            "assistant_modes": ["off", "tcn"],
            "aligner_modes": ["offset", "safe_linear_dtw"],
            "ckpt_path": str(checkpoint),
        }
    )
    rows = res["rows"]
    per_seed: Dict[Tuple[int, str], List[float]] = {}
    for r in rows:
        key = (int(r["seed_ix"]), f"{r['assistant_mode']}+{r['aligner_mode']}")
        per_seed.setdefault(key, []).append(float(r["summary"].get("robustness_score", 0.0) or 0.0))
    diffs = []
    for ix in range(seed_count):
        t = per_seed.get((ix, "tcn+safe_linear_dtw"), [])
        b = per_seed.get((ix, "off+offset"), [])
        if t and b:
            diffs.append(float(mean(t) - mean(b)))
    return {
        "samples_per_seed": samples,
        "seed_count": seed_count,
        "mean_delta_robustness": float(mean(diffs)) if diffs else 0.0,
        "permutation_p": permutation_pvalue(diffs) if diffs else 1.0,
        "per_seed_deltas": diffs,
    }


def write_report(out_md: Path, result: Dict) -> None:
    lines = [
        "# MAESTRO Real Fine-Tune Research Run",
        "",
        f"Dataset root: `{result['data_root']}`",
        f"Manifest: `{result['manifest']}`",
        f"Excerpts: {result['excerpt_count']} × {result['duration_s']} s",
        "",
        "## Training",
        "",
        "| architecture | checkpoint | best val loss | epochs run |",
        "|---|---|---:|---:|",
    ]
    for row in result["training"]:
        lines.append(f"| {row['architecture']} | `{row['checkpoint']}` | {row['best_val_loss']:.4f} | {len(row['history'])} |")

    lines.extend(["", "## Validation Threshold Search", "", "| model | onset thr | frame thr | validation F1 | validation robustness |", "|---|---:|---:|---:|---:|"])
    for model, th in result.get("thresholds", {}).items():
        lines.append(
            f"| {model} | {th['onset_thr']:.2f} | {th['frame_thr']:.2f} | {th['validation_f1']:.3f} | {th['validation_robustness']:.3f} |"
        )

    def add_aggregate(title: str, rows: Sequence[Dict]) -> None:
        lines.extend(["", f"## {title}", "", "| model | samples | F1 ± std | ΔF1 | Chord F1 | Robustness ± std | ΔRob |", "|---|---:|---:|---:|---:|---:|---:|"])
        for row in rows:
            lines.append(
                f"| {row['model']} | {row['samples']} | {row['f1']:.3f} ± {row['f1_std']:.3f} | {row['delta_f1']:+.3f} | {row['chord_f1']:.3f} | {row['robustness_score']:.3f} ± {row['robustness_score_std']:.3f} | {row['delta_robustness']:+.3f} |"
            )

    add_aggregate("Test-Only Evaluation", result["aggregate_by_split"].get("test", []))
    add_aggregate("Validation Evaluation", result["aggregate_by_split"].get("validation", []))
    add_aggregate("Train Evaluation", result["aggregate_by_split"].get("train", []))
    add_aggregate("All Excerpts Evaluation", result["aggregate"])

    lines.extend(["", "## Teacher Quantization Check", ""])
    teacher_original = next((x for x in result["aggregate"] if x["model"] == "teacher_original"), None)
    teacher_roll = next((x for x in result["aggregate"] if x["model"] == "teacher_roll"), None)
    if teacher_original and teacher_roll:
        lines.append(
            f"- `teacher_roll` vs `teacher_original`: ΔF1 {teacher_roll['f1'] - teacher_original['f1']:+.4f}, "
            f"ΔRobustness {teacher_roll['robustness_score'] - teacher_original['robustness_score']:+.4f}."
        )

    lines.extend(["", "## Calibration", "", "| model | onset ECE |", "|---|---:|"])
    for model, cal in result["calibration"].items():
        lines.append(f"| {model} | {cal['ece']:.4f} |")

    lines.extend(["", "## Statistical Significance Across Test Excerpts", "", "| model | metric | n | mean delta | permutation p | Wilcoxon p |", "|---|---|---:|---:|---:|---:|"])
    for row in result["significance_test"]:
        lines.append(f"| {row['model']} | {row['metric']} | {row['n']} | {row['mean_delta']:+.4f} | {row['permutation_p']:.4f} | {row['wilcoxon_p']:.4f} |")

    lines.extend(["", "## Statistical Significance Across All Excerpts", "", "| model | metric | n | mean delta | permutation p | Wilcoxon p |", "|---|---|---:|---:|---:|---:|"])
    for row in result["significance_excerpts"]:
        lines.append(f"| {row['model']} | {row['metric']} | {row['n']} | {row['mean_delta']:+.4f} | {row['permutation_p']:.4f} | {row['wilcoxon_p']:.4f} |")

    syn = result.get("significance_seeds")
    if syn:
        lines.extend(["", "## Statistical Significance Across Synthetic Seeds", ""])
        lines.append(f"- seed_count: {syn['seed_count']}")
        lines.append(f"- samples_per_seed: {syn['samples_per_seed']}")
        lines.append(f"- mean ΔRobustness `tcn+safe_linear_dtw` vs `off+offset`: {syn['mean_delta_robustness']:+.4f}")
        lines.append(f"- permutation p: {syn['permutation_p']:.4f}")

    lines.extend(["", "## Interpretation", ""])
    lines.append("- MAESTRO fine-tune uses real teacher-output -> ground-truth MIDI pairs, not synthetic corruptions.")
    lines.append("- Validation split and early stopping are active for every neural wrapper.")
    lines.append("- Thresholds are selected on validation and the main claim is read from the test-only table.")
    lines.append("- `teacher_original` is reported separately from `teacher_roll` to measure quantization loss.")
    lines.append("- Residual anchor is enabled: models predict corrections over teacher logits instead of replacing AMT output from scratch.")
    lines.append("- Residual heads are zero-initialized and regularized, so training starts from the teacher baseline.")
    lines.append("- BiLSTM and Transformer are trained/evaluated as wrappers under the same protocol.")
    lines.append("- Calibration ECE estimates whether onset probabilities can be interpreted as confidence labels.")
    lines.append("- Excerpt-level and seed-level tests are reported as paired non-parametric evidence, not as absolute proof.")

    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser("maestro_real_pipeline")
    ap.add_argument("--data-root", default="/Volumes/Kingston XS2000/piano_transcriber/piano_transcription/data")
    ap.add_argument("--work-dir", default="backend/data/maestro_research")
    ap.add_argument("--samples", type=int, default=20)
    ap.add_argument("--duration-s", type=float, default=10.0)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--hop-s", type=float, default=0.02)
    ap.add_argument("--architectures", default="tcn,bilstm,transformer")
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--patience", type=int, default=3)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--init-tcn", default="backend/data/corrector_ckpt.pt")
    ap.add_argument("--no-residual-anchor", action="store_true")
    ap.add_argument("--residual-l2", type=float, default=0.002)
    ap.add_argument("--no-zero-residual-head", action="store_true")
    ap.add_argument("--rebuild-manifest", action="store_true")
    ap.add_argument("--rebuild-cache", action="store_true")
    ap.add_argument("--synthetic-stat-samples", type=int, default=8)
    ap.add_argument("--synthetic-stat-seeds", type=int, default=5)
    ap.add_argument("--out-json", default="docs/maestro_real_research_results.json")
    ap.add_argument("--out-md", default="docs/MAESTRO_REAL_RESEARCH_RUN.md")
    args = ap.parse_args()

    device = args.device
    if device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

    data_root = Path(args.data_root)
    work_dir = Path(args.work_dir)
    manifest = work_dir / "maestro_real_excerpts.csv"
    if args.rebuild_manifest or not manifest.exists():
        excerpts = build_manifest(data_root, manifest, args.samples, args.duration_s, args.seed)
    else:
        excerpts = read_excerpts(manifest)

    cache_dir = work_dir / "cache"
    prepare_cache(manifest, cache_dir, hop_s=args.hop_s, rebuild=args.rebuild_cache)
    excerpts = read_excerpts(manifest)

    train_paths = _cache_paths_by_split(excerpts, cache_dir, "train")
    val_paths = _cache_paths_by_split(excerpts, cache_dir, "validation")
    test_paths = _cache_paths_by_split(excerpts, cache_dir, "test")
    all_paths = train_paths + val_paths + test_paths

    ckpt_dir = work_dir / "checkpoints"
    trained = []
    for arch in [x.strip() for x in args.architectures.split(",") if x.strip()]:
        trained.append(
            train_architecture(
                arch,
                train_paths,
                val_paths,
                ckpt_dir,
                device=device,
                epochs=args.epochs,
                batch=args.batch,
                lr=args.lr,
                patience=args.patience,
                residual_anchor=not args.no_residual_anchor,
                residual_l2=args.residual_l2,
                zero_residual_head=not args.no_zero_residual_head,
                init_ckpt=Path(args.init_tcn),
            )
        )

    rows, calibration, thresholds = evaluate_models(all_paths, trained, device=device, hop_s=args.hop_s, validation_paths=val_paths)
    aggregate = aggregate_rows(rows)
    aggregate_by_split = {
        split: aggregate_rows([r for r in rows if r["split"] == split])
        for split in ["train", "validation", "test"]
    }
    sig_excerpts = significance(rows)
    sig_test = significance([r for r in rows if r["split"] == "test"])
    tcn_ckpt = next((Path(x["checkpoint"]) for x in trained if x["architecture"] == "tcn"), Path(args.init_tcn))
    sig_seeds = seed_significance(tcn_ckpt, samples=args.synthetic_stat_samples, seed_count=args.synthetic_stat_seeds)

    result = {
        "data_root": str(data_root),
        "manifest": str(manifest),
        "excerpt_count": len(excerpts),
        "duration_s": args.duration_s,
        "splits": {"train": len(train_paths), "validation": len(val_paths), "test": len(test_paths)},
        "training": trained,
        "aggregate": aggregate,
        "aggregate_by_split": aggregate_by_split,
        "rows": rows,
        "thresholds": thresholds,
        "calibration": calibration,
        "significance_excerpts": sig_excerpts,
        "significance_test": sig_test,
        "significance_seeds": sig_seeds,
    }
    out_json = Path(args.out_json)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(Path(args.out_md), result)
    print(f"wrote {out_json}")
    print(f"wrote {args.out_md}")


if __name__ == "__main__":
    main()
