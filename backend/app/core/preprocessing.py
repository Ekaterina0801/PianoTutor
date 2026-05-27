from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np


@dataclass(frozen=True)
class AudioPreprocessConfig:
    target_peak: float = 0.92
    silence_threshold: float = 0.012
    noise_gate_threshold: float = 0.008
    min_keep_s: float = 0.25
    segment_s: float = 20.0
    min_transcribe_peak: float = 0.025
    min_transcribe_rms: float = 0.0025
    steady_noise_peak_ceiling: float = 0.07
    steady_noise_rms_ceiling: float = 0.03
    min_dynamic_ratio: float = 1.8
    normalize_min_peak: float = 0.025
    max_normalize_gain: float = 4.0


def describe_audio(x: np.ndarray, sr: int) -> Dict[str, float]:
    if x.size == 0:
        return {"duration_s": 0.0, "peak": 0.0, "rms": 0.0, "silence_ratio": 1.0}
    abs_x = np.abs(x)
    rms = float(np.sqrt(np.mean(x * x) + 1e-12))
    return {
        "duration_s": float(x.shape[0] / sr),
        "peak": float(np.max(abs_x)),
        "rms": rms,
        "silence_ratio": float(np.mean(abs_x < 0.01)),
    }


def frame_activity(x: np.ndarray, sr: int) -> Dict[str, float]:
    if x.size == 0:
        return {"frame_rms_max": 0.0, "frame_rms_median": 0.0, "frame_rms_p95": 0.0, "dynamic_ratio": 0.0}
    frame = max(1, int(0.04 * sr))
    hop = max(1, int(0.02 * sr))
    values = []
    for start in range(0, max(1, x.size - frame + 1), hop):
        chunk = x[start : start + frame]
        if chunk.size:
            values.append(float(np.sqrt(np.mean(chunk * chunk) + 1e-12)))
    if not values:
        values = [float(np.sqrt(np.mean(x * x) + 1e-12))]
    arr = np.asarray(values, dtype=np.float32)
    median = float(np.median(arr))
    p95 = float(np.percentile(arr, 95))
    return {
        "frame_rms_max": float(np.max(arr)),
        "frame_rms_median": median,
        "frame_rms_p95": p95,
        "dynamic_ratio": float(p95 / (median + 1e-6)),
    }


def should_skip_transcription(meta: Dict[str, float], activity: Dict[str, float], cfg: AudioPreprocessConfig) -> Tuple[bool, str]:
    if meta["duration_s"] <= 0:
        return True, "empty_audio"
    too_quiet = meta["peak"] < cfg.min_transcribe_peak and meta["rms"] < cfg.min_transcribe_rms
    mostly_floor = meta["silence_ratio"] > 0.995 and meta["peak"] < cfg.min_transcribe_peak * 2
    steady_low_noise = (
        meta["peak"] < cfg.steady_noise_peak_ceiling
        and meta["rms"] < cfg.steady_noise_rms_ceiling
        and activity["dynamic_ratio"] < cfg.min_dynamic_ratio
    )
    if too_quiet:
        return True, "below_music_level"
    if mostly_floor:
        return True, "mostly_silence"
    if steady_low_noise:
        return True, "steady_noise_floor"
    return False, ""


def normalize_loudness(
    x: np.ndarray,
    target_peak: float,
    min_peak: float,
    max_gain: float,
) -> Tuple[np.ndarray, Dict[str, float]]:
    if x.size == 0:
        return x.astype(np.float32, copy=False), {
            "gain": 1.0,
            "peak_before": 0.0,
            "peak_after": 0.0,
            "skipped": 1.0,
        }
    peak = float(np.max(np.abs(x)) + 1e-9)
    if peak < min_peak:
        return x.astype(np.float32, copy=False), {
            "gain": 1.0,
            "peak_before": peak,
            "peak_after": float(np.max(np.abs(x)) if x.size else 0.0),
            "skipped": 1.0,
        }
    gain = min(max_gain, target_peak / peak)
    y = (x * gain).astype(np.float32, copy=False)
    return y, {
        "gain": float(gain),
        "peak_before": peak,
        "peak_after": float(np.max(np.abs(y)) if y.size else 0.0),
        "skipped": 0.0,
    }


