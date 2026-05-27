from __future__ import annotations

import os
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, Form, Query, HTTPException

from app.core.convert import ffmpeg_to_wav
from app.core.btd_transcriber import BTDTranscriber, ModelCheckpointError
from app.core.audio_io import load_audio
from app.core.preprocessing import preprocess_audio
from app.core.postprocessing import NotePostprocessConfig, postprocess_notes, suppress_reference_harmonic_artifacts
from app.assistant.checkpoints import corrector_checkpoint_for_mode, corrector_thresholds_for_mode
from app.assistant.corrector import AssistantCorrector, CorrectorConfig
from app.deps import get_current_user
from app.models import NoteEvent

router = APIRouter(tags=["analysis"])
transcriber: Optional[BTDTranscriber] = None
MAX_UPLOAD_BYTES = int(os.getenv("MAX_AUDIO_UPLOAD_BYTES", str(35 * 1024 * 1024)))
MAX_EXPECTED_NOTES = int(os.getenv("MAX_EXPECTED_NOTES", "2500"))
AUDIO_POSTPROCESS_CONFIG = NotePostprocessConfig(
    min_duration_s=0.08,
    min_velocity=16,
    max_duration_s=4.0,
    harmonic_velocity_ratio=0.88,
    harmonic_duration_ratio=0.65,
    suppress_long_drones=True,
    suppress_weak_isolated_attacks=True,
    suppress_rapid_repeated_pitches=True,
)
MIDI_SUFFIXES = {".mid", ".midi"}
MIDI_CONTENT_TYPES = {
    "audio/midi",
    "audio/mid",
    "audio/x-midi",
    "application/midi",
    "application/x-midi",
}


def _is_midi_upload(file: UploadFile) -> bool:
    suffix = Path(file.filename or "").suffix.lower()
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    return suffix in MIDI_SUFFIXES or content_type in MIDI_CONTENT_TYPES


def _parse_expected_notes(raw: Optional[str]) -> list[NoteEvent]:
    if not raw:
        return []
    if len(raw) > 1_000_000:
        raise HTTPException(status_code=413, detail="expected_notes payload is too large")
    try:
        payload = json.loads(raw)
        if not isinstance(payload, list):
            raise ValueError("expected_notes must be a JSON array")
        if len(payload) > MAX_EXPECTED_NOTES:
            raise HTTPException(status_code=413, detail="too many expected notes")
        return [NoteEvent(**item) for item in payload]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="expected_notes must be a JSON array of NoteEvent objects") from exc


def get_transcriber() -> BTDTranscriber:
    global transcriber
    if transcriber is None:
        transcriber = BTDTranscriber()
    return transcriber

@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    expected_notes: Optional[str] = Form(None),
    assistant: str = Query("heuristic"),
    detailed: bool = Query(False),
    max_duration_s: float = Query(30.0, ge=0.0, le=600.0),
    current_user=Depends(get_current_user),
):
    if _is_midi_upload(file):
        raise HTTPException(
            status_code=415,
            detail=(
                "MIDI files are not audio recordings. Upload MIDI through a MIDI "
                "file control, or upload WAV/MP3/WebM for transcription."
            ),
        )

    assistant_mode = "heuristic" if assistant == "on" else assistant
    expected = _parse_expected_notes(expected_notes)
    ckpt_path = corrector_checkpoint_for_mode(assistant_mode)
    thresholds = corrector_thresholds_for_mode(assistant_mode)
    corrector = AssistantCorrector(CorrectorConfig(
        enabled=assistant_mode != "off",
        mode=assistant_mode,
        ckpt_path=ckpt_path,
        onset_thr=float(thresholds["onset_thr"]),
        frame_thr=float(thresholds["frame_thr"]),
    ))
    suffix = Path(file.filename or "upload").suffix or ".bin"
    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp_in:
        upload_bytes = await file.read()
        if len(upload_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Audio upload is too large. Limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )
        tmp_in.write(upload_bytes)
        in_path = tmp_in.name

    with NamedTemporaryFile(delete=False, suffix=".wav") as tmp_wav:
        wav_path = tmp_wav.name

    try:
        try:
            ffmpeg_to_wav(in_path, wav_path, sr=44100)
        except RuntimeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        audio, sr = load_audio(wav_path, target_sr=44100)
        duration_before_limit = float(audio.shape[0] / sr) if audio.size else 0.0
        if max_duration_s > 0 and duration_before_limit > max_duration_s:
            audio = audio[: int(max_duration_s * sr)]
        audio, pre_meta = preprocess_audio(audio, sr)
        pre_meta["duration_limit"] = {
            "input_duration_s": duration_before_limit,
            "max_duration_s": float(max_duration_s),
            "applied": bool(max_duration_s > 0 and duration_before_limit > max_duration_s),
        }
        if audio.size == 0 or pre_meta.get("skipped"):
            notes, post_meta = postprocess_notes([])
            reference_filter_meta = {
                "input_notes": 0,
                "output_notes": 0,
                "removed_reference_harmonics": 0,
                "policy": "not_applied",
            }
            if detailed:
                return {
                    "notes": [],
                    "lineage": {
                        "user_id": current_user["id"],
                        "file": file.filename,
                        "assistant": assistant_mode,
                        "assistant_checkpoint": ckpt_path,
                        "assistant_thresholds": thresholds,
                        "corrector_decision": {"mode": assistant_mode, "applied": False, "reason": "silent_audio"},
                        "corrector_diagnostics": {},
                        "preprocessing": pre_meta,
                        "teacher_notes": 0,
                        "corrected_notes": 0,
                        "postprocessing": post_meta,
                        "reference_filter": reference_filter_meta,
                        "final_notes": 0,
                    },
                }
            return [n.model_dump() for n in notes]
        try:
            teacher_notes = get_transcriber().transcribe(audio, sr)
        except ModelCheckpointError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        corrected_notes = corrector.correct(teacher_notes)
        notes, post_meta = postprocess_notes(corrected_notes, AUDIO_POSTPROCESS_CONFIG)
        if expected:
            notes, reference_filter_meta = suppress_reference_harmonic_artifacts(notes, expected)
        else:
            reference_filter_meta = {
                "input_notes": len(notes),
                "output_notes": len(notes),
                "removed_reference_harmonics": 0,
                "policy": "not_applied",
            }
        if detailed:
            return {
                "notes": [n.model_dump() for n in notes],
                "lineage": {
                    "user_id": current_user["id"],
                    "file": file.filename,
                    "assistant": assistant_mode,
                    "assistant_checkpoint": ckpt_path,
                    "assistant_thresholds": thresholds,
                    "corrector_decision": corrector.last_decision,
                    "corrector_diagnostics": corrector.last_diagnostics,
                    "preprocessing": pre_meta,
                    "teacher_notes": len(teacher_notes),
                    "corrected_notes": len(corrected_notes),
                    "postprocessing": post_meta,
                    "reference_filter": reference_filter_meta,
                    "final_notes": len(notes),
                },
            }
        return [n.model_dump() for n in notes]
    finally:
        try: os.remove(in_path)
        except Exception: pass
        try: os.remove(wav_path)
        except Exception: pass
