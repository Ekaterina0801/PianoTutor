"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteEvent } from "@/lib/types";
import type { MidiPlaybackController, PlaybackTrack } from "@/lib/midiPlayback";
import { startMidiPlayback } from "@/lib/midiPlayback";
import { Button, Pill, Segmented } from "@/components/ui";

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SEQUENCE_STEP_S = 0.52;
const SEQUENCE_NOTE_S = 0.34;
const CHORD_BUCKET_S = 0.08;
type MatchStatus = "correct" | "missed" | "extra";
type MatchRow = {
  status?: string;
  expected?: NoteEvent | null;
  performed?: NoteEvent | null;
  dt_onset_s?: number | null;
};
const EMPTY_MATCHES: MatchRow[] = [];
type SequenceDisplay = {
  expected: NoteEvent[];
  performed: NoteEvent[];
  expectedStatuses: Map<number, MatchStatus>;
  performedStatuses: Map<number, MatchStatus>;
};

function isWhite(midi: number) {
  return WHITE.has(midi % 12);
}

function midiName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function activeAt(notes: NoteEvent[], t: number) {
  const active: number[] = [];
  for (const note of notes) {
    if (note.onset_s <= t && note.offset_s > t) active.push(note.midi_note);
  }
  return active.sort((a, b) => a - b);
}

function normalizeStatus(status?: string): MatchStatus | null {
  if (status === "correct" || status === "missed" || status === "extra") return status;
  return null;
}

function statusPriority(status: MatchStatus) {
  if (status === "missed" || status === "extra") return 2;
  return 1;
}

function setPriorityStatus(map: Map<number, MatchStatus>, midi: number, status: MatchStatus) {
  const prev = map.get(midi);
  if (!prev || statusPriority(status) >= statusPriority(prev)) map.set(midi, status);
}

function findNearestNoteIndex(notes: NoteEvent[], target: NoteEvent | null | undefined, used: Set<number>, onsetOffsetS = 0) {
  if (!target) return -1;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < notes.length; i += 1) {
    if (used.has(i) || notes[i].midi_note !== target.midi_note) continue;
    const distance = Math.abs(notes[i].onset_s + onsetOffsetS - target.onset_s);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function buildMatchIndexes(expected: NoteEvent[], performed: NoteEvent[], matches: MatchRow[] = [], expectedOffsetS = 0) {
  const expectedStatuses = new Map<number, MatchStatus>();
  const performedStatuses = new Map<number, MatchStatus>();
  const usedExpected = new Set<number>();
  const usedPerformed = new Set<number>();

  for (const row of matches) {
    const status = normalizeStatus(row.status);
    if (!status) continue;

    const expectedIndex = findNearestNoteIndex(expected, row.expected, usedExpected, expectedOffsetS);
    if (expectedIndex >= 0) {
      expectedStatuses.set(expectedIndex, status === "extra" ? "missed" : status);
      usedExpected.add(expectedIndex);
    }

    const performedIndex = findNearestNoteIndex(performed, row.performed, usedPerformed);
    if (performedIndex >= 0) {
      performedStatuses.set(performedIndex, status === "missed" ? "extra" : status);
      usedPerformed.add(performedIndex);
    }
  }

  return { expectedStatuses, performedStatuses };
}

function rowTime(row: MatchRow) {
  const performed = row.performed?.onset_s;
  const expected = row.expected?.onset_s;
  if (typeof performed === "number" && typeof expected === "number") return Math.min(performed, expected);
  if (typeof performed === "number") return performed;
  if (typeof expected === "number") return expected;
  return 0;
}

function displayNote(source: NoteEvent, onset: number): NoteEvent {
  return {
    onset_s: onset,
    offset_s: onset + SEQUENCE_NOTE_S,
    midi_note: source.midi_note,
    velocity: source.velocity,
  };
}

function buildSequenceDisplay(matches: MatchRow[]): SequenceDisplay | null {
  const rows = matches
    .filter((row) => row.expected || row.performed)
    .slice()
    .sort((a, b) => rowTime(a) - rowTime(b));
  if (!rows.length) return null;

  const expected: NoteEvent[] = [];
  const performed: NoteEvent[] = [];
  const expectedStatuses = new Map<number, MatchStatus>();
  const performedStatuses = new Map<number, MatchStatus>();
  let slot = -1;
  let lastTime = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const status = normalizeStatus(row.status) ?? "extra";
    const t = rowTime(row);
    if (slot < 0 || Math.abs(t - lastTime) > CHORD_BUCKET_S) {
      slot += 1;
      lastTime = t;
    }
    const onset = slot * SEQUENCE_STEP_S;

    if (row.expected) {
      const index = expected.length;
      expected.push(displayNote(row.expected, onset));
      expectedStatuses.set(index, status === "extra" ? "missed" : status);
    }
    if (row.performed) {
      const index = performed.length;
      performed.push(displayNote(row.performed, onset));
      performedStatuses.set(index, status === "missed" ? "extra" : status);
    }
  }

  return { expected, performed, expectedStatuses, performedStatuses };
}

