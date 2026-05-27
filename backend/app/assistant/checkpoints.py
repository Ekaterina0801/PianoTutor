from __future__ import annotations

import os
from pathlib import Path

NEURAL_MODES = {"tcn", "bilstm", "transformer"}

DEFAULT_CORRECTOR_CHECKPOINTS = {
    "tcn": "data/maestro_research/checkpoints/tcn_maestro.pt",
    "bilstm": "data/maestro_research/checkpoints/bilstm_maestro.pt",
    "transformer": "data/maestro_research/checkpoints/transformer_maestro.pt",
}

DEFAULT_CORRECTOR_THRESHOLDS = {
    "tcn": {"onset_thr": 0.45, "frame_thr": 0.45},
    "bilstm": {"onset_thr": 0.45, "frame_thr": 0.40},
    "transformer": {"onset_thr": 0.45, "frame_thr": 0.40},
}

CHECKPOINT_ENVS = {
    "tcn": ("TCN_CORRECTOR_CKPT", "CORRECTOR_CKPT"),
    "bilstm": ("BILSTM_CORRECTOR_CKPT",),
    "transformer": ("TRANSFORMER_CORRECTOR_CKPT",),
}

THRESHOLD_ENVS = {
    "tcn": ("TCN_ONSET_THR", "TCN_FRAME_THR"),
    "bilstm": ("BILSTM_ONSET_THR", "BILSTM_FRAME_THR"),
    "transformer": ("TRANSFORMER_ONSET_THR", "TRANSFORMER_FRAME_THR"),
}


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _resolve_checkpoint_path(path: str) -> str:
    candidate = Path(path)
    if candidate.is_absolute():
        return str(candidate)
    for base in (Path.cwd(), _backend_root(), _backend_root().parent):
        resolved = base / path
        if resolved.exists():
            return str(resolved)
    return path


def corrector_checkpoint_for_mode(mode: str) -> str | None:
    normalized = "heuristic" if mode == "on" else mode
    if normalized not in NEURAL_MODES:
        return None

    raw = None
    for env_name in CHECKPOINT_ENVS[normalized]:
        raw = os.getenv(env_name)
        if raw:
            break
    if not raw:
        raw = DEFAULT_CORRECTOR_CHECKPOINTS[normalized]
    return _resolve_checkpoint_path(raw)

def _float_env(name: str, fallback: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return fallback
    try:
        return float(raw)
    except ValueError:
        return fallback


def corrector_thresholds_for_mode(mode: str) -> dict:
    normalized = "heuristic" if mode == "on" else mode
    defaults = DEFAULT_CORRECTOR_THRESHOLDS.get(normalized, {"onset_thr": 0.50, "frame_thr": 0.45})
    if normalized not in NEURAL_MODES:
        return defaults
    onset_env, frame_env = THRESHOLD_ENVS[normalized]
    return {
        "onset_thr": _float_env(onset_env, float(defaults["onset_thr"])),
        "frame_thr": _float_env(frame_env, float(defaults["frame_thr"])),
    }


def corrector_checkpoint_status() -> dict:
    return {
        mode: {
            "path": path,
            "available": bool(path and Path(path).exists()),
            "thresholds": corrector_thresholds_for_mode(mode),
        }
        for mode in sorted(NEURAL_MODES)
        for path in [corrector_checkpoint_for_mode(mode)]
    }
