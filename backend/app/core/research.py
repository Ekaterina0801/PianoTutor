from __future__ import annotations

import random
from pathlib import Path
from statistics import mean, pstdev
from typing import Dict, Iterable, List, Tuple

from app.assistant.aligner import apply_time_warp, dtw_warp
from app.assistant.checkpoints import NEURAL_MODES, corrector_checkpoint_for_mode, corrector_thresholds_for_mode
from app.assistant.corrector import AssistantCorrector, CorrectorConfig
from app.core.postprocessing import postprocess_notes
from app.core.scoring import score
from app.models import NoteEvent


def generate_pattern(seed: int, idx: int) -> List[NoteEvent]:
    rng = random.Random(seed + idx * 997)
    root = rng.choice([48, 50, 52, 53, 55, 57, 60])
    bpm = rng.choice([72, 84, 96, 108, 120])
    beat = 60.0 / bpm
    notes: List[NoteEvent] = []
    t = 0.0
    for bar in range(4):
        if bar % 2 == 0:
            scale = [0, 2, 4, 5, 7, 9, 11, 12]
            for step in scale:
                midi = root + step
                notes.append(NoteEvent(onset_s=t, offset_s=t + beat * 0.72, midi_note=midi, velocity=80 + rng.randint(-12, 16)))
                t += beat * 0.5
        else:
            for chord in ([0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 12]):
                for step in chord:
                    notes.append(NoteEvent(onset_s=t + rng.uniform(-0.008, 0.008), offset_s=t + beat * 1.6, midi_note=root + step, velocity=86 + rng.randint(-8, 12)))
                t += beat
    notes.sort(key=lambda n: (n.onset_s, n.midi_note))
    return notes


def corrupt_notes(
    notes: List[NoteEvent],
    *,
    seed: int,
    jitter_s: float,
    miss_prob: float,
    extra_prob: float,
) -> Tuple[List[NoteEvent], Dict]:
    rng = random.Random(seed)
    out: List[NoteEvent] = []
    missed = 0
    extras = 0
    micro_artifacts = 0
    duplicate_artifacts = 0
    chord_breakups = 0
    for n in notes:
        if rng.random() < miss_prob:
            missed += 1
            continue
        jitter = rng.gauss(0.0, jitter_s)
        chord_delay = rng.uniform(0.0, 0.055) if rng.random() < 0.12 else 0.0
        if chord_delay:
            chord_breakups += 1
        dur_scale = rng.uniform(0.75, 1.25)
        onset = max(0.0, n.onset_s + jitter + chord_delay)
        duration = max(0.045, (n.offset_s - n.onset_s) * dur_scale)
        out.append(NoteEvent(
            onset_s=onset,
            offset_s=onset + duration,
            midi_note=n.midi_note + (rng.choice([-1, 1]) if rng.random() < 0.035 else 0),
            velocity=max(1, min(127, n.velocity + rng.randint(-22, 18))),
        ))
        if rng.random() < extra_prob * 0.9:
            duplicate_artifacts += 1
            dup_on = max(0.0, onset + rng.uniform(0.006, 0.045))
            out.append(NoteEvent(
                onset_s=dup_on,
                offset_s=dup_on + min(duration * 0.35, 0.16),
                midi_note=n.midi_note,
                velocity=max(1, min(127, n.velocity + rng.randint(-35, 8))),
            ))
        if rng.random() < extra_prob * 1.4:
            micro_artifacts += 1
            noise_on = max(0.0, onset + rng.uniform(-0.025, 0.055))
            out.append(NoteEvent(
                onset_s=noise_on,
                offset_s=noise_on + rng.uniform(0.010, 0.028),
                midi_note=max(21, min(108, n.midi_note + rng.choice([-2, -1, 1, 2, 12]))),
                velocity=rng.randint(3, 22),
            ))
        if rng.random() < extra_prob:
            extras += 1
            extra_pitch = max(21, min(108, n.midi_note + rng.choice([-12, -7, -5, 5, 7, 12])))
            extra_on = max(0.0, onset + rng.uniform(-0.04, 0.08))
            out.append(NoteEvent(onset_s=extra_on, offset_s=extra_on + duration * rng.uniform(0.35, 0.9), midi_note=extra_pitch, velocity=50 + rng.randint(0, 35)))
    out.sort(key=lambda n: (n.onset_s, n.midi_note))
    return out, {
        "missed_in_corruption": missed,
        "extras_in_corruption": extras,
        "micro_artifacts": micro_artifacts,
        "duplicate_artifacts": duplicate_artifacts,
        "chord_breakups": chord_breakups,
    }