function statusMapKey(map: Map<number, MatchStatus>) {
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([midi, status]) => `${midi}:${status}`)
    .join(",");
}

function normalizePerformed(expected: NoteEvent[], performed: NoteEvent[]) {
  if (!performed.length) return performed;
  const perfStart = Math.min(...performed.map((n) => n.onset_s));
  const expEnd = expected.length ? Math.max(...expected.map((n) => n.offset_s)) : 0;
  if (perfStart > Math.max(15, expEnd + 5)) {
    return performed.map((n) => ({ ...n, onset_s: n.onset_s - perfStart, offset_s: n.offset_s - perfStart }));
  }
  return performed;
}

function noteSummary(xs: number[]) {
  if (!xs.length) return "—";
  return xs.slice().sort((a, b) => a - b).map(midiName).join(" ");
}

function useStableActiveNotes(notes: NoteEvent[], time: number) {
  const cacheRef = useRef<{ key: string; values: number[] }>({ key: "", values: [] });

  return useMemo(() => {
    const values = activeAt(notes, time);
    const key = values.join(",");
    if (key === cacheRef.current.key) return cacheRef.current.values;
    cacheRef.current = { key, values };
    return values;
  }, [notes, time]);
}

function useStableMatchStatuses(
  notes: NoteEvent[],
  time: number,
  statuses: Map<number, MatchStatus>,
  defaultStatus: MatchStatus,
) {
  const cacheRef = useRef<{ key: string; values: Map<number, MatchStatus> }>({ key: "", values: new Map() });

  return useMemo(() => {
    const values = new Map<number, MatchStatus>();
    for (let i = 0; i < notes.length; i += 1) {
      const note = notes[i];
      if (note.onset_s <= time && note.offset_s > time) {
        setPriorityStatus(values, note.midi_note, statuses.get(i) ?? defaultStatus);
      }
    }
    const key = statusMapKey(values);
    if (key === cacheRef.current.key) return cacheRef.current.values;
    cacheRef.current = { key, values };
    return values;
  }, [defaultStatus, notes, statuses, time]);
}

function useStableComparisonStatuses(
  active: number[],
  compare: Set<number>,
  matchedStatus: MatchStatus,
  unmatchedStatus: MatchStatus,
) {
  const cacheRef = useRef<{ key: string; values: Map<number, MatchStatus> }>({ key: "", values: new Map() });

  return useMemo(() => {
    const values = new Map<number, MatchStatus>();
    for (const midi of active) values.set(midi, compare.has(midi) ? matchedStatus : unmatchedStatus);
    const key = statusMapKey(values);
    if (key === cacheRef.current.key) return cacheRef.current.values;
    cacheRef.current = { key, values };
    return values;
  }, [active, compare, matchedStatus, unmatchedStatus]);
}

function notesWithStatus(statuses: Map<number, MatchStatus>, status: MatchStatus) {
  return [...statuses.entries()]
    .filter(([, value]) => value === status)
    .map(([midi]) => midi)
    .sort((a, b) => a - b);
}

