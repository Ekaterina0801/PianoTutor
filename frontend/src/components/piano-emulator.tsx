"use client";

import { KeyboardMusic, Minus, Plus, Power } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { NoteEvent } from "@/lib/types";
import type { MidiLiveSynth } from "@/lib/midiPlayback";
import { createMidiLiveSynth } from "@/lib/midiPlayback";

const VELOCITY = 96;
const MIN_OCTAVE = 1;
const MAX_OCTAVE = 7;
const DEFAULT_OCTAVE = 4;
const WHITE_KEY_WIDTH = 36;
const BLACK_KEY_WIDTH = 24;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);

const KEYMAP = [
  { code: "KeyA", key: "A", semitone: 0 },
  { code: "KeyW", key: "W", semitone: 1 },
  { code: "KeyS", key: "S", semitone: 2 },
  { code: "KeyE", key: "E", semitone: 3 },
  { code: "KeyD", key: "D", semitone: 4 },
  { code: "KeyF", key: "F", semitone: 5 },
  { code: "KeyT", key: "T", semitone: 6 },
  { code: "KeyG", key: "G", semitone: 7 },
  { code: "KeyY", key: "Y", semitone: 8 },
  { code: "KeyH", key: "H", semitone: 9 },
  { code: "KeyU", key: "U", semitone: 10 },
  { code: "KeyJ", key: "J", semitone: 11 },
  { code: "KeyK", key: "K", semitone: 12 },
] as const;

type KeyDef = (typeof KEYMAP)[number];

type HeldKeyboardNote = {
  midi: number;
  source: string;
};

const KEY_BY_CODE = new Map<string, KeyDef>(KEYMAP.map((k) => [k.code, k]));

function isWhite(midi: number) {
  return WHITE.has(midi % 12);
}

function midiName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function octaveBaseMidi(octave: number) {
  return (octave + 1) * 12;
}

