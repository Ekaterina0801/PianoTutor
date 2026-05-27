from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import math
import numpy as np
from pathlib import Path
from app.models import NoteEvent
from app.assistant.train_corrector.roll import RollConfig, notes_to_roll, roll_to_notes
from app.core.postprocessing import postprocess_notes
from app.core.scoring import score

try:
    import torch
except Exception:  # pragma: no cover
    torch = None  # type: ignore

@dataclass
class CorrectorConfig:
    enabled: bool = True
    mode: str = "heuristic"   # "off" | "heuristic" | "tcn" | "bilstm" | "transformer" | "experimental"
    ckpt_path: Optional[str] = None
    hop_s: float = 0.02
    onset_thr: float = 0.50
    frame_thr: float = 0.45
    quality_gate: bool = True
    min_gate_notes: int = 10
    min_apply_change_ratio: float = 0.015
    min_self_similarity: float = 0.80

NEURAL_MODES = {"tcn", "bilstm", "transformer"}

def _heuristic_correct(notes: List[NoteEvent]) -> List[NoteEvent]:
    if not notes:
        return []
    notes = sorted(notes, key=lambda x: (x.onset_s, x.midi_note))
    out: List[NoteEvent] = []
    for n in notes:
        dur = max(0.0, n.offset_s - n.onset_s)
        if dur < 0.02 and n.velocity < 10:
            continue
        off = min(n.offset_s, n.onset_s + 12.0)
        out.append(NoteEvent(onset_s=n.onset_s, offset_s=off, midi_note=n.midi_note, velocity=n.velocity))

    merged: List[NoteEvent] = []
    by = {}
    for n in out:
        by.setdefault(n.midi_note, []).append(n)
    for pitch, lst in by.items():
        lst.sort(key=lambda x: x.onset_s)
        cur = lst[0]
        for nn in lst[1:]:
            if nn.onset_s <= cur.offset_s + 0.06:
                cur = NoteEvent(
                    onset_s=min(cur.onset_s, nn.onset_s),
                    offset_s=max(cur.offset_s, nn.offset_s),
                    midi_note=pitch,
                    velocity=max(cur.velocity, nn.velocity),
                )
            else:
                merged.append(cur)
                cur = nn
        merged.append(cur)
    merged.sort(key=lambda x: (x.onset_s, x.midi_note))
    return merged

def _neural_output_plausibility(input_notes: List[NoteEvent], output_notes: List[NoteEvent]) -> Tuple[bool, Dict]:
    meta: Dict = {
        "input_notes": len(input_notes),
        "output_notes": len(output_notes),
        "reason": "ok",
    }
    if not input_notes:
        ok = not output_notes
        meta["reason"] = "empty_input" if ok else "empty_input_produced_notes"
        return ok, meta
    if len(input_notes) < 10:
        ok = bool(output_notes)
        meta["reason"] = "short_input_ok" if ok else "short_input_empty_output"
        return ok, meta
    if not output_notes:
        meta["reason"] = "empty_output"
        return False, meta

    count_ratio = len(output_notes) / max(1, len(input_notes))
    meta["count_ratio"] = float(count_ratio)
    if count_ratio < 0.65 or count_ratio > 1.45:
        meta["reason"] = "count_ratio_out_of_range"
        return False, meta

    in_duration = max(float(n.offset_s) for n in input_notes) - min(float(n.onset_s) for n in input_notes)
    out_duration = max(float(n.offset_s) for n in output_notes) - min(float(n.onset_s) for n in output_notes)
    meta["input_duration_s"] = float(in_duration)
    meta["output_duration_s"] = float(out_duration)
    meta["duration_ratio"] = float(out_duration / max(1e-9, in_duration))
    if in_duration > 2.0 and out_duration < in_duration * 0.55:
        meta["reason"] = "duration_collapse"
        return False, meta

    in_pitches = {int(n.midi_note) for n in input_notes}
    out_pitches = {int(n.midi_note) for n in output_notes}
    pitch_coverage = len(out_pitches & in_pitches) / max(1, len(in_pitches))
    meta["pitch_coverage"] = float(pitch_coverage)
    ok = pitch_coverage >= 0.35
    if not ok:
        meta["reason"] = "pitch_coverage_too_low"
    return ok, meta

def _neural_quality_gate(
    input_notes: List[NoteEvent],
    output_notes: List[NoteEvent],
    cfg: CorrectorConfig,
) -> Tuple[bool, Dict]:
    meta: Dict = {
        "quality_gate": "enabled",
        "min_gate_notes": int(cfg.min_gate_notes),
        "min_apply_change_ratio": float(cfg.min_apply_change_ratio),
        "min_self_similarity": float(cfg.min_self_similarity),
    }
    if len(input_notes) < cfg.min_gate_notes:
        meta["gate_reason"] = "short_input_gate_skipped"
        meta["gate_confidence"] = 1.0
        return True, meta
    if not output_notes:
        meta["gate_reason"] = "empty_output"
        meta["gate_confidence"] = 0.0
        return False, meta

    self_summary, _ = score(output_notes, input_notes, onset_tol=0.06)
    self_similarity = float(self_summary.get("f1", 0.0) or 0.0)
    count_change_ratio = abs(len(output_notes) - len(input_notes)) / max(1, len(input_notes))
    missed = int(self_summary.get("missed", 0) or 0)
    extra = int(self_summary.get("extra", 0) or 0)
    edit_change_ratio = (missed + extra) / max(1, len(input_notes))
    change_ratio = max(count_change_ratio, edit_change_ratio)

    meta.update({
        "self_similarity_f1": self_similarity,
        "count_change_ratio": float(count_change_ratio),
        "edit_change_ratio": float(edit_change_ratio),
        "change_ratio": float(change_ratio),
        "self_missed": missed,
        "self_extra": extra,
    })
    if self_similarity < cfg.min_self_similarity:
        meta["gate_reason"] = "self_similarity_too_low"
        meta["gate_confidence"] = self_similarity
        return False, meta
    if change_ratio < cfg.min_apply_change_ratio:
        meta["gate_reason"] = "tiny_neural_change"
        meta["gate_confidence"] = 1.0 - change_ratio / max(1e-9, cfg.min_apply_change_ratio)
        return False, meta
    meta["gate_reason"] = "accepted"
    meta["gate_confidence"] = min(1.0, change_ratio / max(1e-9, cfg.min_apply_change_ratio))
    return True, meta

