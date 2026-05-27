import { Midi } from "@tonejs/midi";
import type { NoteEvent } from "@/lib/types";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const abs = (u: string) => (u.startsWith("http") ? u : `${API_BASE}${u}`);

export function isMidiFile(file: Pick<File, "name" | "type">): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    name.endsWith(".mid") ||
    name.endsWith(".midi") ||
    type.includes("midi") ||
    type === "audio/mid"
  );
}

function midiToNotes(midi: Midi): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const track of midi.tracks) {
    for (const n of track.notes) {
      out.push({
        onset_s: n.time,
        offset_s: n.time + n.duration,
        midi_note: n.midi,
        velocity: Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
      });
    }
  }
  out.sort((a, b) => (a.onset_s - b.onset_s) || (a.midi_note - b.midi_note));
  return out;
}

export async function parseMidiFile(file: File): Promise<NoteEvent[]> {
  const buf = await file.arrayBuffer();
  return midiToNotes(new Midi(buf));
}

export async function fetchAndParseMidi(url: string): Promise<NoteEvent[]> {
  const r = await fetch(abs(url));
  if (!r.ok) throw new Error("Не удалось загрузить MIDI");
  const buf = await r.arrayBuffer();
  return midiToNotes(new Midi(buf));
}