function noteEvent(midi: number, velocity: number): NoteEvent {
  const now = performance.now() / 1000;
  return { onset_s: now, offset_s: now, midi_note: midi, velocity };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function PianoEmulator({
  onNote,
  pressed,
}: {
  onNote: (evt: NoteEvent, isOn: boolean) => void;
  pressed: number[];
}) {
  const [computerEnabled, setComputerEnabled] = useState(true);
  const [octave, setOctave] = useState(DEFAULT_OCTAVE);
  const [localPressed, setLocalPressed] = useState<number[]>([]);
  const synthRef = useRef<MidiLiveSynth | null>(null);
  const onNoteRef = useRef(onNote);
  const noteSourcesRef = useRef<Map<number, Set<string>>>(new Map());
  const pointerNotesRef = useRef<Map<number, HeldKeyboardNote>>(new Map());
  const keyboardNotesRef = useRef<Map<string, HeldKeyboardNote>>(new Map());

  useEffect(() => {
    onNoteRef.current = onNote;
  }, [onNote]);

  const syncPressed = useCallback(() => {
    setLocalPressed(Array.from(noteSourcesRef.current.keys()).sort((a, b) => a - b));
  }, []);

  const startNote = useCallback((midi: number, source: string, velocity = VELOCITY) => {
    let sources = noteSourcesRef.current.get(midi);
    const wasSilent = !sources || sources.size === 0;
    if (!sources) {
      sources = new Set<string>();
      noteSourcesRef.current.set(midi, sources);
    }
    if (sources.has(source)) return;
    sources.add(source);

    if (wasSilent) {
      syncPressed();
      onNoteRef.current(noteEvent(midi, velocity), true);
      void synthRef.current?.noteOn(midi, velocity).catch(() => {});
    }
  }, [syncPressed]);

  const stopNote = useCallback((midi: number, source: string, velocity = VELOCITY) => {
    const sources = noteSourcesRef.current.get(midi);
    if (!sources || !sources.has(source)) return;

    sources.delete(source);
    if (sources.size > 0) return;

    noteSourcesRef.current.delete(midi);
    syncPressed();
    onNoteRef.current(noteEvent(midi, velocity), false);
    synthRef.current?.noteOff(midi);
  }, [syncPressed]);

  const releaseKeyboard = useCallback(() => {
    for (const [code, held] of keyboardNotesRef.current.entries()) {
      stopNote(held.midi, held.source);
      keyboardNotesRef.current.delete(code);
    }
  }, [stopNote]);

  const releaseAll = useCallback(() => {
    const active = Array.from(noteSourcesRef.current.keys());
    noteSourcesRef.current.clear();
    pointerNotesRef.current.clear();
    keyboardNotesRef.current.clear();
    syncPressed();
    for (const midi of active) onNoteRef.current(noteEvent(midi, VELOCITY), false);
    synthRef.current?.allNotesOff();
  }, [syncPressed]);

  useEffect(() => {
    synthRef.current = createMidiLiveSynth({ volume: 0.5 });
    return () => {
      releaseAll();
      synthRef.current?.dispose();
      synthRef.current = null;
    };
  }, [releaseAll]);

  const shiftOctave = useCallback((delta: number) => {
    releaseKeyboard();
    setOctave((current) => clamp(current + delta, MIN_OCTAVE, MAX_OCTAVE));
  }, [releaseKeyboard]);

  useEffect(() => {
    if (!computerEnabled) return;

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
      if (event.repeat || keyboardNotesRef.current.has(event.code)) return;

      const midi = octaveBaseMidi(octave) + key.semitone;
      const source = `key:${event.code}`;
      keyboardNotesRef.current.set(event.code, { midi, source });
      startNote(midi, source);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const held = keyboardNotesRef.current.get(event.code);
      if (!held) return;
      event.preventDefault();

      keyboardNotesRef.current.delete(event.code);
      stopNote(held.midi, held.source);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      releaseKeyboard();
    };
  }, [computerEnabled, octave, releaseKeyboard, shiftOctave, startNote, stopNote]);

  const screenStart = 36;
  const screenEnd = 84;
  const keys = useMemo(() => Array.from({ length: screenEnd - screenStart + 1 }, (_, i) => screenStart + i), []);
  const whites = useMemo(() => keys.filter(isWhite), [keys]);
  const whiteIndex = useMemo(() => {
    const out = new Map<number, number>();
    whites.forEach((note, index) => out.set(note, index));
    return out;
  }, [whites]);
  const pressedSet = useMemo(() => new Set([...pressed, ...localPressed]), [pressed, localPressed]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const source = `pointer:${event.pointerId}`;
    pointerNotesRef.current.set(event.pointerId, { midi, source });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.blur();
    startNote(midi, source);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const held = pointerNotesRef.current.get(event.pointerId);
    if (!held) return;

    pointerNotesRef.current.delete(event.pointerId);
    stopNote(held.midi, held.source);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  };

  const toggleComputer = () => {
    setComputerEnabled((current) => {
      if (current) releaseKeyboard();
      return !current;
    });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <KeyboardMusic className="h-5 w-5 text-cyan-100" />
          </div>
          <div>
            <div className="text-sm font-semibold">Эмулятор пианино</div>
            <div className="mt-1 text-xs text-[rgb(var(--muted))]">C2-C6 · окт. {octave}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => shiftOctave(-1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white hover:bg-white/10"
            aria-label="Октава ниже"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => shiftOctave(1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white hover:bg-white/10"
            aria-label="Октава выше"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleComputer}
            className={
              "inline-flex h-9 items-center gap-2 rounded-2xl px-3 text-sm font-semibold transition " +
              (computerEnabled ? "bg-cyan-300 text-zinc-950 hover:bg-cyan-200" : "border border-white/10 bg-white/5 text-white hover:bg-white/10")
            }
            aria-pressed={computerEnabled}
          >
            <Power className="h-4 w-4" />
            Клавиши
          </button>
        </div>
      </div>

      <div
        className="mt-4 overflow-x-auto rounded-xl2 border border-white/10 bg-zinc-950/80"
        onContextMenu={(event) => event.preventDefault()}
        style={{ WebkitOverflowScrolling: "touch" as any }}
      >
        <div className="relative h-52" style={{ width: `${whites.length * WHITE_KEY_WIDTH}px` }}>
          <div className="absolute inset-0 flex h-full">
            {whites.map((midi) => {
              const active = pressedSet.has(midi);
              return (
                <button
                  key={midi}
                  type="button"
                  aria-label={midiName(midi)}
                  onPointerDown={(event) => onPointerDown(event, midi)}
                  onPointerUp={finishPointer}
                  onPointerCancel={finishPointer}
                  onLostPointerCapture={finishPointer}
                  className={
                    "relative h-full shrink-0 touch-none select-none border-r border-black/25 transition-colors " +
                    (active ? "bg-emerald-200 text-zinc-950" : "bg-zinc-100 text-zinc-700 hover:bg-cyan-50")
                  }
                  style={{ width: `${WHITE_KEY_WIDTH}px` }}
                >
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold">
                    {midiName(midi)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="pointer-events-none absolute inset-0">
            {keys.filter((midi) => !isWhite(midi)).map((midi) => {
              let nextWhiteIdx = whites.findIndex((white) => white > midi);
              if (nextWhiteIdx < 0) nextWhiteIdx = whites.length - 1;
              const wi = Math.max(0, nextWhiteIdx - 1);
              const leftPx = wi * WHITE_KEY_WIDTH + WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2;
              const active = pressedSet.has(midi);

              return (
                <button
                  key={midi}
                  type="button"
                  aria-label={midiName(midi)}
                  onPointerDown={(event) => onPointerDown(event, midi)}
                  onPointerUp={finishPointer}
                  onPointerCancel={finishPointer}
                  onLostPointerCapture={finishPointer}
                  className={
                    "pointer-events-auto absolute top-0 z-10 h-32 touch-none select-none rounded-b-lg border border-black/60 text-[9px] font-semibold shadow-soft transition-colors " +
                    (active ? "bg-emerald-500 text-emerald-950" : "bg-zinc-950 text-zinc-200 hover:bg-zinc-800")
                  }
                  style={{ left: `${leftPx}px`, width: `${BLACK_KEY_WIDTH}px` }}
                >
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2">{midiName(midi)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 sm:grid-cols-[repeat(13,minmax(0,1fr))]">
        {KEYMAP.map((key) => {
          const midi = octaveBaseMidi(octave) + key.semitone;
          const active = pressedSet.has(midi);
          return (
            <div
              key={key.code}
              className={
                "flex min-h-[42px] flex-col items-center justify-center rounded-xl2 border px-1 text-center " +
                (active ? "border-emerald-300/70 bg-emerald-300/20 text-emerald-50" : "border-white/10 bg-white/5 text-zinc-200")
              }
            >
              <div className="text-[11px] font-semibold">{key.key}</div>
              <div className="mt-0.5 text-[9px] text-[rgb(var(--muted))]">{midiName(midi)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
