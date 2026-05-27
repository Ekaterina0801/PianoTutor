from __future__ import annotations
from typing import List
import mido
from app.models import NoteEvent

def midi_file_to_notes(path: str) -> List[NoteEvent]:
    mid = mido.MidiFile(path)
    tempo = 500000  # default 120bpm
    ticks_per_beat = mid.ticks_per_beat

    # Track running time in seconds
    t_s = 0.0
    # active notes: (channel,note)->(onset, velocity)
    active = {}
    out: List[NoteEvent] = []

    for msg in mid:  # mido yields messages with .time in seconds by default if mid is loaded? Actually .time is in ticks; but iter(mid) converts to seconds using tempo changes? It's complex.
        # Safer: use mid.play() not possible. We'll manually convert using ticks and tempo changes:
        break

    # Manual pass per track with merged time: easiest approach is to use mid.tracks and accumulate ticks and tempo per track,
    # but for robustness and simplicity in diploma code, use mido.merge_tracks which keeps ticks.
    merged = mido.merge_tracks(mid.tracks)
    t_ticks = 0
    tempo = 500000
    def ticks_to_seconds(dt_ticks: int, tempo_us_per_beat: int) -> float:
        return (dt_ticks * tempo_us_per_beat) / (ticks_per_beat * 1_000_000.0)

    for msg in merged:
        t_ticks += msg.time
        t_s += ticks_to_seconds(msg.time, tempo)
        if msg.type == "set_tempo":
            tempo = msg.tempo
            continue
        if msg.type == "note_on" and msg.velocity > 0:
            active[(msg.channel, msg.note)] = (t_s, int(msg.velocity))
        if (msg.type == "note_off") or (msg.type == "note_on" and msg.velocity == 0):
            key = (msg.channel, msg.note)
            if key in active:
                onset_s, vel = active.pop(key)
                if t_s > onset_s:
                    out.append(NoteEvent(onset_s=float(onset_s), offset_s=float(t_s), midi_note=int(msg.note), velocity=int(vel)))

    out.sort(key=lambda x: (x.onset_s, x.midi_note))
    return out
