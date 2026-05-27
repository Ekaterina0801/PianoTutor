from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from statistics import mean
from typing import Dict, Iterable, List, Sequence

import soundfile as sf

from app.assistant.checkpoints import NEURAL_MODES, corrector_checkpoint_for_mode, corrector_thresholds_for_mode
from app.assistant.corrector import AssistantCorrector, CorrectorConfig
from app.assistant.train_corrector.midi_gt import midi_file_to_notes
from app.core.audio_io import load_audio
from app.core.btd_transcriber import BTDTranscriber
from app.core.postprocessing import postprocess_notes
from app.core.preprocessing import preprocess_audio
from app.core.scoring import score
from app.models import NoteEvent


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _resolve_path(path: str, base: Path) -> Path:
    p = Path(path)
    if p.is_absolute():
        return p
    root_candidate = _repo_root() / p
    if root_candidate.exists():
        return root_candidate
    return base / p

def _relative_or_absolute(path: Path) -> str:
    return str(path.relative_to(_repo_root()) if path.is_relative_to(_repo_root()) else path)


def _default_ckpt() -> str | None:
    return corrector_checkpoint_for_mode("tcn")


def _ckpt_for_mode(mode: str, fallback_tcn: str | None = None) -> str | None:
    if mode == "tcn" and fallback_tcn:
        return fallback_tcn
    return corrector_checkpoint_for_mode(mode)


def _crop_notes(notes: List[NoteEvent], start_s: float, duration_s: float) -> List[NoteEvent]:
    end_s = start_s + duration_s
    out: List[NoteEvent] = []
    for n in notes:
        if n.offset_s <= start_s or n.onset_s >= end_s:
            continue
        onset = max(0.0, float(n.onset_s) - start_s)
        offset = min(duration_s, float(n.offset_s) - start_s)
        if offset <= onset:
            offset = min(duration_s, onset + 0.04)
        out.append(
            NoteEvent(
                onset_s=onset,
                offset_s=offset,
                midi_note=int(n.midi_note),
                velocity=int(n.velocity),
            )
        )
    out.sort(key=lambda x: (x.onset_s, x.midi_note))
    return out

def _parse_float_grid(raw: str) -> List[float]:
    return [float(x.strip()) for x in raw.split(",") if x.strip()]


def _manifest_entries(
    manifest: Path,
    *,
    auto_excerpts: int = 0,
    excerpt_duration_s: float = 18.0,
    max_excerpts: int = 0,
) -> List[Dict[str, str]]:
    with manifest.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    if auto_excerpts <= 0:
        return rows[:max_excerpts] if max_excerpts > 0 else rows

    base = manifest.parent
    grouped: Dict[tuple, Dict[str, str]] = {}
    for row in rows:
        key = (row["audio_path"], row["midi_path"], row.get("source", "MAESTRO v3.0.0"))
        grouped.setdefault(key, row)

    expanded: List[Dict[str, str]] = []
    for (_, _, _), row in grouped.items():
        audio_path = _resolve_path(row["audio_path"], base)
        try:
            info = sf.info(str(audio_path))
            audio_duration_s = float(info.frames / info.samplerate) if info.samplerate else 0.0
        except Exception:
            audio, sr = load_audio(str(audio_path), target_sr=44100)
            audio_duration_s = float(audio.shape[0] / sr) if sr else 0.0
        duration_s = float(excerpt_duration_s or row.get("duration_s") or 18.0)
        max_start = max(0.0, audio_duration_s - duration_s)
        count = max(1, int(auto_excerpts))
        starts = [0.0] if count == 1 else [max_start * i / (count - 1) for i in range(count)]
        stem = Path(row["audio_path"]).stem
        for ix, start_s in enumerate(starts):
            expanded.append({
                **row,
                "id": f"{stem}_auto_{ix + 1:02d}",
                "start_s": f"{start_s:.3f}",
                "duration_s": f"{duration_s:.3f}",
            })

    return expanded[:max_excerpts] if max_excerpts > 0 else expanded


