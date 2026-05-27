from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

from app.models import NoteEvent


@dataclass(frozen=True)
class NotePostprocessConfig:
    min_duration_s: float = 0.05
    merge_gap_s: float = 0.055
    max_duration_s: float = 12.0
    min_velocity: int = 8
    harmonic_onset_window_s: float = 0.055
    harmonic_velocity_ratio: float = 0.78
    harmonic_duration_ratio: float = 0.45
    harmonic_intervals: Tuple[int, ...] = (12, 19, 24, 28, 31, 36)
    suppress_long_drones: bool = False
    drone_min_duration_s: float = 1.6
    drone_tail_duration_s: float = 2.4
    drone_tail_margin_s: float = 0.65
    drone_min_overlap_onsets: int = 2
    suppress_weak_isolated_attacks: bool = False
    isolated_window_s: float = 0.14
    isolated_min_duration_s: float = 0.13
    isolated_min_velocity: int = 28
    suppress_rapid_repeated_pitches: bool = False
    repeated_pitch_window_s: float = 0.09
    repeated_pitch_velocity_ratio: float = 0.72


def split_hand(midi_note: int) -> str:
    return "left" if midi_note < 60 else "right"


def _duration(note: NoteEvent) -> float:
    return max(0.0, float(note.offset_s - note.onset_s))


def _clusters_by_onset(notes: List[NoteEvent], window_s: float) -> List[List[NoteEvent]]:
    if not notes:
        return []
    ordered = sorted(notes, key=lambda n: (n.onset_s, n.midi_note))
    clusters: List[List[NoteEvent]] = []
    current = [ordered[0]]
    start = float(ordered[0].onset_s)
    for note in ordered[1:]:
        if float(note.onset_s) - start <= window_s:
            current.append(note)
        else:
            clusters.append(current)
            current = [note]
            start = float(note.onset_s)
    clusters.append(current)
    return clusters


def _note_identity(note: NoteEvent) -> Tuple[float, float, int, int]:
    return (
        round(float(note.onset_s), 6),
        round(float(note.offset_s), 6),
        int(note.midi_note),
        int(note.velocity),
    )


def _is_harmonic_shadow(candidate: NoteEvent, base: NoteEvent, cfg: NotePostprocessConfig) -> bool:
    interval = int(candidate.midi_note) - int(base.midi_note)
    if interval not in cfg.harmonic_intervals:
        return False
    if abs(float(candidate.onset_s) - float(base.onset_s)) > cfg.harmonic_onset_window_s:
        return False

    cand_dur = _duration(candidate)
    base_dur = _duration(base)
    cand_velocity = float(candidate.velocity)
    base_velocity = max(1.0, float(base.velocity))
    clearly_weaker = cand_velocity <= base_velocity * cfg.harmonic_velocity_ratio
    clearly_shorter = cand_dur <= max(0.08, base_dur * cfg.harmonic_duration_ratio)
    very_weak = cand_velocity <= base_velocity * 0.62
    return very_weak or (clearly_weaker and clearly_shorter)


def _suppress_harmonic_shadows(notes: List[NoteEvent], cfg: NotePostprocessConfig) -> Tuple[List[NoteEvent], int]:
    removed = set()
    by_onset = sorted(range(len(notes)), key=lambda i: (notes[i].onset_s, notes[i].midi_note))

    for idx in by_onset:
        if idx in removed:
            continue
        candidate = notes[idx]
        for base_idx in by_onset:
            if base_idx == idx or base_idx in removed:
                continue
            base = notes[base_idx]
            if base.midi_note >= candidate.midi_note:
                continue
            if _is_harmonic_shadow(candidate, base, cfg):
                removed.add(idx)
                break

    if not removed:
        return notes, 0
    return [note for i, note in enumerate(notes) if i not in removed], len(removed)


