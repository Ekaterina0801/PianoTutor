from __future__ import annotations

import datetime
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.assistant.checkpoints import corrector_checkpoint_for_mode, corrector_checkpoint_status, corrector_thresholds_for_mode
from app.core.research import run_synthetic_ablation
from app.db import connect
from app.deps import require_roles
from app.models import ResearchRunRequest


router = APIRouter(tags=["research"])


@router.get("/research/model-status")
def model_status(current_user=Depends(require_roles("researcher", "admin"))):
    checkpoints = corrector_checkpoint_status()
    return {
        "teacher_amt": "piano_transcription_inference",
        "corrector_checkpoint": checkpoints["tcn"]["path"],
        "corrector_checkpoints": checkpoints,
        "tcn_available": checkpoints["tcn"]["available"],
        "bilstm_available": checkpoints["bilstm"]["available"],
        "transformer_available": checkpoints["transformer"]["available"],
        "experimental_wrappers": ["heuristic-ensemble", "neural-aligner-ready"],
        "training_policy": "training is reproducible through scripts but is not executed by the API",
    }


@router.post("/research/benchmark")
def run_benchmark(req: ResearchRunRequest, current_user=Depends(require_roles("researcher", "admin"))):
    run_id = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + "Z"
    config = req.model_dump()
    config["ckpt_paths"] = {
        mode: corrector_checkpoint_for_mode(mode)
        for mode in ("tcn", "bilstm", "transformer")
    }
    config["thresholds_by_mode"] = {
        mode: corrector_thresholds_for_mode(mode)
        for mode in ("tcn", "bilstm", "transformer")
    }
    result = run_synthetic_ablation(config)
    best = result["leaderboard"][0] if result["leaderboard"] else {}
    metrics = {
        "best": best,
        "baseline": result["baseline"],
        "leaderboard": result["leaderboard"],
        "samples": req.samples,
        "seed_count": req.seed_count,
        "configs": len(result["leaderboard"]),
        "diagnostics": result["diagnostics"],
    }
    artifacts = {
        "rows": result["rows"],
        "hypothesis": result["hypothesis"],
        "methodology": result["methodology"],
    }
    conn = connect()
    conn.execute(
        """
        INSERT INTO research_runs (id,user_id,name,created_at,status,config_json,metrics_json,artifacts_json)
        VALUES (?,?,?,?,?,?,?,?)
        """,
        (
            run_id,
            current_user["id"],
            req.name,
            now,
            "completed",
            json.dumps(config),
            json.dumps(metrics),
            json.dumps(artifacts),
        ),
    )
    conn.commit()
    conn.close()
    return {"id": run_id, "created_at": now, "status": "completed", "metrics": metrics, "artifacts": artifacts}


@router.get("/research/runs")
def list_runs(limit: int = 30, current_user=Depends(require_roles("researcher", "admin"))):
    conn = connect()
    rows = conn.execute(
        "SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    out = []
    for row in rows:
        d = dict(row)
        d["config"] = json.loads(d.pop("config_json") or "{}")
        d["metrics"] = json.loads(d.pop("metrics_json") or "{}")
        d.pop("artifacts_json", None)
        out.append(d)
    return out


@router.get("/research/runs/{run_id}")
def get_run(run_id: str, current_user=Depends(require_roles("researcher", "admin"))):
    conn = connect()
    row = conn.execute("SELECT * FROM research_runs WHERE id=?", (run_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Research run not found")
    d = dict(row)
    d["config"] = json.loads(d.pop("config_json") or "{}")
    d["metrics"] = json.loads(d.pop("metrics_json") or "{}")
    d["artifacts"] = json.loads(d.pop("artifacts_json") or "{}")
    return d