def _prepare_eval_items(
    manifest: Path,
    *,
    auto_excerpts: int = 0,
    excerpt_duration_s: float = 18.0,
    max_excerpts: int = 0,
) -> List[Dict]:
    rows: List[Dict] = []
    base = manifest.parent
    transcriber = BTDTranscriber()
    midi_cache: Dict[Path, List[NoteEvent]] = {}

    for item in _manifest_entries(
        manifest,
        auto_excerpts=auto_excerpts,
        excerpt_duration_s=excerpt_duration_s,
        max_excerpts=max_excerpts,
    ):
        item_id = item["id"]
        audio_path = _resolve_path(item["audio_path"], base)
        midi_path = _resolve_path(item["midi_path"], base)
        start_s = float(item.get("start_s", 0.0) or 0.0)
        duration_s = float(item["duration_s"])

        audio, sr = load_audio(str(audio_path), target_sr=44100)
        s0 = max(0, int(start_s * sr))
        s1 = min(audio.shape[0], int((start_s + duration_s) * sr))
        clip = audio[s0:s1]
        processed, pre_meta = preprocess_audio(clip, sr)
        trim_start = float(pre_meta.get("trim", {}).get("trim_start_s", 0.0) or 0.0)
        final_duration = float(pre_meta.get("final", {}).get("duration_s", processed.shape[0] / sr) or 0.0)

        if midi_path not in midi_cache:
            midi_cache[midi_path] = midi_file_to_notes(str(midi_path))
        expected = _crop_notes(midi_cache[midi_path], start_s + trim_start, final_duration)
        teacher_notes = [] if processed.size == 0 else transcriber.transcribe(processed, sr)
        rows.append({
            "id": item_id,
            "audio_path": audio_path,
            "midi_path": midi_path,
            "start_s": start_s,
            "duration_s": duration_s,
            "preprocessing": pre_meta,
            "trim_adjustment_s": trim_start,
            "teacher_notes": teacher_notes,
            "expected": expected,
        })
    return rows


def _summarize_modes(rows: List[Dict]) -> List[Dict]:
    by_mode: Dict[str, List[Dict]] = {}
    for row in rows:
        by_mode.setdefault(row["mode"], []).append(row["summary"])
    out = []
    for mode, xs in by_mode.items():
        out.append(
            {
                "mode": mode,
                "samples": len(xs),
                "f1": float(mean(float(x.get("f1", 0.0) or 0.0) for x in xs)),
                "chord_f1": float(mean(float(x.get("chord_f1", 0.0) or 0.0) for x in xs)),
                "mae_s": float(mean(float(x.get("mae_s", 0.0) or 0.0) for x in xs)),
                "duration_mae_s": float(mean(float(x.get("duration_mae_s", 0.0) or 0.0) for x in xs)),
                "velocity_mae": float(mean(float(x.get("velocity_mae", 0.0) or 0.0) for x in xs)),
                "robustness_score": float(mean(float(x.get("robustness_score", 0.0) or 0.0) for x in xs)),
            }
        )
    out.sort(key=lambda x: (x["robustness_score"], x["f1"]), reverse=True)
    baseline = next((x for x in out if x["mode"] == "off"), out[-1] if out else {})
    for row in out:
        row["delta_f1"] = float(row.get("f1", 0.0) - baseline.get("f1", 0.0))
        row["delta_robustness"] = float(row.get("robustness_score", 0.0) - baseline.get("robustness_score", 0.0))
    return out


