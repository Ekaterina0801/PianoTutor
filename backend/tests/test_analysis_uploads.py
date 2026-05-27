from types import SimpleNamespace
import asyncio

import numpy as np

from app.models import NoteEvent
from app.routers.analysis import _is_midi_upload
from app.routers import analysis


def test_midi_upload_is_detected_by_extension():
    upload = SimpleNamespace(filename="take.mid", content_type="application/octet-stream")

    assert _is_midi_upload(upload)


def test_midi_upload_is_detected_by_content_type():
    upload = SimpleNamespace(filename="take.bin", content_type="audio/midi")

    assert _is_midi_upload(upload)


def test_wav_upload_is_not_midi():
    upload = SimpleNamespace(filename="take.wav", content_type="audio/wav")

    assert not _is_midi_upload(upload)


class FakeUpload:
    filename = "take.wav"
    content_type = "audio/wav"

    async def read(self):
        return b"fake wav"


class FakeTranscriber:
    def transcribe(self, audio, sr):
        return [
            NoteEvent(onset_s=0.0, offset_s=0.5, midi_note=60, velocity=90),
            NoteEvent(onset_s=0.01, offset_s=0.5, midi_note=72, velocity=88),
        ]


def test_transcribe_applies_reference_filter_when_expected_is_sent(monkeypatch):
    monkeypatch.setattr(analysis, "ffmpeg_to_wav", lambda *args, **kwargs: None)
    monkeypatch.setattr(analysis, "load_audio", lambda *args, **kwargs: (np.ones(4410, dtype=np.float32) * 0.1, 44100))
    monkeypatch.setattr(
        analysis,
        "preprocess_audio",
        lambda audio, sr: (
            audio,
            {
                "raw": {"duration_s": 0.1},
                "trim": {"trim_start_s": 0.0, "trim_end_s": 0.0},
                "final": {"duration_s": 0.1},
                "segments": [],
            },
        ),
    )
    monkeypatch.setattr(analysis, "get_transcriber", lambda: FakeTranscriber())
    expected = '[{"onset_s":0.0,"offset_s":0.5,"midi_note":60,"velocity":90}]'

    result = asyncio.run(
        analysis.transcribe(
            file=FakeUpload(),
            expected_notes=expected,
            assistant="off",
            detailed=True,
            max_duration_s=30.0,
            current_user={"id": "test-user"},
        )
    )

    assert [note["midi_note"] for note in result["notes"]] == [60]
    assert result["lineage"]["teacher_notes"] == 2
    assert result["lineage"]["postprocessing"]["output_notes"] == 2
    assert result["lineage"]["reference_filter"]["removed_reference_harmonics"] == 1
    assert result["lineage"]["final_notes"] == 1


def test_parse_expected_notes_rejects_too_many_notes(monkeypatch):
    monkeypatch.setattr(analysis, "MAX_EXPECTED_NOTES", 1)
    payload = (
        '[{"onset_s":0.0,"offset_s":0.5,"midi_note":60,"velocity":90},'
        '{"onset_s":0.5,"offset_s":1.0,"midi_note":62,"velocity":90}]'
    )

    try:
        analysis._parse_expected_notes(payload)
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 413
    else:
        raise AssertionError("expected HTTPException")