const KeyboardLane = memo(function KeyboardLane({
  label,
  active,
  statuses,
  role,
  start,
  end,
  playing,
}: {
  label: string;
  active: number[];
  statuses: Map<number, MatchStatus>;
  role: "expected" | "performed";
  start: number;
  end: number;
  playing: boolean;
}) {
  const activeSet = useMemo(() => new Set(active), [active]);
  const keys = useMemo(() => Array.from({ length: end - start + 1 }, (_, i) => start + i), [start, end]);
  const whites = useMemo(() => keys.filter(isWhite), [keys]);
  const blackKeys = useMemo(() => keys.filter((midi) => !isWhite(midi)).map((midi) => {
    let nextWhiteIdx = whites.findIndex((w) => w > midi);
    if (nextWhiteIdx < 0) nextWhiteIdx = whites.length - 1;
    return {
      midi,
      left: Math.max(0, nextWhiteIdx - 1) * 30 + 21,
    };
  }), [keys, whites]);
  const activeLabel = useMemo(() => noteSummary(active), [active]);

  const whiteW = 30;
  const blackW = 20;
  const laneH = 92;
  const colorTransition = playing ? "" : "transition-colors duration-100";
  const keyClass = (midi: number, white: boolean) => {
    const on = activeSet.has(midi);
    const status = statuses.get(midi);
    if (!on && white) return "bg-zinc-100";
    if (!on) return "bg-zinc-950";
    if (role === "expected") return status === "correct" ? "bg-cyan-200" : "bg-rose-200";
    return status === "correct" ? "bg-emerald-300" : "bg-amber-300";
  };

  return (
    <div className="grid gap-3 md:grid-cols-[112px_minmax(0,1fr)]">
      <div className="flex h-[92px] min-h-[92px] flex-col justify-center overflow-hidden rounded-xl2 border border-white/10 bg-black/20 p-3">
        <div className="text-xs text-[rgb(var(--muted))]">{label}</div>
        <div className="mt-1 min-h-[24px] truncate text-sm font-semibold" title={activeLabel}>
          {activeLabel}
        </div>
      </div>
      <div className="h-[92px] min-h-[92px] overflow-x-auto overflow-y-hidden rounded-xl2 border border-white/10 bg-black/20">
        <div className="relative" style={{ height: laneH, width: whites.length * whiteW }}>
          <div className="absolute inset-0 flex">
            {whites.map((midi) => (
              <div
                key={midi}
                className={`relative h-full border-r border-black/30 ${colorTransition} ${keyClass(midi, true)}`}
                style={{ width: whiteW }}
              >
                <div className="absolute bottom-1 left-1 text-[9px] text-zinc-600">{midiName(midi)}</div>
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-0">
            {blackKeys.map(({ midi, left }) => {
              return (
                <div
                  key={midi}
                  className={`absolute top-0 h-14 rounded-b-md shadow-soft ${colorTransition} ${keyClass(midi, false)}`}
                  style={{ left, width: blackW }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => (
  prev.label === next.label &&
  prev.role === next.role &&
  prev.start === next.start &&
  prev.end === next.end &&
  prev.playing === next.playing &&
  prev.active === next.active &&
  prev.statuses === next.statuses
));

export function NoteComparisonVisualizer({
  expected,
  performed,
  livePressed = [],
  live = false,
  running = false,
  title = "Визуальное сравнение",
  subtitle,
  showPerformedLane = true,
  matches = EMPTY_MATCHES,
  expectedOffsetS = 0,
  sequenceMode = false,
}: {
  expected: NoteEvent[];
  performed: NoteEvent[];
  livePressed?: number[];
  live?: boolean;
  running?: boolean;
  title?: string;
  subtitle?: string;
  showPerformedLane?: boolean;
  matches?: MatchRow[];
  expectedOffsetS?: number;
  sequenceMode?: boolean;
}) {
  const sequenceDisplay = useMemo(() => (
    sequenceMode && matches.length ? buildSequenceDisplay(matches) : null
  ), [matches, sequenceMode]);
  const visualExpected = sequenceDisplay?.expected ?? expected;
  const displayPerformed = useMemo(() => (
    sequenceDisplay?.performed ?? normalizePerformed(expected, performed)
  ), [expected, performed, sequenceDisplay]);
  const duration = useMemo(() => {
    const ends = [...visualExpected, ...displayPerformed].map((n) => n.offset_s);
    return Math.max(1, ends.length ? Math.max(...ends) : 1);
  }, [visualExpected, displayPerformed]);
  const [play, setPlay] = useState(false);
  const [time, setTime] = useState(0);
  const [playbackTrack, setPlaybackTrack] = useState<PlaybackTrack>("expected");
  const rafRef = useRef<number | null>(null);
  const playbackRef = useRef<MidiPlaybackController | null>(null);
  const playbackSeqRef = useRef(0);

  const allNotes = useMemo(() => [...visualExpected, ...displayPerformed].map((n) => n.midi_note), [visualExpected, displayPerformed]);
  const range = useMemo(() => {
    const min = allNotes.length ? Math.min(...allNotes, 48) : 48;
    const max = allNotes.length ? Math.max(...allNotes, 84) : 84;
    return { start: min < 48 || max > 84 ? 21 : 48, end: min < 48 || max > 84 ? 108 : 84 };
  }, [allNotes]);

  const stopPlaybackAudio = useCallback(() => {
    playbackSeqRef.current += 1;
    playbackRef.current?.stop();
    playbackRef.current = null;
  }, []);

  const pausePlayback = useCallback(() => {
    stopPlaybackAudio();
    setPlay(false);
  }, [stopPlaybackAudio]);

  const startPlaybackAt = useCallback(async (position: number, trackOverride = playbackTrack) => {
    const safePosition = clamp(position, 0, duration);
    playbackSeqRef.current += 1;
    const seq = playbackSeqRef.current;
    playbackRef.current?.stop();
    playbackRef.current = null;
    setTime(safePosition);

    try {
      const controller = await startMidiPlayback({
        expected: visualExpected,
        performed: displayPerformed,
        track: trackOverride,
        startAt: safePosition,
        duration,
      });
      if (seq !== playbackSeqRef.current) {
        controller.stop();
        return;
      }
      playbackRef.current = controller;
      setPlay(true);
    } catch {
      if (seq === playbackSeqRef.current) setPlay(false);
    }
  }, [displayPerformed, duration, playbackTrack, visualExpected]);

  const togglePlayback = useCallback(() => {
    if (play) {
      pausePlayback();
      return;
    }
    const start = time >= duration ? 0 : time;
    void startPlaybackAt(start);
  }, [duration, pausePlayback, play, startPlaybackAt, time]);

  const resetPlayback = useCallback(() => {
    pausePlayback();
    setTime(0);
  }, [pausePlayback]);

  const seekPlayback = useCallback((position: number) => {
    const next = clamp(position, 0, duration);
    if (play) {
      void startPlaybackAt(next);
      return;
    }
    setTime(next);
  }, [duration, play, startPlaybackAt]);

  const changePlaybackTrack = useCallback((track: PlaybackTrack) => {
    setPlaybackTrack(track);
    if (play) void startPlaybackAt(time, track);
  }, [play, startPlaybackAt, time]);

  useEffect(() => () => stopPlaybackAudio(), [stopPlaybackAudio]);

  useEffect(() => {
    if (live) pausePlayback();
  }, [live, pausePlayback]);

  useEffect(() => {
    setTime((t) => clamp(t, 0, duration));
  }, [duration]);

  useEffect(() => {
    const shouldRun = live ? running : play;
    if (!shouldRun) return;
    let last = performance.now();
    let pendingSeconds = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      pendingSeconds += dt;
      if (pendingSeconds < 1 / 20) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const step = pendingSeconds;
      pendingSeconds = 0;
      setTime((t) => {
        const next = t + step;
        if (next > duration) {
          if (!live) pausePlayback();
          return duration;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [duration, live, pausePlayback, play, running]);

  useEffect(() => {
    if (live && running) setTime(0);
  }, [live, running]);

  const expectedActive = useStableActiveNotes(visualExpected, time);
  const playbackPerformedActive = useStableActiveNotes(displayPerformed, time);
  const performedActive = live ? livePressed : playbackPerformedActive;
  const expectedSet = useMemo(() => new Set(expectedActive), [expectedActive]);
  const expectedSelfSet = useMemo(() => new Set(expectedActive), [expectedActive]);
  const performedSet = useMemo(() => new Set(performedActive), [performedActive]);
  const hasMatchData = !live && matches.length > 0;
  const matchIndexes = useMemo(
    () => sequenceDisplay
      ? { expectedStatuses: sequenceDisplay.expectedStatuses, performedStatuses: sequenceDisplay.performedStatuses }
      : buildMatchIndexes(visualExpected, displayPerformed, matches, expectedOffsetS),
    [displayPerformed, expectedOffsetS, matches, sequenceDisplay, visualExpected],
  );
  const expectedMatchedStatuses = useStableMatchStatuses(visualExpected, time, matchIndexes.expectedStatuses, "missed");
  const performedMatchedStatuses = useStableMatchStatuses(displayPerformed, time, matchIndexes.performedStatuses, "extra");
  const expectedComparisonStatuses = useStableComparisonStatuses(expectedActive, showPerformedLane ? performedSet : expectedSelfSet, "correct", "missed");
  const performedComparisonStatuses = useStableComparisonStatuses(performedActive, expectedSet, "correct", "extra");
  const expectedStatuses = hasMatchData ? expectedMatchedStatuses : expectedComparisonStatuses;
  const performedStatuses = hasMatchData ? performedMatchedStatuses : performedComparisonStatuses;
  const missed = useMemo(() => notesWithStatus(expectedStatuses, "missed"), [expectedStatuses]);
  const extra = useMemo(() => notesWithStatus(performedStatuses, "extra"), [performedStatuses]);
  const correct = useMemo(() => {
    const values = new Set<number>([
      ...notesWithStatus(expectedStatuses, "correct"),
      ...notesWithStatus(performedStatuses, "correct"),
    ]);
    return [...values].sort((a, b) => a - b);
  }, [expectedStatuses, performedStatuses]);
  const playingVisuals = !live && play;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
          <div className="mt-1 text-xs text-[rgb(var(--muted))]">
            {subtitle ?? "Верхняя клавиатура показывает эталон, нижняя — исполнение или живой ввод с микрофона"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!live && showPerformedLane ? (
            <Segmented<PlaybackTrack>
              value={playbackTrack}
              onChange={changePlaybackTrack}
              options={[
                { label: "Эталон", value: "expected" },
                { label: "Исполнение", value: "performed" },
                { label: "Оба", value: "both" },
              ]}
            />
          ) : null}
          <Pill>{time.toFixed(2)} с</Pill>
          {!live ? (
            <>
              <Button variant="outline" onClick={togglePlayback}>
                {play ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {play ? "Пауза" : "Воспроизвести"}
              </Button>
              <Button variant="outline" onClick={resetPlayback}>
                <RotateCcw className="h-4 w-4" />
                Сброс
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <input
          type="range"
          min={0}
          max={duration}
          step={0.02}
          value={Math.min(time, duration)}
          onChange={(e) => seekPlayback(Number(e.target.value))}
          className="w-full"
          disabled={live && running}
        />
      </div>

      <div className="mt-4 space-y-3">
        <KeyboardLane label="Эталон" active={expectedActive} statuses={expectedStatuses} role="expected" start={range.start} end={range.end} playing={playingVisuals} />
        {showPerformedLane ? (
          <KeyboardLane label="Исполнение" active={performedActive} statuses={performedStatuses} role="performed" start={range.start} end={range.end} playing={playingVisuals} />
        ) : null}
      </div>

      {showPerformedLane ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl2 border border-emerald-400/20 bg-emerald-400/10 p-3">
            <div className="text-xs text-emerald-100/80">Совпало</div>
            <div className="mt-1 text-sm font-semibold text-emerald-100">{noteSummary(correct)}</div>
          </div>
          <div className="rounded-xl2 border border-rose-400/20 bg-rose-400/10 p-3">
            <div className="text-xs text-rose-100/80">Пропущено</div>
            <div className="mt-1 text-sm font-semibold text-rose-100">{noteSummary(missed)}</div>
          </div>
          <div className="rounded-xl2 border border-amber-300/20 bg-amber-300/10 p-3">
            <div className="text-xs text-amber-100/80">Лишнее</div>
            <div className="mt-1 text-sm font-semibold text-amber-100">{noteSummary(extra)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
