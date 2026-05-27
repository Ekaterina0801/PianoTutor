from __future__ import annotations
from dataclasses import dataclass
from typing import List, Tuple
import numpy as np
from app.models import NoteEvent

@dataclass
class AlignerConfig:
    mode: str = "basic"  # "basic" | "dtw"

def _onset_seq(notes: List[NoteEvent], max_len: int = 4000) -> np.ndarray:
    xs = np.array([n.onset_s for n in notes], dtype=np.float32)
    if xs.size > max_len:
        idx = np.linspace(0, xs.size-1, max_len).astype(int)
        xs = xs[idx]
    return xs

def dtw_warp(expected: List[NoteEvent], performed: List[NoteEvent]) -> Tuple[float, float]:
    """Robust linear time-warp from onset quantiles: t' = a*t + b."""
    xe = _onset_seq(expected)
    xp = _onset_seq(performed)
    if xe.size < 2 or xp.size < 2:
        return 1.0, 0.0
    qs = np.linspace(0.05, 0.95, 9)
    qe = np.quantile(xe, qs)
    qp = np.quantile(xp, qs)
    A = np.vstack([qe, np.ones_like(qe)]).T
    a, b = np.linalg.lstsq(A, qp, rcond=None)[0]
    a = float(np.clip(a, 0.5, 2.0))
    b = float(b)
    return a, b

def apply_time_warp(notes: List[NoteEvent], a: float, b: float) -> List[NoteEvent]:
    return [NoteEvent(onset_s=a*n.onset_s + b, offset_s=a*n.offset_s + b, midi_note=n.midi_note, velocity=n.velocity) for n in notes]
