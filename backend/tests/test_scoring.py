from app.core.scoring import score
from app.models import NoteEvent


def test_score_reports_research_metrics():
    expected = [
        NoteEvent(onset_s=0.0, offset_s=0.5, midi_note=60, velocity=80),
        NoteEvent(onset_s=0.5, offset_s=1.0, midi_note=64, velocity=80),
    ]
    performed = [
        NoteEvent(onset_s=0.01, offset_s=0.5, midi_note=60, velocity=80),
        NoteEvent(onset_s=0.49, offset_s=1.0, midi_note=64, velocity=80),
    ]
    summary, matches = score(performed, expected)
    assert summary["f1"] == 1.0
    assert "robustness_score" in summary
    assert "duration_mae_s" in summary
    assert "velocity_mae" in summary
    assert "right_f1" in summary
    assert len(matches) == 2


def test_score_counts_missed_extra_and_pitch_errors():
    expected = [
        NoteEvent(onset_s=0.0, offset_s=0.4, midi_note=60, velocity=80),
        NoteEvent(onset_s=0.5, offset_s=0.9, midi_note=62, velocity=80),
        NoteEvent(onset_s=1.0, offset_s=1.4, midi_note=64, velocity=80),
    ]
    performed = [
        NoteEvent(onset_s=0.0, offset_s=0.4, midi_note=60, velocity=80),
        NoteEvent(onset_s=0.5, offset_s=0.9, midi_note=63, velocity=80),
        NoteEvent(onset_s=1.5, offset_s=1.9, midi_note=67, velocity=80),
    ]

    summary, matches = score(performed, expected, onset_tol=0.08)

    assert summary["correct"] == 1
    assert summary["missed"] == 2
    assert summary["extra"] == 2
    assert summary["f1"] < 0.5
    assert {m["status"] for m in matches} == {"correct", "missed", "extra"}


def test_score_reports_chord_and_hand_metrics():
    expected = [
        NoteEvent(onset_s=0.0, offset_s=0.5, midi_note=48, velocity=80),
        NoteEvent(onset_s=0.0, offset_s=0.5, midi_note=52, velocity=80),
        NoteEvent(onset_s=0.0, offset_s=0.5, midi_note=55, velocity=80),
        NoteEvent(onset_s=0.7, offset_s=1.1, midi_note=72, velocity=90),
    ]
    performed = [
        NoteEvent(onset_s=0.01, offset_s=0.5, midi_note=48, velocity=82),
        NoteEvent(onset_s=0.01, offset_s=0.5, midi_note=52, velocity=82),
        NoteEvent(onset_s=0.01, offset_s=0.5, midi_note=55, velocity=82),
        NoteEvent(onset_s=0.71, offset_s=1.1, midi_note=72, velocity=90),
    ]

    summary, _ = score(performed, expected, onset_tol=0.08)

    assert summary["chord_f1"] == 1.0
    assert summary["left_f1"] == 1.0
    assert summary["right_f1"] == 1.0
    assert summary["velocity_score"] > 0.9


def test_score_matches_correct_note_sequence_even_when_late():
    expected = [
        NoteEvent(onset_s=0.0, offset_s=0.35, midi_note=60, velocity=80),
        NoteEvent(onset_s=0.4, offset_s=0.75, midi_note=62, velocity=80),
        NoteEvent(onset_s=0.8, offset_s=1.15, midi_note=64, velocity=80),
        NoteEvent(onset_s=1.2, offset_s=1.55, midi_note=65, velocity=80),
    ]
    performed = [
        NoteEvent(onset_s=2.0, offset_s=2.35, midi_note=60, velocity=80),
        NoteEvent(onset_s=2.7, offset_s=3.05, midi_note=62, velocity=80),
        NoteEvent(onset_s=3.4, offset_s=3.75, midi_note=64, velocity=80),
        NoteEvent(onset_s=4.1, offset_s=4.45, midi_note=65, velocity=80),
    ]

    summary, matches = score(performed, expected, onset_tol=0.08)

    assert summary["matching_mode"] == "sequence"
    assert summary["f1"] == 1.0
    assert summary["correct"] == 4
    assert summary["missed"] == 0
    assert summary["extra"] == 0
    assert {m["status"] for m in matches} == {"correct"}
    assert summary["mae_s"] > 0.0
