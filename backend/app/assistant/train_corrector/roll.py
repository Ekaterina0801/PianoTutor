from __future__ import annotations
from dataclasses import dataclass
from typing import List, Tuple
import numpy as np
from app.models import NoteEvent

A0 = 21
C8 = 108

@dataclass(frozen=True)
class RollConfig:
    hop_s: float = 0.02   # 50 fps
    pitches: int = 88     # A0..C8
    max_frames: int = 0   # 0 = derive from audio length / segment

def midi_to_pitch_index(midi_note: int) -> int:
    return midi_note - A0

def notes_to_roll(notes: List[NoteEvent], n_frames: int, cfg: RollConfig) -> np.ndarray:
    """Return roll as (C, T) float32 where C=3*pitches: onset, frame, vel."""
    P = cfg.pitches
    T = n_frames
    onset = np.zeros((P, T), dtype=np.float32)
    frame = np.zeros((P, T), dtype=np.float32)
    vel = np.zeros((P, T), dtype=np.float32)

    for n in notes:
        pi = midi_to_pitch_index(int(n.midi_note))
        if pi < 0 or pi >= P:
            continue
        s = int(round(float(n.onset_s) / cfg.hop_s))
        e = int(round(float(n.offset_s) / cfg.hop_s))
        s = max(0, min(T - 1, s))
        e = max(s + 1, min(T, e))
        onset[pi, s] = 1.0
        frame[pi, s:e] = 1.0
        vel[pi, s] = float(n.velocity) / 127.0

    return np.concatenate([onset, frame, vel], axis=0)  # (3P, T)

def roll_to_notes(roll: np.ndarray, cfg: RollConfig, onset_thr: float=0.5, frame_thr: float=0.5) -> List[NoteEvent]:
    """(Optional) simple roll->notes for debugging."""
    P = cfg.pitches
    onset = roll[:P]
    frame = roll[P:2*P]
    vel = roll[2*P:3*P]
    T = onset.shape[1]
    notes: List[NoteEvent] = []
    for p in range(P):
        on = onset[p] > onset_thr
        fr = frame[p] > frame_thr
        t = 0
        while t < T:
            if on[t]:
                s = t
                tt = t+1
                while tt < T and fr[tt]:
                    tt += 1
                onset_s = s * cfg.hop_s
                offset_s = tt * cfg.hop_s
                v = int(max(1, min(127, round(float(vel[p, s]) * 127))))
                notes.append(NoteEvent(onset_s=onset_s, offset_s=offset_s, midi_note=A0+p, velocity=v))
                t = tt
            else:
                t += 1
    notes.sort(key=lambda x: (x.onset_s, x.midi_note))
    return notes