def trim_silence(x: np.ndarray, sr: int, threshold: float, min_keep_s: float) -> Tuple[np.ndarray, Dict[str, float]]:
    if x.size == 0:
        return x, {"trim_start_s": 0.0, "trim_end_s": 0.0}
    idx = np.flatnonzero(np.abs(x) >= threshold)
    if idx.size == 0:
        keep = int(min_keep_s * sr)
        return x[:keep].astype(np.float32, copy=False), {"trim_start_s": 0.0, "trim_end_s": max(0.0, (x.size - keep) / sr)}
    start = max(0, int(idx[0] - 0.04 * sr))
    end = min(x.size, int(idx[-1] + 0.08 * sr))
    return x[start:end].astype(np.float32, copy=False), {
        "trim_start_s": float(start / sr),
        "trim_end_s": float((x.size - end) / sr),
    }


def noise_gate(x: np.ndarray, threshold: float) -> Tuple[np.ndarray, Dict[str, float]]:
    if x.size == 0:
        return x, {"gated_ratio": 0.0}
    y = x.copy()
    mask = np.abs(y) < threshold
    y[mask] = 0.0
    return y.astype(np.float32, copy=False), {"gated_ratio": float(np.mean(mask))}


def make_segments(x: np.ndarray, sr: int, segment_s: float) -> List[Dict[str, float]]:
    if x.size == 0:
        return []
    seg_len = max(1, int(segment_s * sr))
    out = []
    for start in range(0, x.size, seg_len):
        end = min(x.size, start + seg_len)
        out.append({"t0_s": float(start / sr), "t1_s": float(end / sr), "samples": int(end - start)})
    return out


def preprocess_audio(x: np.ndarray, sr: int, cfg: AudioPreprocessConfig = AudioPreprocessConfig()) -> Tuple[np.ndarray, Dict]:
    raw = describe_audio(x, sr)
    raw_activity = frame_activity(x, sr)
    skip, reason = should_skip_transcription(raw, raw_activity, cfg)
    if skip:
        empty = np.zeros(0, dtype=np.float32)
        return empty, {
            "raw": raw,
            "raw_activity": raw_activity,
            "trim": {"trim_start_s": 0.0, "trim_end_s": 0.0, "skipped": 1.0},
            "noise_gate": {"gated_ratio": 1.0, "skipped": 1.0},
            "normalization": {"gain": 1.0, "peak_before": raw["peak"], "peak_after": 0.0, "skipped": 1.0},
            "final": describe_audio(empty, sr),
            "segments": [],
            "skipped": {"reason": reason},
        }

    y, trim_meta = trim_silence(x.astype(np.float32, copy=False), sr, cfg.silence_threshold, cfg.min_keep_s)
    y, gate_meta = noise_gate(y, cfg.noise_gate_threshold)
    gated = describe_audio(y, sr)
    gated_activity = frame_activity(y, sr)
    skip, reason = should_skip_transcription(gated, gated_activity, cfg)
    if skip:
        empty = np.zeros(0, dtype=np.float32)
        return empty, {
            "raw": raw,
            "raw_activity": raw_activity,
            "trim": trim_meta,
            "noise_gate": gate_meta,
            "gated": gated,
            "gated_activity": gated_activity,
            "normalization": {"gain": 1.0, "peak_before": gated["peak"], "peak_after": 0.0, "skipped": 1.0},
            "final": describe_audio(empty, sr),
            "segments": [],
            "skipped": {"reason": reason},
        }

    y, norm_meta = normalize_loudness(y, cfg.target_peak, cfg.normalize_min_peak, cfg.max_normalize_gain)
    final = describe_audio(y, sr)
    return y, {
        "raw": raw,
        "raw_activity": raw_activity,
        "trim": trim_meta,
        "noise_gate": gate_meta,
        "gated": gated,
        "gated_activity": gated_activity,
        "normalization": norm_meta,
        "final": final,
        "segments": make_segments(y, sr, cfg.segment_s),
    }
