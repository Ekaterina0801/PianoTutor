import json, uuid, datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from app.models import CreateSessionRequest
from app.db import connect
from app.core.scoring import score
from app.core.postprocessing import postprocess_notes, suppress_reference_harmonic_artifacts

from app.assistant.corrector import AssistantCorrector, CorrectorConfig
from app.assistant.checkpoints import corrector_checkpoint_for_mode, corrector_thresholds_for_mode
from app.assistant.aligner import dtw_warp, apply_time_warp
from app.deps import can_read_user, get_current_user

router = APIRouter(tags=["sessions"])

def _score_session_payload(req: CreateSessionRequest):
    raw_performed = req.performed
    performed = raw_performed
    expected = req.expected
    assistant_mode = "heuristic" if req.assistant == "on" else req.assistant
    if req.aligner in {"dtw", "linear_dtw"}:
        aligner_mode = "linear_dtw"
    elif req.aligner == "safe_linear_dtw":
        aligner_mode = "safe_linear_dtw"
    else:
        aligner_mode = "offset"

    ckpt_path = corrector_checkpoint_for_mode(assistant_mode)
    thresholds = corrector_thresholds_for_mode(assistant_mode)
    lineage = {
        "input": {"performed_notes": len(raw_performed), "expected_notes": len(expected), "source": req.source},
        "assistant": {"mode": assistant_mode, "checkpoint": ckpt_path, "thresholds": thresholds},
        "aligner": {"mode": aligner_mode},
    }

    if assistant_mode != "off":
        corrector = AssistantCorrector(CorrectorConfig(
            enabled=True,
            mode=assistant_mode,
            ckpt_path=ckpt_path,
            onset_thr=float(thresholds["onset_thr"]),
            frame_thr=float(thresholds["frame_thr"]),
        ))
        performed = corrector.correct(performed)
        lineage["assistant"]["decision"] = corrector.last_decision
        lineage["assistant"]["diagnostics"] = corrector.last_diagnostics
    else:
        lineage["assistant"]["decision"] = "off"
        lineage["assistant"]["diagnostics"] = {"mode": "off"}
    lineage["assistant"]["output_notes"] = len(performed)
    performed, post_meta = postprocess_notes(performed)
    lineage["postprocessing"] = post_meta
    if req.source == "mic" and expected:
        performed, reference_filter_meta = suppress_reference_harmonic_artifacts(performed, expected)
        lineage["reference_filter"] = reference_filter_meta

    if aligner_mode in {"linear_dtw", "safe_linear_dtw"}:
        a, b = dtw_warp(expected, performed)
        warped_expected = apply_time_warp(expected, a, b)
        if aligner_mode == "safe_linear_dtw":
            base_summary, _ = score(performed, expected, onset_tol=req.onset_tol_s)
            warped_summary, _ = score(performed, warped_expected, onset_tol=req.onset_tol_s)
            base_quality = float(base_summary.get("robustness_score", 0.0) or 0.0)
            warped_quality = float(warped_summary.get("robustness_score", 0.0) or 0.0)
            if warped_quality >= base_quality + 0.005:
                expected = warped_expected
                lineage["aligner"].update({"a": a, "b": b, "applied": True, "guard": "accepted", "baseline_robustness": base_quality, "warped_robustness": warped_quality})
            else:
                lineage["aligner"].update({"a": a, "b": b, "applied": False, "guard": "rejected", "baseline_robustness": base_quality, "warped_robustness": warped_quality})
        else:
            expected = warped_expected
            lineage["aligner"].update({"a": a, "b": b, "applied": True, "guard": "raw"})

    summary, matches = score(performed, expected, onset_tol=req.onset_tol_s)
    summary["assistant_mode"] = assistant_mode
    summary["aligner_mode"] = aligner_mode

    return raw_performed, performed, expected, summary, matches, lineage


@router.post("/sessions/score")
def score_session(req: CreateSessionRequest):
    raw_performed, performed, expected, summary, matches, lineage = _score_session_payload(req)
    return {
        "summary": summary,
        "events": {
            "expected": [e.model_dump() for e in expected],
            "performed": [e.model_dump() for e in performed],
            "raw_performed": [e.model_dump() for e in raw_performed],
            "matches": matches,
        },
        "pipeline": lineage,
    }


@router.post("/sessions")
def create_session(req: CreateSessionRequest, current_user=Depends(get_current_user)):
    raw_performed, performed, expected, summary, matches, lineage = _score_session_payload(req)

    sid = str(uuid.uuid4())
    now = datetime.datetime.utcnow().isoformat() + "Z"

    conn = connect()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO sessions (id,user_id,exercise_id,created_at,source,metrics_json,events_json,pipeline_json,research_json) VALUES (?,?,?,?,?,?,?,?,?)",
        (
            sid,
            current_user["id"],
            req.exercise_id,
            now,
            req.source,
            json.dumps(summary),
            json.dumps(
                {
                    "expected": [e.model_dump() for e in expected],
                    "performed": [e.model_dump() for e in performed],
                    "raw_performed": [e.model_dump() for e in raw_performed],
                    "matches": matches,
                }
            ),
            json.dumps(lineage),
            json.dumps({"created_by_role": current_user["role"]}),
        ),
    )
    conn.commit()
    conn.close()

    return {"session_id": sid, "summary": summary}

@router.get("/sessions")
def list_sessions(user_id: Optional[str] = None, limit: int = 50, current_user=Depends(get_current_user)):
    target_user = user_id or current_user["id"]
    if not can_read_user(current_user, target_user):
        raise HTTPException(status_code=403, detail="Insufficient role")
    conn = connect()
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
        (target_user, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@router.get("/sessions/{session_id}")
def get_session(session_id: str, current_user=Depends(get_current_user)):
    conn = connect()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    conn.close()
    if row and not can_read_user(current_user, row["user_id"]):
        raise HTTPException(status_code=403, detail="Insufficient role")
    return dict(row) if row else {"error": "not found"}

@router.get("/sessions/{session_id}/details")
def get_session_details(session_id: str, current_user=Depends(get_current_user)):
    conn = connect()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    conn.close()
    if not row:
        return {"error": "not found"}
    if not can_read_user(current_user, row["user_id"]):
        raise HTTPException(status_code=403, detail="Insufficient role")
    d = dict(row)
    try:
        d["metrics"] = json.loads(d.get("metrics_json") or "{}")
    except Exception:
        d["metrics"] = {}
    try:
        d["events"] = json.loads(d.get("events_json") or "{}")
    except Exception:
        d["events"] = {}
    try:
        d["pipeline"] = json.loads(d.get("pipeline_json") or "{}")
    except Exception:
        d["pipeline"] = {}
    return d
