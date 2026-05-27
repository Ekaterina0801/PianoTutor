from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import json
import numpy as np
import torch
from torch.utils.data import Dataset

from app.core.audio_io import load_audio
from app.assistant.train_corrector.midi_gt import midi_file_to_notes
from app.assistant.train_corrector.roll import RollConfig, notes_to_roll
from app.assistant.train_corrector.augment import random_gain, add_noise_snr, time_shift

# Teacher: uses the existing heavy transcriber (BTD) to generate pseudo-label input
from app.core.btd_transcriber import BTDTranscriber

@dataclass
class Pair:
    audio: str
    midi: str
    name: str = ""

def read_manifest(path: str) -> List[Pair]:
    p = Path(path)
    if p.suffix.lower() in [".json"]:
        xs = json.loads(p.read_text(encoding="utf-8"))
        return [Pair(**x) for x in xs]
    # CSV: audio,midi,name
    rows = p.read_text(encoding="utf-8").strip().splitlines()
    out: List[Pair] = []
    for i, line in enumerate(rows):
        if i == 0 and "audio" in line and "midi" in line:
            continue
        parts = [x.strip() for x in line.split(",")]
        if len(parts) < 2:
            continue
        out.append(Pair(audio=parts[0], midi=parts[1], name=(parts[2] if len(parts) > 2 else "")))
    return out

class CorrectorDataset(Dataset):
    """Builds (x,y) where x = teacher_roll, y = gt_roll."""
    def __init__(
        self,
        manifest: str,
        sr: int = 16000,
        segment_s: float = 10.0,
        hop_s: float = 0.02,
        cache_dir: Optional[str] = "data/cache_corrector",
        augment: bool = True,
        seed: int = 123,
    ):
        super().__init__()
        self.pairs = read_manifest(manifest)
        self.sr = sr
        self.segment_s = float(segment_s)
        self.cfg = RollConfig(hop_s=float(hop_s))
        self.augment = augment
        self.rng = np.random.default_rng(seed)
        self.cache_dir = Path(cache_dir) if cache_dir else None
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.teacher = BTDTranscriber()

    def __len__(self) -> int:
        return len(self.pairs)

    def _cache_key(self, pair: Pair) -> str:
        base = (Path(pair.audio).stem + "__" + Path(pair.midi).stem).replace(" ", "_")
        return base

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        pair = self.pairs[idx]
        audio, sr = load_audio(pair.audio, target_sr=self.sr)
        assert sr == self.sr

        # optionally augment audio before teacher to learn robustness to mic/noise
        if self.augment:
            if self.rng.random() < 0.8:
                audio = random_gain(audio, self.rng)
            if self.rng.random() < 0.5:
                audio = add_noise_snr(audio, snr_db=float(self.rng.uniform(8, 25)), rng=self.rng)
            if self.rng.random() < 0.3:
                audio = time_shift(audio, shift_s=float(self.rng.uniform(-0.08, 0.08)), sr=self.sr)

        # pick random segment
        seg_len = int(round(self.segment_s * self.sr))
        if audio.shape[0] > seg_len:
            start = int(self.rng.integers(0, audio.shape[0] - seg_len))
            audio_seg = audio[start:start+seg_len]
            t0 = start / self.sr
        else:
            audio_seg = audio
            t0 = 0.0

        n_frames = int(np.ceil((audio_seg.shape[0] / self.sr) / self.cfg.hop_s)) + 1

        # GT notes from MIDI, shifted into segment coordinates
        gt_notes = midi_file_to_notes(pair.midi)
        gt_seg = []
        t1 = t0 + (audio_seg.shape[0] / self.sr)
        for n in gt_notes:
            if n.offset_s < t0 or n.onset_s > t1:
                continue
            gt_seg.append(type(n)(onset_s=float(n.onset_s - t0), offset_s=float(n.offset_s - t0), midi_note=n.midi_note, velocity=n.velocity))

        y = notes_to_roll(gt_seg, n_frames=n_frames, cfg=self.cfg)

        # Teacher roll caching
        x = None
        if self.cache_dir and not self.augment:
            key = self._cache_key(pair) + f"__{int(t0*1000)}ms__{int(self.segment_s*1000)}ms.npz"
            fp = self.cache_dir / key
            if fp.exists():
                x = np.load(fp)["x"].astype(np.float32)

        if x is None:
            teacher_notes = self.teacher.transcribe(audio_seg, sr=self.sr)
            x = notes_to_roll(teacher_notes, n_frames=n_frames, cfg=self.cfg).astype(np.float32)
            if self.cache_dir and not self.augment:
                np.savez_compressed(fp, x=x)

        # torch (C,T)
        return torch.from_numpy(x), torch.from_numpy(y)