def _apply_aligner(expected: List[NoteEvent], performed: List[NoteEvent], mode: str):
    if mode in {"linear_dtw", "dtw"}:
        a, b = dtw_warp(expected, performed)
        return apply_time_warp(expected, a, b), {"mode": "linear_dtw", "a": a, "b": b, "applied": True, "guard": "raw"}
    if mode == "safe_linear_dtw":
        a, b = dtw_warp(expected, performed)
        warped = apply_time_warp(expected, a, b)
        base_summary, _ = score(performed, expected, onset_tol=0.12)
        warped_summary, _ = score(performed, warped, onset_tol=0.12)
        base_quality = float(base_summary.get("robustness_score", 0.0) or 0.0)
        warped_quality = float(warped_summary.get("robustness_score", 0.0) or 0.0)
        if warped_quality >= base_quality + 0.005:
            return warped, {
                "mode": "safe_linear_dtw",
                "a": a,
                "b": b,
                "applied": True,
                "guard": "accepted",
                "baseline_robustness": base_quality,
                "warped_robustness": warped_quality,
            }
        return expected, {
            "mode": "safe_linear_dtw",
            "a": a,
            "b": b,
            "applied": False,
            "guard": "rejected",
            "baseline_robustness": base_quality,
            "warped_robustness": warped_quality,
        }
    return expected, {"mode": "offset"}


def _mean_metric(rows: List[Dict], key: str) -> float:
    vals = [float(r["summary"].get(key, 0.0) or 0.0) for r in rows]
    return float(mean(vals)) if vals else 0.0


def _std_metric(rows: List[Dict], key: str) -> float:
    vals = [float(r["summary"].get(key, 0.0) or 0.0) for r in rows]
    return float(pstdev(vals)) if len(vals) > 1 else 0.0


