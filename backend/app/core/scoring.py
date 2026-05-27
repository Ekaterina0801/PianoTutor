import numpy as np
from dataclasses import dataclass
from typing import List, Optional, Tuple, Dict
from scipy.optimize import linear_sum_assignment
from app.models import NoteEvent

@dataclass(frozen=True)
class Match:
    status: str
    performed: Optional[NoteEvent] = None
    expected: Optional[NoteEvent] = None
    dt_onset_s: Optional[float] = None

def apply_offset(notes: List[NoteEvent], off: float) -> List[NoteEvent]:
    return [NoteEvent(onset_s=n.onset_s+off, offset_s=n.offset_s+off, midi_note=n.midi_note, velocity=n.velocity) for n in notes]

def _count(pred: List[NoteEvent], gt: List[NoteEvent], tol: float) -> int:
    used = [False]*len(gt); c=0
    for p in sorted(pred, key=lambda x: x.onset_s):
        best=None; best_dt=None
        for i,g in enumerate(gt):
            if used[i] or g.midi_note!=p.midi_note: 
                continue
            dt=abs(g.onset_s-p.onset_s)
            if dt<=tol and (best_dt is None or dt<best_dt):
                best_dt=dt; best=i
        if best is not None:
            used[best]=True; c+=1
    return c

def best_offset(pred: List[NoteEvent], gt: List[NoteEvent], tol: float=0.05, search_s: float=12.0, step_s: float=0.01) -> float:
    if not pred or not gt: 
        return 0.0
    # Candidate offsets from same-pitch onset differences are much faster and
    # more stable for research ablations than a dense global grid search.
    by_pitch: Dict[int, List[float]] = {}
    for p in pred:
        by_pitch.setdefault(int(p.midi_note), []).append(float(p.onset_s))

    candidates = {0.0}
    for g in gt:
        xs = by_pitch.get(int(g.midi_note), [])
        for po in xs[:80]:
            off = po - float(g.onset_s)
            if abs(off) <= search_s:
                candidates.add(round(off / step_s) * step_s)

    if len(candidates) > 600:
        arr = np.array(sorted(candidates), dtype=np.float32)
        qs = np.linspace(0.0, 1.0, 600)
        candidates = set(float(x) for x in np.quantile(arr, qs))

    best_c=-1; best_o=0.0; best_abs=1e9
    for o in sorted(candidates):
        for oo in (o - step_s, o, o + step_s):
            c=_count(pred, apply_offset(gt, oo), tol)
            abs_oo = abs(float(oo))
            if c>best_c or (c == best_c and abs_oo < best_abs):
                best_c=c; best_o=float(oo); best_abs=abs_oo
    return float(best_o)

def match(pred: List[NoteEvent], gt: List[NoteEvent], onset_tol: float=0.12, pitch_penalty: float=10.0, max_cost: float=1.0) -> List[Match]:
    if not pred and not gt: return []
    if not pred: return [Match(status="missed", expected=e) for e in gt]
    if not gt: return [Match(status="extra", performed=p) for p in pred]
    n,m=len(pred),len(gt)
    cost=np.zeros((n,m), dtype=np.float32)
    for i,p in enumerate(pred):
        for j,e in enumerate(gt):
            dt=abs(p.onset_s-e.onset_s)/max(1e-9,onset_tol)
            if p.midi_note!=e.midi_note: 
                dt+=pitch_penalty
            cost[i,j]=dt
    ri,ci=linear_sum_assignment(cost)
    used_p=set(); used_e=set(); out=[]
    for i,j in zip(ri.tolist(), ci.tolist()):
        c=float(cost[i,j])
        if c>max_cost: 
            continue
        used_p.add(i); used_e.add(j)
        out.append(Match(status="correct", performed=pred[i], expected=gt[j], dt_onset_s=abs(pred[i].onset_s-gt[j].onset_s)))
    for i,p in enumerate(pred):
        if i not in used_p: out.append(Match(status="extra", performed=p))
    for j,e in enumerate(gt):
        if j not in used_e: out.append(Match(status="missed", expected=e))
    return out