def suppress_reference_harmonic_artifacts(
    performed: List[NoteEvent],
    expected: List[NoteEvent],
    cfg: NotePostprocessConfig = NotePostprocessConfig(),
    onset_window_s: float = 0.08,
    expected_chord_window_s: float = 0.08,
) -> Tuple[List[NoteEvent], Dict]:
    """Remove microphone octave/harmonic doubles that are not present in the reference chord vocabulary."""
    if not performed or not expected:
        return performed, {"input_notes": len(performed), "output_notes": len(performed), "removed_reference_harmonics": 0}

    expected_midi = {int(note.midi_note) for note in expected}
    allowed_pairs = set()
    for cluster in _clusters_by_onset(expected, expected_chord_window_s):
        pitches = sorted({int(note.midi_note) for note in cluster})
        for i, lower in enumerate(pitches):
            for higher in pitches[i + 1:]:
                allowed_pairs.add((lower, higher))

    remove_keys = set()
    for cluster in _clusters_by_onset(performed, onset_window_s):
        ordered = sorted(cluster, key=lambda n: (n.midi_note, -n.velocity))
        for candidate in ordered:
            candidate_midi = int(candidate.midi_note)
            for base in ordered:
                base_midi = int(base.midi_note)
                interval = candidate_midi - base_midi
                if interval <= 0:
                    continue
                if interval not in cfg.harmonic_intervals:
                    continue
                if base_midi not in expected_midi:
                    continue
                if (base_midi, candidate_midi) in allowed_pairs:
                    continue
                remove_keys.add(_note_identity(candidate))
                break

    if not remove_keys:
        return performed, {
            "input_notes": len(performed),
            "output_notes": len(performed),
            "removed_reference_harmonics": 0,
            "policy": "reference harmonic artifacts",
        }

    out = [note for note in performed if _note_identity(note) not in remove_keys]
    return out, {
        "input_notes": len(performed),
        "output_notes": len(out),
        "removed_reference_harmonics": len(performed) - len(out),
        "policy": "reference harmonic artifacts",
    }


def _suppress_sustained_drones(notes: List[NoteEvent], cfg: NotePostprocessConfig) -> Tuple[List[NoteEvent], int]:
    if not cfg.suppress_long_drones or len(notes) < 3:
        return notes, 0

    end_s = max(float(n.offset_s) for n in notes)
    removed = set()
    for i, note in enumerate(notes):
        dur = _duration(note)
        if dur < cfg.drone_min_duration_s:
            continue

        has_previous_context = any(float(other.onset_s) < float(note.onset_s) - 0.05 for j, other in enumerate(notes) if j != i)
        if not has_previous_context:
            continue

        spans_tail = float(note.offset_s) >= end_s - cfg.drone_tail_margin_s
        later_inside = sum(
            1
            for j, other in enumerate(notes)
            if j != i
            and float(other.onset_s) > float(note.onset_s) + 0.10
            and float(other.onset_s) < float(note.offset_s) - 0.08
        )
        repeated_pitch = any(
            j != i
            and int(other.midi_note) == int(note.midi_note)
            and float(other.onset_s) < float(note.onset_s) - 0.05
            for j, other in enumerate(notes)
        )

        if spans_tail and dur >= cfg.drone_tail_duration_s:
            removed.add(i)
            continue
        if repeated_pitch and later_inside >= 1 and dur >= cfg.drone_min_duration_s:
            removed.add(i)
            continue
        if later_inside >= cfg.drone_min_overlap_onsets and dur >= cfg.drone_tail_duration_s:
            removed.add(i)

    if not removed:
        return notes, 0
    return [note for i, note in enumerate(notes) if i not in removed], len(removed)


def _suppress_weak_isolated_attacks(notes: List[NoteEvent], cfg: NotePostprocessConfig) -> Tuple[List[NoteEvent], int]:
    if not cfg.suppress_weak_isolated_attacks or len(notes) < 2:
        return notes, 0

    removed = set()
    for i, note in enumerate(notes):
        if _duration(note) >= cfg.isolated_min_duration_s:
            continue
        if int(note.velocity) >= cfg.isolated_min_velocity:
            continue
        has_onset_neighbor = any(
            i != j and abs(float(other.onset_s) - float(note.onset_s)) <= cfg.isolated_window_s
            for j, other in enumerate(notes)
        )
        has_same_pitch_context = any(
            i != j
            and int(other.midi_note) == int(note.midi_note)
            and abs(float(other.onset_s) - float(note.onset_s)) <= cfg.isolated_window_s * 2.0
            for j, other in enumerate(notes)
        )
        if not has_onset_neighbor and not has_same_pitch_context:
            removed.add(i)

    if not removed:
        return notes, 0
    return [note for i, note in enumerate(notes) if i not in removed], len(removed)