def _markdown(result: Dict) -> str:
    lines = [
        "# Real-World Evaluation",
        "",
        f"Источник: {result['source']['name']}",
        f"Лицензия: {result['source']['license']}",
        f"Manifest: `{result['manifest']}`",
        "",
        "## Aggregate",
        "",
        "| mode | samples | F1 | ΔF1 | Chord F1 | Onset MAE | Duration MAE | Velocity MAE | Robustness | ΔRob |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in result["aggregate"]:
        lines.append(
            "| {mode} | {samples} | {f1:.3f} | {delta_f1:+.3f} | {chord_f1:.3f} | {mae_ms:.1f} ms | {dur_ms:.1f} ms | {vel_mae:.1f} | {robustness_score:.3f} | {delta_robustness:+.3f} |".format(
                mode=row["mode"],
                samples=row["samples"],
                f1=row["f1"],
                delta_f1=row["delta_f1"],
                chord_f1=row["chord_f1"],
                mae_ms=row["mae_s"] * 1000.0,
                dur_ms=row.get("duration_mae_s", 0.0) * 1000.0,
                vel_mae=row.get("velocity_mae", 0.0),
                robustness_score=row["robustness_score"],
                delta_robustness=row["delta_robustness"],
            )
        )
    if result.get("calibration"):
        lines.extend([
            "",
            "## Calibration",
            "",
            "| mode | onset_thr | frame_thr | F1 | Chord F1 | Robustness | candidates |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ])
        for mode, row in result["calibration"].get("thresholds", {}).items():
            lines.append(
                "| {mode} | {onset_thr:.2f} | {frame_thr:.2f} | {f1:.3f} | {chord_f1:.3f} | {robustness_score:.3f} | {candidates} |".format(
                    mode=mode,
                    onset_thr=float(row["onset_thr"]),
                    frame_thr=float(row["frame_thr"]),
                    f1=float(row.get("f1", 0.0)),
                    chord_f1=float(row.get("chord_f1", 0.0)),
                    robustness_score=float(row.get("robustness_score", 0.0)),
                    candidates=int(row.get("candidates", 0)),
                )
            )
    lines.extend(["", "## Per Excerpt", ""])
    for row in result["rows"]:
        s = row["summary"]
        diagnostics = row["lineage"].get("corrector_diagnostics") or {}
        thresholds = diagnostics.get("thresholds") or row["lineage"].get("thresholds") or {}
        th_label = (
            f"{float(thresholds['onset_thr']):.2f}/{float(thresholds['frame_thr']):.2f}"
            if "onset_thr" in thresholds and "frame_thr" in thresholds else "—"
        )
        lines.append(
            "- `{id}` / `{mode}`: F1 {f1:.3f}, Chord F1 {chord:.3f}, onset MAE {mae:.1f} ms, duration MAE {dur:.1f} ms, velocity MAE {vel:.1f}, decision={decision}, guard_reason={reason}, gate={gate}, thresholds={thresholds}, notes teacher={teacher}, final={final}, gt={gt}".format(
                id=row["id"],
                mode=row["mode"],
                f1=float(s.get("f1", 0.0) or 0.0),
                chord=float(s.get("chord_f1", 0.0) or 0.0),
                mae=float(s.get("mae_s", 0.0) or 0.0) * 1000.0,
                dur=float(s.get("duration_mae_s", 0.0) or 0.0) * 1000.0,
                vel=float(s.get("velocity_mae", 0.0) or 0.0),
                decision=row["lineage"].get("corrector_decision", row["mode"]),
                reason=diagnostics.get("reason", "—"),
                gate=diagnostics.get("gate_reason", diagnostics.get("quality_gate", "—")),
                thresholds=th_label,
                teacher=row["lineage"]["teacher_notes"],
                final=row["lineage"]["final_notes"],
                gt=row["lineage"]["ground_truth_notes"],
            )
        )
    return "\n".join(lines) + "\n"


def _evaluate_prepared_items(
    prepared_items: Sequence[Dict],
    *,
    manifest: Path,
    modes: Iterable[str],
    ckpt_path: str | None,
    thresholds_by_mode: Dict[str, Dict[str, float]] | None = None,
    quality_gate: bool = True,
    calibration: Dict | None = None,
) -> Dict:
    rows: List[Dict] = []
    modes = list(modes)
    ckpt_paths = {mode: _ckpt_for_mode(mode, ckpt_path) for mode in modes if mode in NEURAL_MODES}
    thresholds_by_mode = thresholds_by_mode or {}
    corrector_cache: Dict[tuple, AssistantCorrector] = {}

    def get_corrector(mode: str) -> AssistantCorrector:
        th = thresholds_by_mode.get(mode, {})
        configured_thresholds = corrector_thresholds_for_mode(mode)
        onset_thr = float(th.get("onset_thr", configured_thresholds["onset_thr"]))
        frame_thr = float(th.get("frame_thr", configured_thresholds["frame_thr"]))
        key = (mode, ckpt_paths.get(mode), onset_thr, frame_thr, quality_gate)
        if key not in corrector_cache:
            corrector_cache[key] = AssistantCorrector(CorrectorConfig(
                enabled=True,
                mode=mode,
                ckpt_path=ckpt_paths.get(mode),
                onset_thr=onset_thr,
                frame_thr=frame_thr,
                quality_gate=quality_gate,
            ))
        return corrector_cache[key]

    for item in prepared_items:
        expected = item["expected"]
        teacher_notes = item["teacher_notes"]
        for mode in modes:
            decision = mode
            corrector_diagnostics = {"mode": mode}
            corrected = teacher_notes
            if mode != "off":
                corrector = get_corrector(mode)
                corrected = corrector.correct(teacher_notes)
                decision = corrector.last_decision
                corrector_diagnostics = corrector.last_diagnostics
            final_notes, post_meta = postprocess_notes(corrected)
            summary, _ = score(final_notes, expected, onset_tol=0.12)
            label = f"{mode}_fallback" if mode in NEURAL_MODES and not (ckpt_paths.get(mode) and Path(ckpt_paths[mode]).exists()) else mode
            rows.append(
                {
                    "id": item["id"],
                    "mode": label,
                    "audio_path": _relative_or_absolute(item["audio_path"]),
                    "midi_path": _relative_or_absolute(item["midi_path"]),
                    "start_s": item["start_s"],
                    "duration_s": item["duration_s"],
                    "summary": summary,
                    "lineage": {
                        "preprocessing": item["preprocessing"],
                        "postprocessing": post_meta,
                        "teacher_notes": len(teacher_notes),
                        "corrected_notes": len(corrected),
                        "final_notes": len(final_notes),
                        "ground_truth_notes": len(expected),
                        "trim_adjustment_s": item["trim_adjustment_s"],
                        "corrector_decision": decision,
                        "corrector_diagnostics": corrector_diagnostics,
                    },
                }
            )

    result = {
        "manifest": str(manifest),
        "source": {
            "name": "MAESTRO v3.0.0",
            "url": "https://magenta.withgoogle.com/datasets/maestro",
            "mirror": "https://huggingface.co/datasets/ddPn08/maestro-v3.0.0",
            "license": "CC BY-NC-SA 4.0",
        },
        "ckpt_path": ckpt_path,
        "ckpt_paths": ckpt_paths,
        "quality_gate": quality_gate,
        "thresholds_by_mode": thresholds_by_mode,
        "aggregate": _summarize_modes(rows),
        "rows": rows,
    }
    if calibration:
        result["calibration"] = calibration
    return result


def _calibrate_thresholds(
    prepared_items: Sequence[Dict],
    *,
    manifest: Path,
    modes: Iterable[str],
    ckpt_path: str | None,
    onset_grid: Sequence[float],
    frame_grid: Sequence[float],
) -> Dict:
    thresholds: Dict[str, Dict] = {}
    neural_modes = [m for m in modes if m in NEURAL_MODES]
    for mode in neural_modes:
        ckpt = _ckpt_for_mode(mode, ckpt_path)
        configured_thresholds = corrector_thresholds_for_mode(mode)
        corrector = AssistantCorrector(CorrectorConfig(
            enabled=True,
            mode=mode,
            ckpt_path=ckpt,
            onset_thr=float(configured_thresholds["onset_thr"]),
            frame_thr=float(configured_thresholds["frame_thr"]),
            quality_gate=False,
        ))
        best: Dict = {
            "onset_thr": 0.50,
            "frame_thr": 0.45,
            "f1": -1.0,
            "chord_f1": -1.0,
            "robustness_score": -1.0,
            "candidates": len(onset_grid) * len(frame_grid),
        }
        for onset_thr in onset_grid:
            for frame_thr in frame_grid:
                summaries = []
                corrector.cfg.onset_thr = float(onset_thr)
                corrector.cfg.frame_thr = float(frame_thr)
                for item in prepared_items:
                    corrected = corrector.correct(item["teacher_notes"])
                    final_notes, _ = postprocess_notes(corrected)
                    summary, _ = score(final_notes, item["expected"], onset_tol=0.12)
                    summaries.append(summary)
                if not summaries:
                    continue
                candidate = {
                    "onset_thr": float(onset_thr),
                    "frame_thr": float(frame_thr),
                    "f1": float(mean(float(s.get("f1", 0.0) or 0.0) for s in summaries)),
                    "chord_f1": float(mean(float(s.get("chord_f1", 0.0) or 0.0) for s in summaries)),
                    "robustness_score": float(mean(float(s.get("robustness_score", 0.0) or 0.0) for s in summaries)),
                    "candidates": len(onset_grid) * len(frame_grid),
                }
                if (
                    candidate["robustness_score"],
                    candidate["f1"],
                    candidate["chord_f1"],
                ) > (
                    best["robustness_score"],
                    best["f1"],
                    best["chord_f1"],
                ):
                    best = candidate
        thresholds[mode] = best
        print(
            f"{mode} thresholds onset={best['onset_thr']:.2f} frame={best['frame_thr']:.2f} "
            f"f1={best['f1']:.3f} rob={best['robustness_score']:.3f}",
            flush=True,
        )
    return {
        "quality_gate_during_calibration": False,
        "onset_grid": list(onset_grid),
        "frame_grid": list(frame_grid),
        "thresholds": thresholds,
    }


def evaluate_manifest(
    manifest: Path,
    *,
    modes: Iterable[str],
    ckpt_path: str | None,
    thresholds_by_mode: Dict[str, Dict[str, float]] | None = None,
    quality_gate: bool = True,
    auto_excerpts: int = 0,
    excerpt_duration_s: float = 18.0,
    max_excerpts: int = 0,
) -> Dict:
    prepared = _prepare_eval_items(
        manifest,
        auto_excerpts=auto_excerpts,
        excerpt_duration_s=excerpt_duration_s,
        max_excerpts=max_excerpts,
    )
    return _evaluate_prepared_items(
        prepared,
        manifest=manifest,
        modes=modes,
        ckpt_path=ckpt_path,
        thresholds_by_mode=thresholds_by_mode,
        quality_gate=quality_gate,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate real MAESTRO audio/MIDI excerpts.")
    parser.add_argument("--manifest", default="examples/real_recordings/maestro/manifest.csv")
    parser.add_argument("--out-json", default="examples/real_recordings/maestro/real_eval_results.json")
    parser.add_argument("--out-md", default="examples/real_recordings/maestro/REAL_EVAL_RESULTS.md")
    parser.add_argument("--modes", default="off,heuristic,tcn,bilstm,transformer")
    parser.add_argument("--ckpt-path", default=_default_ckpt())
    parser.add_argument("--calibrate-thresholds", action="store_true")
    parser.add_argument("--onset-grid", default="0.35,0.40,0.45,0.50,0.55,0.60,0.65")
    parser.add_argument("--frame-grid", default="0.30,0.35,0.40,0.45,0.50,0.55,0.60")
    parser.add_argument("--disable-quality-gate", action="store_true")
    parser.add_argument("--auto-excerpts", type=int, default=0)
    parser.add_argument("--excerpt-duration-s", type=float, default=18.0)
    parser.add_argument("--max-excerpts", type=int, default=0)
    args = parser.parse_args()

    manifest = Path(args.manifest)
    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    prepared = _prepare_eval_items(
        manifest,
        auto_excerpts=args.auto_excerpts,
        excerpt_duration_s=args.excerpt_duration_s,
        max_excerpts=args.max_excerpts,
    )
    calibration = None
    thresholds_by_mode = None
    if args.calibrate_thresholds:
        calibration = _calibrate_thresholds(
            prepared,
            manifest=manifest,
            modes=modes,
            ckpt_path=args.ckpt_path,
            onset_grid=_parse_float_grid(args.onset_grid),
            frame_grid=_parse_float_grid(args.frame_grid),
        )
        thresholds_by_mode = calibration["thresholds"]
    result = _evaluate_prepared_items(
        prepared,
        manifest=manifest,
        modes=modes,
        ckpt_path=args.ckpt_path,
        thresholds_by_mode=thresholds_by_mode,
        quality_gate=not args.disable_quality_gate,
        calibration=calibration,
    )

    out_json = Path(args.out_json)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    out_md = Path(args.out_md)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text(_markdown(result), encoding="utf-8")
    print(f"wrote {out_json}")
    print(f"wrote {out_md}")


if __name__ == "__main__":
    main()