def sequence_match(pred: List[NoteEvent], gt: List[NoteEvent]) -> List[Match]:
    """Match by melodic order and pitch, not by absolute onset time."""
    pred_s = sorted(pred, key=lambda x: (x.onset_s, x.midi_note, x.offset_s))
    gt_s = sorted(gt, key=lambda x: (x.onset_s, x.midi_note, x.offset_s))
    n, m = len(pred_s), len(gt_s)
    if not pred_s and not gt_s:
        return []
    if not pred_s:
        return [Match(status="missed", expected=e) for e in gt_s]
    if not gt_s:
        return [Match(status="extra", performed=p) for p in pred_s]

    dp = np.zeros((n + 1, m + 1), dtype=np.int16 if min(n, m) < 32767 else np.int32)
    for i in range(1, n + 1):
        pm = pred_s[i - 1].midi_note
        for j in range(1, m + 1):
            if pm == gt_s[j - 1].midi_note:
                dp[i, j] = dp[i - 1, j - 1] + 1
            else:
                dp[i, j] = max(dp[i - 1, j], dp[i, j - 1])

    pairs: List[Tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        if pred_s[i - 1].midi_note == gt_s[j - 1].midi_note and dp[i, j] == dp[i - 1, j - 1] + 1:
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif dp[i - 1, j] >= dp[i, j - 1]:
            i -= 1
        else:
            j -= 1
    pairs.reverse()

    used_p = {i for i, _ in pairs}
    used_e = {j for _, j in pairs}
    out: List[Match] = []
    for i, j in pairs:
        p = pred_s[i]
        e = gt_s[j]
        out.append(Match(status="correct", performed=p, expected=e, dt_onset_s=abs(p.onset_s - e.onset_s)))
    for i, p in enumerate(pred_s):
        if i not in used_p:
            out.append(Match(status="extra", performed=p))
    for j, e in enumerate(gt_s):
        if j not in used_e:
            out.append(Match(status="missed", expected=e))
    return sorted(out, key=lambda m: (
        min(
            float(m.performed.onset_s) if m.performed is not None else float("inf"),
            float(m.expected.onset_s) if m.expected is not None else float("inf"),
        ),
        m.performed.midi_note if m.performed is not None else (m.expected.midi_note if m.expected is not None else 0),
    ))

def timing_stats(matches: List[Match]) -> Dict[str, float]:
    dts=[m.dt_onset_s for m in matches if m.status=="correct" and m.dt_onset_s is not None]
    signed=[
        float(m.performed.onset_s - m.expected.onset_s)
        for m in matches
        if m.status=="correct" and m.performed is not None and m.expected is not None
    ]
    if not dts:
        return {"mae_s": 0.0, "p95_s": 0.0, "timing_bias_s": 0.0, "early_ratio": 0.0, "late_ratio": 0.0}
    arr=np.array(dts, dtype=np.float32)
    abs_arr=np.abs(arr)
    sarr=np.array(signed, dtype=np.float32)
    return {
        "mae_s": float(np.mean(abs_arr)),
        "p95_s": float(np.percentile(abs_arr, 95)),
        "timing_bias_s": float(np.mean(sarr)),
        "early_ratio": float(np.mean(sarr < -0.015)),
        "late_ratio": float(np.mean(sarr > 0.015)),
    }

def performance_stats(matches: List[Match]) -> Dict[str, float]:
    duration_errors = []
    velocity_errors = []
    for m in matches:
        if m.status != "correct" or m.performed is None or m.expected is None:
            continue
        performed_dur = max(0.0, float(m.performed.offset_s) - float(m.performed.onset_s))
        expected_dur = max(0.0, float(m.expected.offset_s) - float(m.expected.onset_s))
        duration_errors.append(abs(performed_dur - expected_dur))
        velocity_errors.append(abs(float(m.performed.velocity) - float(m.expected.velocity)))

    if not duration_errors:
        return {
            "duration_mae_s": 0.0,
            "duration_p95_s": 0.0,
            "duration_score": 0.0,
            "velocity_mae": 0.0,
            "velocity_score": 0.0,
        }

    dur = np.array(duration_errors, dtype=np.float32)
    vel = np.array(velocity_errors, dtype=np.float32)
    duration_mae = float(np.mean(dur))
    velocity_mae = float(np.mean(vel)) if len(vel) else 0.0
    return {
        "duration_mae_s": duration_mae,
        "duration_p95_s": float(np.percentile(dur, 95)),
        "duration_score": float(max(0.0, min(1.0, 1.0 - duration_mae / 0.35))),
        "velocity_mae": velocity_mae,
        "velocity_score": float(max(0.0, min(1.0, 1.0 - velocity_mae / 64.0))),
    }

def _chord_sets(notes: List[NoteEvent], win_s: float=0.05):
    if not notes:
        return []
    notes = sorted(notes, key=lambda x: x.onset_s)
    clusters=[]
    cur=[notes[0]]
    t0=notes[0].onset_s
    for n in notes[1:]:
        if n.onset_s - t0 <= win_s:
            cur.append(n)
        else:
            clusters.append(cur)
            cur=[n]
            t0=n.onset_s
    clusters.append(cur)
    out=[]
    for c in clusters:
        t=float(np.mean([x.onset_s for x in c]))
        out.append((t, frozenset(int(x.midi_note) for x in c)))
    return out

def chord_metrics(pred: List[NoteEvent], gt: List[NoteEvent], win_s: float=0.05, tol_s: float=0.10) -> Dict[str, float]:
    P=_chord_sets(pred, win_s)
    E=_chord_sets(gt, win_s)
    used=[False]*len(E)
    correct=0; extra=0
    for tp,sp in P:
        best=None; best_dt=None
        for j,(te,se) in enumerate(E):
            if used[j]: 
                continue
            dt=abs(te-tp)
            if dt<=tol_s and (best_dt is None or dt<best_dt):
                best_dt=dt; best=j
        if best is None:
            extra+=1
        else:
            used[best]=True
            if sp==E[best][1]:
                correct+=1
            else:
                # time matches but chord set differs -> count as wrong/extra
                extra+=1
    missed=sum(1 for u in used if not u)
    prec=correct/max(1, correct+extra)
    rec=correct/max(1, correct+missed)
    f1=2*prec*rec/max(1e-9, prec+rec)
    return {"chord_precision": float(prec), "chord_recall": float(rec), "chord_f1": float(f1)}

def chord_sequence_metrics(pred: List[NoteEvent], gt: List[NoteEvent], win_s: float=0.05) -> Dict[str, float]:
    pred_sets = [s for _, s in _chord_sets(pred, win_s)]
    gt_sets = [s for _, s in _chord_sets(gt, win_s)]
    n, m = len(pred_sets), len(gt_sets)
    if n == 0 and m == 0:
        return {"chord_precision": 1.0, "chord_recall": 1.0, "chord_f1": 1.0}
    if n == 0:
        return {"chord_precision": 0.0, "chord_recall": 0.0, "chord_f1": 0.0}
    if m == 0:
        return {"chord_precision": 0.0, "chord_recall": 0.0, "chord_f1": 0.0}

    dp = np.zeros((n + 1, m + 1), dtype=np.int16 if min(n, m) < 32767 else np.int32)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if pred_sets[i - 1] == gt_sets[j - 1]:
                dp[i, j] = dp[i - 1, j - 1] + 1
            else:
                dp[i, j] = max(dp[i - 1, j], dp[i, j - 1])
    correct = int(dp[n, m])
    extra = n - correct
    missed = m - correct
    prec = correct / max(1, correct + extra)
    rec = correct / max(1, correct + missed)
    f1 = 2 * prec * rec / max(1e-9, prec + rec)
    return {"chord_precision": float(prec), "chord_recall": float(rec), "chord_f1": float(f1)}

def hand_metrics(matches: List[Match]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for name, pred in [("left", lambda n: n < 60), ("right", lambda n: n >= 60)]:
        correct = 0
        missed = 0
        extra = 0
        for m in matches:
            note = None
            if m.expected is not None:
                note = m.expected.midi_note
            elif m.performed is not None:
                note = m.performed.midi_note
            if note is None or not pred(note):
                continue
            if m.status == "correct":
                correct += 1
            elif m.status == "missed":
                missed += 1
            elif m.status == "extra":
                extra += 1
        prec = correct / max(1, correct + extra)
        rec = correct / max(1, correct + missed)
        f1 = 2 * prec * rec / max(1e-9, prec + rec)
        out[f"{name}_precision"] = float(prec)
        out[f"{name}_recall"] = float(rec)
        out[f"{name}_f1"] = float(f1)
    return out

def tempo_drift(matches: List[Match]) -> Dict[str, float]:
    pairs = [
        (float(m.expected.onset_s), float(m.performed.onset_s))
        for m in matches
        if m.status == "correct" and m.expected is not None and m.performed is not None
    ]
    if len(pairs) < 3:
        return {"tempo_scale": 1.0, "tempo_drift_pct": 0.0}
    e = np.array([p[0] for p in pairs], dtype=np.float32)
    p = np.array([p[1] for p in pairs], dtype=np.float32)
    A = np.vstack([e, np.ones_like(e)]).T
    a, _ = np.linalg.lstsq(A, p, rcond=None)[0]
    return {"tempo_scale": float(a), "tempo_drift_pct": float((a - 1.0) * 100.0)}

def score(pred: List[NoteEvent], gt: List[NoteEvent], onset_tol: float=0.12) -> Tuple[Dict, List[Dict]]:
    # Align GT to prediction by searching best global offset
    off = best_offset(pred, gt, tol=min(0.05,onset_tol))
    gt_s = apply_offset(gt, off)

    ms = sequence_match(pred, gt_s)
    correct = sum(1 for m in ms if m.status=="correct" and m.performed and m.expected and m.performed.midi_note==m.expected.midi_note)
    extra = sum(1 for m in ms if m.status=="extra")
    missed = sum(1 for m in ms if m.status=="missed")
    prec = correct/max(1,correct+extra)
    rec = correct/max(1,correct+missed)
    f1 = 2*prec*rec/max(1e-9,prec+rec)

    summary = {
        "best_offset_s": float(off),
        "precision": float(prec),
        "recall": float(rec),
        "f1": float(f1),
        "correct": int(correct),
        "extra": int(extra),
        "missed": int(missed),
        "matching_mode": "sequence",
        "sequence_f1": float(f1),
    }

    # Timing metrics from matched notes
    tstat = timing_stats(ms)
    summary.update(tstat)
    summary.update(performance_stats(ms))

    # Chord metrics also compare ordered chord content, not absolute onset.
    summary.update(chord_sequence_metrics(pred, gt_s, win_s=0.05))
    summary.update(hand_metrics(ms))
    summary.update(tempo_drift(ms))
    summary["timing_score"] = float(max(0.0, min(1.0, 1.0 - min(1.0, (summary.get("mae_s", 0.0) or 0.0)/0.35))))
    summary["robustness_score"] = float(max(0.0, min(1.0, 0.70*f1 + 0.20*summary.get("chord_f1", 0.0) + 0.10*summary.get("duration_score", 0.0))))

    matches = [{"status":m.status, "performed": (m.performed.model_dump() if m.performed else None), "expected": (m.expected.model_dump() if m.expected else None), "dt_onset_s":m.dt_onset_s} for m in ms]
    return summary, matches
