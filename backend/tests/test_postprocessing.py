from app.core.postprocessing import NotePostprocessConfig, postprocess_notes, suppress_reference_harmonic_artifacts
from app.models import NoteEvent


def test_postprocess_removes_weak_harmonic_shadow():
    notes = [
        NoteEvent(onset_s=0.0, offset_s=0.8, midi_note=60, velocity=96),
        NoteEvent(onset_s=0.012, offset_s=0.12, midi_note=72, velocity=34),
    ]

    out, meta = postprocess_notes(notes)

    assert [n.midi_note for n in out] == [60]
    assert meta["removed_harmonic_shadows"] == 1


def test_postprocess_keeps_real_octave_chord():
    notes = [
        NoteEvent(onset_s=0.0, offset_s=0.8, midi_note=60, velocity=92),
        NoteEvent(onset_s=0.008, offset_s=0.76, midi_note=72, velocity=88),
    ]

    out, meta = postprocess_notes(notes)

    assert [n.midi_note for n in out] == [60, 72]
    assert meta["removed_harmonic_shadows"] == 0


def test_postprocess_removes_very_short_noise_note():
    notes = [
        NoteEvent(onset_s=0.0, offset_s=0.8, midi_note=60, velocity=90),
        NoteEvent(onset_s=0.4, offset_s=0.425, midi_note=65, velocity=20),
    ]

    out, meta = postprocess_notes(notes)

    assert [n.midi_note for n in out] == [60]
    assert meta["removed_short"] == 1


def test_audio_postprocess_removes_late_sustained_drone():
    cfg = NotePostprocessConfig(suppress_long_drones=True, max_duration_s=4.0)
    notes = [
        NoteEvent(onset_s=0.0, offset_s=0.35, midi_note=60, velocity=90),
        NoteEvent(onset_s=0.5, offset_s=0.85, midi_note=62, velocity=88),
        NoteEvent(onset_s=1.0, offset_s=1.35, midi_note=64, velocity=86),
        NoteEvent(onset_s=1.45, offset_s=5.2, midi_note=64, velocity=40),
        NoteEvent(onset_s=1.6, offset_s=1.9, midi_note=65, velocity=84),
        NoteEvent(onset_s=2.1, offset_s=2.4, midi_note=67, velocity=82),
    ]

    out, meta = postprocess_notes(notes, cfg)

    assert [n.midi_note for n in out] == [60, 62, 64, 65, 67]
    assert meta["removed_sustained_drones"] == 1


def test_default_postprocess_keeps_long_manual_note():
    notes = [
        NoteEvent(onset_s=0.0, offset_s=0.35, midi_note=60, velocity=90),
        NoteEvent(onset_s=0.5, offset_s=3.5, midi_note=64, velocity=90),
        NoteEvent(onset_s=1.0, offset_s=1.35, midi_note=67, velocity=90),
    ]

    out, meta = postprocess_notes(notes)

    assert [n.midi_note for n in out] == [60, 64, 67]
    assert meta["removed_sustained_drones"] == 0


def test_audio_postprocess_removes_weak_isolated_attack():
    cfg = NotePostprocessConfig(
        suppress_weak_isolated_attacks=True,
        isolated_min_duration_s=0.13,
        isolated_min_velocity=28,
    )
    notes = [
        NoteEvent(onset_s=0.0, offset_s=0.5, midi_note=60, velocity=90),
        NoteEvent(onset_s=0.9, offset_s=0.97, midi_note=66, velocity=18),
        NoteEvent(onset_s=1.4, offset_s=1.9, midi_note=64, velocity=88),
    ]

    out, meta = postprocess_notes(notes, cfg)

    assert [n.midi_note for n in out] == [60, 64]
    assert meta["removed_weak_isolated_attacks"] == 1


def test_audio_postprocess_removes_rapid_repeated_pitch_artifact():
    cfg = NotePostprocessConfig(suppress_rapid_repeated_pitches=True, merge_gap_s=0.0)
    notes = [
        NoteEvent(onset_s=0.0, offset_s=0.06, midi_note=60, velocity=90),
        NoteEvent(onset_s=0.075, offset_s=0.15, midi_note=60, velocity=24),
        NoteEvent(onset_s=0.5, offset_s=0.9, midi_note=62, velocity=88),
    ]

    out, meta = postprocess_notes(notes, cfg)

    assert [(n.midi_note, round(n.onset_s, 3)) for n in out] == [(60, 0.0), (62, 0.5)]
    assert meta["removed_rapid_repeated_pitches"] == 1


def test_reference_filter_removes_microphone_octave_doubles():
    expected = [
        NoteEvent(onset_s=0.0, offset_s=0.4, midi_note=60, velocity=90),
        NoteEvent(onset_s=0.5, offset_s=0.9, midi_note=62, velocity=90),
    ]
    performed = [
        NoteEvent(onset_s=0.03, offset_s=0.45, midi_note=60, velocity=88),
        NoteEvent(onset_s=0.035, offset_s=0.5, midi_note=72, velocity=70),
        NoteEvent(onset_s=0.55, offset_s=0.95, midi_note=62, velocity=86),
        NoteEvent(onset_s=0.56, offset_s=1.0, midi_note=74, velocity=68),
    ]

    out, meta = suppress_reference_harmonic_artifacts(performed, expected)

    assert [n.midi_note for n in out] == [60, 62]
    assert meta["removed_reference_harmonics"] == 2


def test_reference_filter_keeps_expected_octave_chord():
    expected = [
        NoteEvent(onset_s=0.0, offset_s=0.6, midi_note=60, velocity=90),
        NoteEvent(onset_s=0.01, offset_s=0.6, midi_note=72, velocity=90),
    ]
    performed = [
        NoteEvent(onset_s=0.04, offset_s=0.62, midi_note=60, velocity=88),
        NoteEvent(onset_s=0.045, offset_s=0.62, midi_note=72, velocity=86),
    ]

    out, meta = suppress_reference_harmonic_artifacts(performed, expected)

    assert [n.midi_note for n in out] == [60, 72]
    assert meta["removed_reference_harmonics"] == 0


def test_reference_filter_keeps_fast_octave_sequence_when_onsets_are_separate():
    expected = [
        NoteEvent(onset_s=0.0, offset_s=0.12, midi_note=60, velocity=90),
        NoteEvent(onset_s=0.14, offset_s=0.26, midi_note=72, velocity=90),
    ]
    performed = [
        NoteEvent(onset_s=0.02, offset_s=0.14, midi_note=60, velocity=88),
        NoteEvent(onset_s=0.14, offset_s=0.28, midi_note=72, velocity=86),
    ]

    out, meta = suppress_reference_harmonic_artifacts(performed, expected)

    assert [n.midi_note for n in out] == [60, 72]
    assert meta["removed_reference_harmonics"] == 0