class AssistantCorrector:
    def __init__(self, cfg: CorrectorConfig = CorrectorConfig()):
        self.cfg = cfg
        self._model = None
        self._model_mode = cfg.mode
        self.last_decision = "not_started"
        self.last_diagnostics: Dict = {}
        self._residual_anchor = False
        if cfg.mode in NEURAL_MODES and torch is not None and cfg.ckpt_path and Path(cfg.ckpt_path).exists():
            self._load_neural(cfg.mode, cfg.ckpt_path)

    def _load_neural(self, architecture: str, ckpt_path: str) -> None:
        from app.assistant.corrector_model import build_corrector_model
        self._model = build_corrector_model(architecture, channels=88*3)
        sd = torch.load(ckpt_path, map_location="cpu")
        if isinstance(sd, dict) and "state_dict" in sd:
            meta = sd.get("meta", {}) or {}
            self._residual_anchor = bool(meta.get("residual_anchor", False) or sd.get("residual_anchor", False))
            self._model_mode = str(sd.get("architecture") or architecture)
            sd = sd["state_dict"]
        self._model.load_state_dict(sd, strict=False)
        self._model.eval()

    def correct(self, notes: List[NoteEvent]) -> List[NoteEvent]:
        if not self.cfg.enabled or self.cfg.mode == "off":
            self.last_decision = "off"
            self.last_diagnostics = {"mode": "off"}
            return notes
        if self.cfg.mode == "heuristic":
            self.last_decision = "heuristic"
            self.last_diagnostics = {"mode": "heuristic", "input_notes": len(notes)}
            return _heuristic_correct(notes)
        if self.cfg.mode == "experimental":
            # Research-ready placeholder: deterministic ensemble baseline without training.
            corrected = _heuristic_correct(notes)
            corrected, _ = postprocess_notes(corrected)
            self.last_decision = "experimental_heuristic_ensemble"
            self.last_diagnostics = {"mode": "experimental", "input_notes": len(notes), "output_notes": len(corrected)}
            return corrected
        if self.cfg.mode in NEURAL_MODES and self._model is not None and torch is not None:
            return self._correct_neural(notes, self.cfg.mode)
        self.last_decision = f"heuristic_missing_{self.cfg.mode}"
        self.last_diagnostics = {
            "mode": self.cfg.mode,
            "reason": f"missing_{self.cfg.mode}_checkpoint_or_torch",
            "ckpt_path": self.cfg.ckpt_path,
            "torch_available": torch is not None,
        }
        return _heuristic_correct(notes)

    def _correct_neural(self, notes: List[NoteEvent], architecture: str) -> List[NoteEvent]:
        if not notes:
            self.last_decision = f"{architecture}_empty_input"
            self.last_diagnostics = {"mode": architecture, "input_notes": 0, "output_notes": 0, "reason": "empty_input"}
            return []
        duration_s = max(float(n.offset_s) for n in notes) + 0.5
        cfg = RollConfig(hop_s=self.cfg.hop_s)
        n_frames = max(4, int(math.ceil(duration_s / cfg.hop_s)) + 1)
        x = notes_to_roll(notes, n_frames=n_frames, cfg=cfg).astype(np.float32)
        with torch.no_grad():
            xt = torch.from_numpy(x).unsqueeze(0)
            pred = self._model(xt)
            if self._residual_anchor:
                base = torch.logit(xt.clamp(1e-4, 1.0 - 1e-4))
                pred = pred + base
            roll = torch.sigmoid(pred).squeeze(0).cpu().numpy()
        out = roll_to_notes(roll, cfg=cfg, onset_thr=self.cfg.onset_thr, frame_thr=self.cfg.frame_thr)
        out, _ = postprocess_notes(out)
        ok, diagnostics = _neural_output_plausibility(notes, out)
        self.last_diagnostics = {
            "mode": architecture,
            "loaded_architecture": self._model_mode,
            "residual_anchor": self._residual_anchor,
            "thresholds": {
                "onset_thr": float(self.cfg.onset_thr),
                "frame_thr": float(self.cfg.frame_thr),
            },
            **diagnostics,
        }
        if not ok:
            self.last_decision = f"{architecture}_guard_fallback_heuristic"
            return _heuristic_correct(notes)
        if self.cfg.quality_gate:
            accepted, gate_meta = _neural_quality_gate(notes, out, self.cfg)
            self.last_diagnostics.update(gate_meta)
            if not accepted:
                self.last_decision = f"{architecture}_quality_gate_fallback_heuristic"
                return _heuristic_correct(notes)
        else:
            self.last_diagnostics["quality_gate"] = "disabled"
        self.last_decision = f"{architecture}_applied"
        return out
