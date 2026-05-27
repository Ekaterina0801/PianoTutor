import numpy as np

from app.core.preprocessing import preprocess_audio


def test_preprocess_skips_near_silence_instead_of_amplifying_noise():
    sr = 44_100
    rng = np.random.default_rng(42)
    audio = rng.normal(0.0, 0.0004, sr * 2).astype(np.float32)

    processed, meta = preprocess_audio(audio, sr)

    assert processed.size == 0
    assert meta["skipped"]["reason"] in {"below_music_level", "mostly_silence", "steady_noise_floor"}
    assert meta["normalization"]["skipped"] == 1.0


def test_preprocess_keeps_audible_note_like_signal():
    sr = 44_100
    t = np.arange(sr, dtype=np.float32) / sr
    envelope = np.exp(-2.0 * t).astype(np.float32)
    audio = (0.12 * envelope * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

    processed, meta = preprocess_audio(audio, sr)

    assert processed.size > 0
    assert "skipped" not in meta
    assert meta["normalization"]["gain"] >= 1.0
