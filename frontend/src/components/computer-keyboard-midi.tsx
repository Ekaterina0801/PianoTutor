"use client";

import { KeyboardMusic, Power } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteEvent } from "@/lib/types";
import type { MidiLiveSynth } from "@/lib/midiPlayback";
import { createMidiLiveSynth } from "@/lib/midiPlayback";

const VELOCITY = 96;
const MIN_OCTAVE = 1;
const MAX_OCTAVE = 7;
const DEFAULT_OCTAVE = 4;

const KEYMAP = [
  { code: "KeyA", key: "A", semitone: 0, name: "C", black: false },
  { code: "KeyW", key: "W", semitone: 1, name: "C#", black: true },
  { code: "KeyS", key: "S", semitone: 2, name: "D", black: false },
  { code: "KeyE", key: "E", semitone: 3, name: "D#", black: true },
  { code: "KeyD", key: "D", semitone: 4, name: "E", black: false },
  { code: "KeyF", key: "F", semitone: 5, name: "F", black: false },
  { code: "KeyT", key: "T", semitone: 6, name: "F#", black: true },
  { code: "KeyG", key: "G", semitone: 7, name: "G", black: false },
  { code: "KeyY", key: "Y", semitone: 8, name: "G#", black: true },
  { code: "KeyH", key: "H", semitone: 9, name: "A", black: false },
  { code: "KeyU", key: "U", semitone: 10, name: "A#", black: true },
  { code: "KeyJ", key: "J", semitone: 11, name: "B", black: false },
  { code: "KeyK", key: "K", semitone: 12, name: "C", black: false },
] as const;

type KeyDef = (typeof KEYMAP)[number];

type HeldNote = {
  midi: number;
  velocity: number;
};

const KEY_BY_CODE = new Map<string, KeyDef>(KEYMAP.map((k) => [k.code, k]));

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function octaveBaseMidi(octave: number) {
  return (octave + 1) * 12;
}

function noteName(note: KeyDef, octave: number) {
  return `${note.name}${note.semitone === 12 ? octave + 1 : octave}`;
}

function noteEvent(midi: number, velocity: number): NoteEvent {
  const now = performance.now() / 1000;
  return { onset_s: now, offset_s: now, midi_note: midi, velocity };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

export function ComputerKeyboardMidi({ onNote }: { onNote: (evt: NoteEvent, isOn: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [octave, setOctave] = useState(DEFAULT_OCTAVE);
  const [pressedCodes, setPressedCodes] = useState<string[]>([]);
  const heldRef = useRef<Map<string, HeldNote>>(new Map());
  const synthRef = useRef<MidiLiveSynth | null>(null);
  const onNoteRef = useRef(onNote);

  useEffect(() => {
    onNoteRef.current = onNote;
  }, [onNote]);

  useEffect(() => {
    synthRef.current = createMidiLiveSynth();
    return () => {
      for (const held of heldRef.current.values()) onNoteRef.current(noteEvent(held.midi, held.velocity), false);
      heldRef.current.clear();
      synthRef.current?.dispose();
      synthRef.current = null;
    };
  }, []);

  const releaseAll = useCallback(() => {
    const held = Array.from(heldRef.current.values());
    heldRef.current.clear();
    setPressedCodes([]);

    for (const note of held) {
      onNoteRef.current(noteEvent(note.midi, note.velocity), false);
      synthRef.current?.noteOff(note.midi);
    }
    synthRef.current?.allNotesOff();
  }, []);

  const toggleEnabled = useCallback(() => {
    setEnabled((current) => {
      if (current) releaseAll();
      return !current;
    });
  }, [releaseAll]);

  const shiftOctave = useCallback((delta: number) => {
    releaseAll();
    setOctave((current) => clamp(current + delta, MIN_OCTAVE, MAX_OCTAVE));
  }, [releaseAll]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      if (event.code === "KeyZ" || event.code === "Minus") {
        if (!event.repeat) shiftOctave(-1);
        event.preventDefault();
        return;
      }

      if (event.code === "KeyX" || event.code === "Equal") {
        if (!event.repeat) shiftOctave(1);
        event.preventDefault();
        return;
      }

      const key = KEY_BY_CODE.get(event.code);
      if (!key) return;
      event.preventDefault();
      if (event.repeat || heldRef.current.has(event.code)) return;

      const midi = octaveBaseMidi(octave) + key.semitone;
      const held = { midi, velocity: VELOCITY };
      heldRef.current.set(event.code, held);
      setPressedCodes(Array.from(heldRef.current.keys()));
      onNoteRef.current(noteEvent(midi, VELOCITY), true);
      void synthRef.current?.noteOn(midi, VELOCITY).catch(() => {});
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const held = heldRef.current.get(event.code);
      if (!held) return;
      event.preventDefault();

      heldRef.current.delete(event.code);
      setPressedCodes(Array.from(heldRef.current.keys()));
      onNoteRef.current(noteEvent(held.midi, held.velocity), false);
      synthRef.current?.noteOff(held.midi);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      releaseAll();
    };
  }, [enabled, octave, releaseAll, shiftOctave]);

  const pressedSet = useMemo(() => new Set(pressedCodes), [pressedCodes]);
  const rangeLabel = `C${octave}–C${octave + 1}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <KeyboardMusic className="h-5 w-5 text-cyan-100" />
          </div>
          <div>
            <div className="text-sm font-medium">Компьютерная клавиатура</div>
            <div className="text-xs text-zinc-300">
              {enabled ? `Активно · ${rangeLabel}` : "Используйте A W S E D F T G Y H U J K"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200">
            Окт. {octave}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.blur();
              toggleEnabled();
            }}
            className={
              "inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition " +
              (enabled ? "bg-cyan-300 text-zinc-950 hover:bg-cyan-200" : "border border-white/10 bg-white/5 text-white hover:bg-white/10")
            }
            aria-pressed={enabled}
          >
            <Power className="h-4 w-4" />
            {enabled ? "Вкл" : "Включить"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-2 sm:grid-cols-[repeat(13,minmax(0,1fr))]">
        {KEYMAP.map((key) => {
          const active = pressedSet.has(key.code);
          return (
            <div
              key={key.code}
              className={
                "flex min-h-[54px] flex-col items-center justify-center rounded-xl2 border px-2 py-2 text-center transition " +
                (active
                  ? "border-emerald-300/70 bg-emerald-300/20 text-emerald-50"
                  : key.black
                  ? "border-white/10 bg-zinc-950 text-zinc-100"
                  : "border-white/10 bg-white/10 text-zinc-100")
              }
            >
              <div className="text-xs font-semibold">{key.key}</div>
              <div className="mt-1 text-[10px] text-zinc-300">{noteName(key, octave)}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
        <span>Z / X октава</span>
        <span>·</span>
        <span>- / + октава</span>
        <span>·</span>
        <span>Сила {VELOCITY}</span>
      </div>
    </div>
  );
}
