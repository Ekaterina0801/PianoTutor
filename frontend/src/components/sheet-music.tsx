"use client";

import type { NoteEvent } from "@/lib/types";
import { Card, CardBody, CardHeader, HelpTip, Pill } from "@/components/ui";

const STEP_BY_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const NAME_BY_PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const LETTER_BY_PC = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

type StaffName = "treble" | "bass";

type DrawableNote = NoteEvent & {
  beat: number;
  durationBeats: number;
  measure: number;
  staff: StaffName;
  y: number;
  x: number;
  durationX: number;
  chordOffsetX: number;
  name: string;
  letter: string;
  accidental: boolean;
};

type Layout = {
  width: number;
  height: number;
  systems: number;
  measures: number;
  notes: DrawableNote[];
};

const STAFF_GAP = 10;
const HALF_STEP = STAFF_GAP / 2;
const MEASURE_BEATS = 4;
const MEASURES_PER_SYSTEM = 4;
const MEASURE_W = 190;
const LEFT_PAD = 92;
const RIGHT_PAD = 24;
const SYSTEM_H = 174;
const TOP_PAD = 34;
const TREBLE_BOTTOM_STEP = 4 * 7 + 2; // E4, нижняя линия скрипичного стана.
const BASS_BOTTOM_STEP = 2 * 7 + 4; // G2, нижняя линия басового стана.

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midiName(midi: number) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NAME_BY_PC[pc]}${octave}`;
}

function diatonicStep(midi: number) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return octave * 7 + STEP_BY_PC[pc];
}

function staffFor(midi: number): StaffName {
  return midi >= 60 ? "treble" : "bass";
}

function staffTops(systemIndex: number) {
  const base = TOP_PAD + systemIndex * SYSTEM_H;
  return { trebleTop: base + 10, bassTop: base + 88 };
}

function staffY(midi: number, staff: StaffName, systemIndex: number) {
  const { trebleTop, bassTop } = staffTops(systemIndex);
  const bottomLineY = (staff === "treble" ? trebleTop : bassTop) + STAFF_GAP * 4;
  const bottomStep = staff === "treble" ? TREBLE_BOTTOM_STEP : BASS_BOTTOM_STEP;
  return bottomLineY - (diatonicStep(midi) - bottomStep) * HALF_STEP;
}

function buildLayout(notes: NoteEvent[], tempoBpm?: number | null): Layout {
  const bpm = tempoBpm && tempoBpm > 0 ? tempoBpm : 120;
  const beatsPerSecond = bpm / 60;
  const clean = notes
    .filter((note) => Number.isFinite(note.onset_s) && Number.isFinite(note.offset_s) && Number.isFinite(note.midi_note))
    .sort((a, b) => (a.onset_s - b.onset_s) || (a.midi_note - b.midi_note))
    .slice(0, 180);

  const lastBeat = clean.reduce((acc, note) => Math.max(acc, note.offset_s * beatsPerSecond), 0);
  const measures = Math.max(1, Math.ceil(lastBeat / MEASURE_BEATS));
  const systems = Math.max(1, Math.ceil(measures / MEASURES_PER_SYSTEM));
  const width = LEFT_PAD + MEASURE_W * MEASURES_PER_SYSTEM + RIGHT_PAD;
  const height = TOP_PAD + systems * SYSTEM_H + 10;

  const drawable = clean.map((note) => {
    const beat = Math.max(0, note.onset_s * beatsPerSecond);
    const durationBeats = clamp((note.offset_s - note.onset_s) * beatsPerSecond, 0.25, 8);
    const measure = Math.floor(beat / MEASURE_BEATS);
    const systemIndex = Math.floor(measure / MEASURES_PER_SYSTEM);
    const measureInSystem = measure % MEASURES_PER_SYSTEM;
    const beatInMeasure = beat - measure * MEASURE_BEATS;
    const x = LEFT_PAD + measureInSystem * MEASURE_W + 34 + (beatInMeasure / MEASURE_BEATS) * (MEASURE_W - 46);
    const durationX = Math.min(MEASURE_W - 52, Math.max(18, (durationBeats / MEASURE_BEATS) * (MEASURE_W - 46)));
    const staff = staffFor(note.midi_note);
    const pc = ((note.midi_note % 12) + 12) % 12;
    return {
      ...note,
      beat,
      durationBeats,
      measure,
      staff,
      y: staffY(note.midi_note, staff, systemIndex),
      x,
      durationX,
      chordOffsetX: 0,
      name: midiName(note.midi_note),
      letter: LETTER_BY_PC[pc],
      accidental: BLACK_KEYS.has(pc),
    };
  });

  const byChord = new Map<string, DrawableNote[]>();
  for (const note of drawable) {
    const onsetBucket = Math.round(note.beat * 8) / 8;
    const key = `${note.measure}:${note.staff}:${onsetBucket}`;
    const group = byChord.get(key) ?? [];
    group.push(note);
    byChord.set(key, group);
  }
  for (const group of byChord.values()) {
    group.sort((a, b) => a.y - b.y);
    for (let i = 1; i < group.length; i += 1) {
      const prev = group[i - 1];
      const cur = group[i];
      if (Math.abs(cur.y - prev.y) <= HALF_STEP + 0.5) {
        cur.chordOffsetX = 12;
      }
    }
  }

  return { width, height, systems, measures, notes: drawable };
}

function ledgerLines(note: DrawableNote, top: number) {
  const bottom = top + STAFF_GAP * 4;
  const lines: number[] = [];
  if (note.y < top - HALF_STEP) {
    for (let y = top - STAFF_GAP; y >= note.y - 1; y -= STAFF_GAP) lines.push(y);
  }
  if (note.y > bottom + HALF_STEP) {
    for (let y = bottom + STAFF_GAP; y <= note.y + 1; y += STAFF_GAP) lines.push(y);
  }
  return lines;
}

function NoteGlyph({ note }: { note: DrawableNote }) {
  const filled = note.durationBeats < 2;
  const stemUp = note.staff === "bass" ? note.y >= staffTops(Math.floor(note.measure / MEASURES_PER_SYSTEM)).bassTop + 18 : note.y >= staffTops(Math.floor(note.measure / MEASURES_PER_SYSTEM)).trebleTop + 18;
  const noteX = note.x + note.chordOffsetX;
  const stemX = stemUp ? noteX + 7 : noteX - 7;
  const stemY2 = note.y + (stemUp ? -38 : 38);
  return (
    <g>
      {note.durationBeats > 0.75 ? (
        <line
          x1={noteX + 12}
          x2={noteX + note.durationX}
          y1={note.y}
          y2={note.y}
          className="stroke-cyan-300/25"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ) : null}
      {note.accidental ? (
        <text x={noteX - 22} y={note.y + 5} className="fill-zinc-200 text-[16px] font-semibold">♯</text>
      ) : null}
      <ellipse
        cx={noteX}
        cy={note.y}
        rx={8.6}
        ry={5.8}
        transform={`rotate(-18 ${noteX} ${note.y})`}
        className={filled ? "fill-zinc-50 stroke-zinc-50" : "fill-zinc-950 stroke-zinc-50"}
        strokeWidth={2}
      />
      <line x1={stemX} y1={note.y} x2={stemX} y2={stemY2} className="stroke-zinc-50" strokeWidth={1.8} />
      {note.durationBeats <= 0.65 ? (
        <path
          d={stemUp ? `M ${stemX} ${stemY2} c 18 8 18 18 2 24` : `M ${stemX} ${stemY2} c 18 -8 18 -18 2 -24`}
          className="fill-none stroke-zinc-50"
          strokeWidth={1.7}
        />
      ) : null}
      <title>{`${note.name} · ${note.beat.toFixed(2)} доли`}</title>
    </g>
  );
}

function StaffSystem({ systemIndex, layout }: { systemIndex: number; layout: Layout }) {
  const { trebleTop, bassTop } = staffTops(systemIndex);
  const x0 = LEFT_PAD;
  const x1 = LEFT_PAD + MEASURE_W * MEASURES_PER_SYSTEM;
  const visibleMeasures = Math.min(MEASURES_PER_SYSTEM, Math.max(0, layout.measures - systemIndex * MEASURES_PER_SYSTEM));
  const systemNotes = layout.notes.filter((note) => Math.floor(note.measure / MEASURES_PER_SYSTEM) === systemIndex);
  const occupiedMeasures = new Set(systemNotes.map((note) => note.measure));

  return (
    <g>
      {[trebleTop, bassTop].map((top) => (
        <g key={top}>
          {Array.from({ length: 5 }, (_, i) => (
            <line key={i} x1={x0} x2={x1} y1={top + i * STAFF_GAP} y2={top + i * STAFF_GAP} className="stroke-zinc-300/80" strokeWidth={1.1} />
          ))}
        </g>
      ))}

      <text x={24} y={trebleTop + 39} className="fill-zinc-100 text-[54px]">𝄞</text>
      <text x={30} y={bassTop + 36} className="fill-zinc-100 text-[46px]">𝄢</text>
      <line x1={LEFT_PAD - 12} x2={LEFT_PAD - 12} y1={trebleTop} y2={bassTop + STAFF_GAP * 4} className="stroke-zinc-300/70" strokeWidth={2} />
      <path d={`M ${LEFT_PAD - 18} ${trebleTop} c -18 26 -18 78 0 118`} className="fill-none stroke-zinc-300/70" strokeWidth={1.8} />

      {Array.from({ length: visibleMeasures + 1 }, (_, i) => {
        const x = LEFT_PAD + i * MEASURE_W;
        return (
          <line
            key={i}
            x1={x}
            x2={x}
            y1={trebleTop}
            y2={bassTop + STAFF_GAP * 4}
            className={i === 0 || i === visibleMeasures ? "stroke-zinc-200/70" : "stroke-zinc-400/40"}
            strokeWidth={i === visibleMeasures ? 2 : 1}
          />
        );
      })}

      {Array.from({ length: visibleMeasures }, (_, i) => {
        const measure = systemIndex * MEASURES_PER_SYSTEM + i;
        const x = LEFT_PAD + i * MEASURE_W;
        return (
          <g key={`beats-${i}`}>
            {[1, 2, 3].map((beat) => (
              <line
                key={beat}
                x1={x + (beat / MEASURE_BEATS) * MEASURE_W}
                x2={x + (beat / MEASURE_BEATS) * MEASURE_W}
                y1={trebleTop}
                y2={bassTop + STAFF_GAP * 4}
                className="stroke-white/10"
                strokeDasharray="3 8"
              />
            ))}
            {!occupiedMeasures.has(measure) ? (
              <>
                <rect x={x + MEASURE_W * 0.45} y={trebleTop + STAFF_GAP * 1.5} width={20} height={4} rx={2} className="fill-zinc-300/70" />
                <rect x={x + MEASURE_W * 0.45} y={bassTop + STAFF_GAP * 1.5} width={20} height={4} rx={2} className="fill-zinc-300/70" />
              </>
            ) : null}
          </g>
        );
      })}

      {Array.from({ length: visibleMeasures }, (_, i) => {
        const measureNumber = systemIndex * MEASURES_PER_SYSTEM + i + 1;
        return (
          <text key={i} x={LEFT_PAD + i * MEASURE_W + 10} y={trebleTop - 10} className="fill-zinc-500 text-[10px]">
            {measureNumber}
          </text>
        );
      })}

      {systemNotes.map((note, index) => {
        const top = note.staff === "treble" ? trebleTop : bassTop;
        const noteX = note.x + note.chordOffsetX;
        return (
          <g key={`${note.onset_s}-${note.midi_note}-${index}`}>
            {ledgerLines(note, top).map((y) => (
              <line key={y} x1={noteX - 13} x2={noteX + 13} y1={y} y2={y} className="stroke-zinc-300/80" strokeWidth={1.1} />
            ))}
            <NoteGlyph note={note} />
          </g>
        );
      })}
    </g>
  );
}

export function SheetMusicPanel({
  notes,
  title = "Нотный стан",
  subtitle = "Ноты извлекаются из MIDI-эталона упражнения.",
  tempoBpm,
}: {
  notes: NoteEvent[];
  title?: string;
  subtitle?: string;
  tempoBpm?: number | null;
}) {
  const layout = buildLayout(notes, tempoBpm);
  const shownNotes = layout.notes.length;
  const hiddenNotes = Math.max(0, notes.length - shownNotes);

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        right={<Pill>{layout.measures} такт. · {shownNotes} нот</Pill>}
        help="Нотный стан строится из MIDI: время нот переводится в доли по темпу упражнения, ноты выше C4 попадают в скрипичный ключ, остальные — в басовый. Это учебная визуализация эталона, чтобы видеть не только клавиши, но и запись на стане."
      />
      <CardBody>
        {!notes.length ? (
          <div className="rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-[rgb(var(--muted))]">
            Эталонный MIDI еще не загружен, поэтому нотный стан пока пуст
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted))]">
              <Pill>4/4</Pill>
              <Pill>{tempoBpm ? `${tempoBpm} уд/мин` : "темп 120 уд/мин"}</Pill>
              <span>Доли такта, длительности и пустые такты теперь видны прямо на стане</span>
              <HelpTip text="Если в MIDI есть очень длинные партии, панель показывает первые 180 нот, чтобы интерфейс оставался быстрым. Полный временной вид остается в пиано-ролле" />
            </div>
            <div className="overflow-x-auto rounded-3xl border border-white/10 bg-zinc-950/80 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                width={layout.width}
                height={layout.height}
                className="min-w-[920px]"
                role="img"
                aria-label="Нотный стан, построенный из MIDI-эталона"
              >
                <rect x={0} y={0} width={layout.width} height={layout.height} rx={22} className="fill-zinc-950" />
                {Array.from({ length: layout.systems }, (_, i) => <StaffSystem key={i} systemIndex={i} layout={layout} />)}
              </svg>
            </div>
            {hiddenNotes ? (
              <div className="text-xs text-[rgb(var(--muted))]">
                Показаны первые {shownNotes} нот из {notes.length}; полный эталон доступен в пиано-ролле
              </div>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