def _suppress_rapid_repeated_pitches(notes: List[NoteEvent], cfg: NotePostprocessConfig) -> Tuple[List[NoteEvent], int]:
    if not cfg.suppress_rapid_repeated_pitches or len(notes) < 2:
        return notes, 0

    removed = set()
    by_pitch: Dict[int, List[int]] = {}
    for i, note in enumerate(notes):
        by_pitch.setdefault(int(note.midi_note), []).append(i)

    for indexes in by_pitch.values():
        indexes.sort(key=lambda i: float(notes[i].onset_s))
        prev = indexes[0]
        for cur in indexes[1:]:
            if cur in removed:
                continue
            prev_note = notes[prev]
            cur_note = notes[cur]
            gap = float(cur_note.onset_s) - float(prev_note.onset_s)
            if gap <= cfg.repeated_pitch_window_s:
                prev_strength = float(prev_note.velocity) * max(0.04, _duration(prev_note))
                cur_strength = float(cur_note.velocity) * max(0.04, _duration(cur_note))
                if cur_strength <= prev_strength * cfg.repeated_pitch_velocity_ratio:
                    removed.add(cur)
                    continue
                if prev_strength <= cur_strength * cfg.repeated_pitch_velocity_ratio:
                    removed.add(prev)
                    prev = cur
                    continue
            if prev in removed or gap > cfg.repeated_pitch_window_s:
                prev = cur

    if not removed:
        return notes, 0
    return [note for i, note in enumerate(notes) if i not in removed], len(removed)


def postprocess_notes(
    notes: List[NoteEvent],
    cfg: NotePostprocessConfig = NotePostprocessConfig(),
) -> Tuple[List[NoteEvent], Dict]:
    sorted_notes = sorted(notes, key=lambda n: (n.midi_note, n.onset_s))
    removed_short = 0
    removed_quiet = 0
    clipped = 0
    by_pitch: Dict[int, List[NoteEvent]] = {}
    for n in sorted_notes:
        dur = max(0.0, float(n.offset_s - n.onset_s))
        if dur < cfg.min_duration_s:
            removed_short += 1
            continue
        if n.velocity < cfg.min_velocity:
            removed_quiet += 1
            continue
        off = min(n.offset_s, n.onset_s + cfg.max_duration_s)
        if off != n.offset_s:
            clipped += 1
        by_pitch.setdefault(n.midi_note, []).append(
            NoteEvent(onset_s=n.onset_s, offset_s=off, midi_note=n.midi_note, velocity=n.velocity)
        )

    merged_count = 0
    out: List[NoteEvent] = []
    for pitch, xs in by_pitch.items():
        if not xs:
            continue
        cur = xs[0]
        for nxt in xs[1:]:
            if nxt.onset_s <= cur.offset_s + cfg.merge_gap_s:
                merged_count += 1
                cur = NoteEvent(
                    onset_s=min(cur.onset_s, nxt.onset_s),
                    offset_s=max(cur.offset_s, nxt.offset_s),
                    midi_note=pitch,
                    velocity=max(cur.velocity, nxt.velocity),
                )
            else:
                out.append(cur)
                cur = nxt
        out.append(cur)

    out.sort(key=lambda n: (n.onset_s, n.midi_note))
    out, removed_harmonic = _suppress_harmonic_shadows(out, cfg)
    out, removed_weak_isolated = _suppress_weak_isolated_attacks(out, cfg)
    out, removed_repeated = _suppress_rapid_repeated_pitches(out, cfg)
    out, removed_drones = _suppress_sustained_drones(out, cfg)
    out.sort(key=lambda n: (n.onset_s, n.midi_note))
    hands = {"left": sum(1 for n in out if split_hand(n.midi_note) == "left"), "right": sum(1 for n in out if split_hand(n.midi_note) == "right")}
    return out, {
        "input_notes": len(notes),
        "output_notes": len(out),
        "removed_short": removed_short,
        "removed_quiet": removed_quiet,
        "removed_harmonic_shadows": removed_harmonic,
        "removed_weak_isolated_attacks": removed_weak_isolated,
        "removed_rapid_repeated_pitches": removed_repeated,
        "removed_sustained_drones": removed_drones,
        "merged_duplicates": merged_count,
        "clipped_long_notes": clipped,
        "hand_counts": hands,
        "confidence_policy": "rule-based: duration, velocity, duplicate stability and harmonic-shadow suppression",
    }
