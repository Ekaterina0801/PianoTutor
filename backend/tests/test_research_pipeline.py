from app.core.research import run_synthetic_ablation


def test_synthetic_ablation_smoke():
    result = run_synthetic_ablation({
        "samples": 4,
        "seed": 7,
        "seed_count": 1,
        "assistant_modes": ["off", "heuristic"],
        "aligner_modes": ["offset"],
        "jitter_s": 0.02,
        "miss_prob": 0.05,
        "extra_prob": 0.05,
    })
    assert result["leaderboard"]
    assert len(result["rows"]) == 8
    assert "hypothesis" in result