def run_synthetic_ablation(config: Dict) -> Dict:
    samples = int(config.get("samples", 24))
    seed = int(config.get("seed", 42))
    seed_count = int(config.get("seed_count", 5))
    assistant_modes: Iterable[str] = config.get("assistant_modes") or ["off", "heuristic", "tcn", "experimental"]
    aligner_modes: Iterable[str] = config.get("aligner_modes") or ["offset", "linear_dtw", "safe_linear_dtw"]
    jitter_s = float(config.get("jitter_s", 0.045))
    miss_prob = float(config.get("miss_prob", 0.08))
    extra_prob = float(config.get("extra_prob", 0.06))
    configured_paths = config.get("ckpt_paths") or {}
    fallback_tcn = str(config.get("ckpt_path") or corrector_checkpoint_for_mode("tcn") or "data/corrector_ckpt.pt")

    def ckpt_for(mode: str) -> str | None:
        configured = configured_paths.get(mode) if isinstance(configured_paths, dict) else None
        if configured:
            return str(configured)
        if mode == "tcn":
            return fallback_tcn
        return corrector_checkpoint_for_mode(mode)

    def thresholds_for(mode: str) -> Dict[str, float]:
        configured = config.get("thresholds_by_mode") or {}
        if isinstance(configured, dict) and configured.get(mode):
            return configured[mode]
        return corrector_thresholds_for_mode(mode)

    neural_available = {
        mode: bool(path and Path(path).exists())
        for mode in NEURAL_MODES
        for path in [ckpt_for(mode)]
    }

    rows: List[Dict] = []
    for seed_ix in range(seed_count):
        run_seed = seed + seed_ix * 1009
        for i in range(samples):
            expected = generate_pattern(run_seed, i)
            corrupted, corruption_meta = corrupt_notes(
                expected,
                seed=run_seed + i * 71,
                jitter_s=jitter_s,
                miss_prob=miss_prob,
                extra_prob=extra_prob,
            )
            for assistant_mode in assistant_modes:
                mode = "heuristic" if assistant_mode == "on" else assistant_mode
                label = f"{mode}_fallback" if mode in NEURAL_MODES and not neural_available.get(mode, False) else mode
                if mode == "off":
                    corrected = corrupted
                    post_meta = {
                        "input_notes": len(corrupted),
                        "output_notes": len(corrupted),
                        "disabled_for_ablation": True,
                    }
                else:
                    thresholds = thresholds_for(mode)
                    corrected = AssistantCorrector(CorrectorConfig(
                        enabled=True,
                        mode=mode,
                        ckpt_path=ckpt_for(mode),
                        onset_thr=float(thresholds["onset_thr"]),
                        frame_thr=float(thresholds["frame_thr"]),
                    )).correct(corrupted)
                    corrected, post_meta = postprocess_notes(corrected)
                for aligner_mode in aligner_modes:
                    aligned_expected, align_meta = _apply_aligner(expected, corrected, aligner_mode)
                    summary, matches = score(corrected, aligned_expected, onset_tol=0.12)
                    summary["assistant_mode"] = label
                    summary["aligner_mode"] = align_meta["mode"]
                    rows.append({
                        "seed": run_seed,
                        "seed_ix": seed_ix,
                        "sample": i,
                        "assistant_mode": label,
                        "raw_assistant_mode": mode,
                        "aligner_mode": align_meta["mode"],
                        "summary": summary,
                        "corruption": corruption_meta,
                        "postprocessing": post_meta,
                        "aligner": align_meta,
                        "match_counts": {
                            "correct": sum(1 for m in matches if m["status"] == "correct"),
                            "missed": sum(1 for m in matches if m["status"] == "missed"),
                            "extra": sum(1 for m in matches if m["status"] == "extra"),
                        },
                    })

    grouped: Dict[str, List[Dict]] = {}
    for row in rows:
        key = f"{row['assistant_mode']}+{row['aligner_mode']}"
        grouped.setdefault(key, []).append(row)

    leaderboard = []
    for key, xs in grouped.items():
        leaderboard.append({
            "config": key,
            "samples": len(xs),
            "f1": _mean_metric(xs, "f1"),
            "f1_std": _std_metric(xs, "f1"),
            "chord_f1": _mean_metric(xs, "chord_f1"),
            "chord_f1_std": _std_metric(xs, "chord_f1"),
            "mae_s": _mean_metric(xs, "mae_s"),
            "mae_s_std": _std_metric(xs, "mae_s"),
            "robustness_score": _mean_metric(xs, "robustness_score"),
            "robustness_std": _std_metric(xs, "robustness_score"),
            "left_f1": _mean_metric(xs, "left_f1"),
            "right_f1": _mean_metric(xs, "right_f1"),
            "safe_warp_accept_rate": float(mean([1.0 if r.get("aligner", {}).get("applied") else 0.0 for r in xs])) if "safe_linear_dtw" in key else None,
        })
    baseline = next((x for x in leaderboard if x["config"] == "off+offset"), leaderboard[0] if leaderboard else {})
    for row in leaderboard:
        row["delta_f1"] = float(row.get("f1", 0.0) - baseline.get("f1", 0.0))
        row["delta_chord_f1"] = float(row.get("chord_f1", 0.0) - baseline.get("chord_f1", 0.0))
        row["delta_robustness"] = float(row.get("robustness_score", 0.0) - baseline.get("robustness_score", 0.0))
        row["delta_mae_s"] = float(row.get("mae_s", 0.0) - baseline.get("mae_s", 0.0))
    leaderboard.sort(key=lambda x: (x["robustness_score"], x["f1"]), reverse=True)

    return {
        "leaderboard": leaderboard,
        "rows": rows,
        "baseline": baseline,
        "diagnostics": {
            "seed_count": seed_count,
            "samples_per_seed": samples,
            "total_patterns": seed_count * samples,
            "neural_available": neural_available,
            "tcn_available": neural_available.get("tcn", False),
            "tcn_label": "tcn" if neural_available.get("tcn", False) else "tcn_fallback",
            "safe_aligner_policy": "linear warp is accepted only when robustness improves by at least 0.005",
        },
        "hypothesis": "pre/postprocessing plus assistant correction should improve robustness under timing jitter, missed notes and extra notes.",
        "methodology": "Synthetic MIDI patterns are corrupted deterministically across multiple seeds; each assistant/aligner configuration is evaluated with identical corruptions and reported as mean/std plus delta against off+offset baseline.",
    }
