"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Upload, Trash2, CheckCircle2, ArrowRight } from "lucide-react";

import { api } from "@/lib/api";
import type { Exercise, NoteEvent } from "@/lib/types";
import { fetchAndParseMidi, parseMidiFile } from "@/lib/midi";

import { MidiConnect } from "@/components/midi-connect";
import { ComputerKeyboardMidi } from "@/components/computer-keyboard-midi";
import { PianoKeyboard } from "@/components/piano-keyboard";
import { Card, CardBody, CardHeader, Button, HelpTip, Pill } from "@/components/ui";

import { PianoRoll } from "@/components/piano-roll";
import { ErrorHeatmap } from "@/components/error-heatmap";
import { ErrorList } from "@/components/error-list";

function KPI({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-[rgb(var(--muted))]">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-[rgb(var(--muted))]">{sub}</div> : null}
    </div>
  );
}

export default function LabPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selected, setSelected] = useState<string>("");

  const [expected, setExpected] = useState<NoteEvent[]>([]);
  const [expectedSource, setExpectedSource] = useState<"exercise" | "upload">("exercise");

  const [performedMIDI, setPerformedMIDI] = useState<NoteEvent[]>([]);
  const [pressed, setPressed] = useState<number[]>([]);
  const activeRef = useRef<Map<number, { onset_s: number; velocity: number }>>(new Map());

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioNotes, setAudioNotes] = useState<NoteEvent[]>([]);

  const [status, setStatus] = useState<string>("Готово");
  const [summary, setSummary] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  useEffect(() => {
    api.exercises()
      .then((xs) => {
        setExercises(xs);
        if (xs.length) setSelected(xs[0].id);
      })
      .catch(() => setExercises([]));
  }, []);

  useEffect(() => {
    if (expectedSource !== "exercise") return;
    const ex = exercises.find((e) => e.id === selected);
    if (!ex) return;

    setStatus("Загружаем эталонный MIDI из упражнения…");
    fetchAndParseMidi(ex.midi_url)
      .then((ev) => {
        setExpected(ev);
        setStatus(`Эталон загружен: ${ev.length} нот`);
      })
      .catch(() => {
        setExpected([]);
        setStatus("Не удалось загрузить эталонный MIDI");
      });
  }, [expectedSource, exercises, selected]);

  const onMidi = (evt: NoteEvent, isOn: boolean) => {
    const note = evt.midi_note;
    const t = evt.onset_s;

    if (isOn) {
      activeRef.current.set(note, { onset_s: t, velocity: evt.velocity });
      setPressed((p) => Array.from(new Set([...p, note])));
    } else {
      const st = activeRef.current.get(note);
      if (st) {
        activeRef.current.delete(note);
        const fin: NoteEvent = { onset_s: st.onset_s, offset_s: t, midi_note: note, velocity: st.velocity };
        setPerformedMIDI((arr) => [...arr, fin]);
      }
      setPressed((p) => p.filter((x) => x !== note));
    }
  };

  const reset = () => {
    setPerformedMIDI([]);
    setPressed([]);
    activeRef.current.clear();
    setAudioFile(null);
    setAudioNotes([]);
    setSummary(null);
    setMatches([]);
    setLastSessionId(null);
    setStatus("Готово");
  };

  const resetMidiTake = () => {
    setPerformedMIDI([]);
    setPressed([]);
    activeRef.current.clear();
    setSummary(null);
    setMatches([]);
    setLastSessionId(null);
    setStatus("MIDI-попытка очищена");
  };

  const transcribeAudio = async () => {
    if (!audioFile) return;
    setStatus("Загружаем и распознаем аудио…");
    try {
      const notes = await api.transcribe(audioFile);
      setAudioNotes(notes);
      setStatus(`Распознано: ${notes.length} нот`);
    } catch {
      setStatus("Не удалось распознать. Проверьте сервер и ffmpeg");
    }
  };

  const evaluate = async (source: "midi" | "mic") => {
    const perf = source === "midi" ? performedMIDI : audioNotes;
    if (!expected.length) return setStatus("Эталонный MIDI пуст");
    if (!perf.length) return setStatus("Нет нот исполнения для оценки");

    setStatus("Считаем оценку: эвристический корректор и безопасное выравнивание…");
    try {
      const res = await api.createSession({
        user_id: "demo",
        exercise_id: selected || "lab",
        source,
        expected,
        performed: perf,
        onset_tol_s: 0.12,
        assistant: "on",
        aligner: "safe_linear_dtw",
      } as any);

      setLastSessionId(res.session_id);
      setSummary(res.summary);

      const det = await api.sessionDetails(res.session_id);
      setMatches(det?.events?.matches ?? []);
      setStatus("Готово");
    } catch {
      setStatus("Не удалось оценить");
    }
  };

  const perfForRoll = useMemo(() => (performedMIDI.length ? performedMIDI : audioNotes), [performedMIDI, audioNotes]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Лаборатория — сравнение с эталоном"
          subtitle="Эталонный MIDI → MIDI или аудио → оценка с корректором и выравниванием → отчет."
          right={<Pill>{status}</Pill>}
          help="Лаборатория нужна для ручного эксперимента: выберите эталон, загрузите или сыграйте исполнение, затем запустите оценку и откройте полный отчет."
        />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                Эталон
                <HelpTip text="Эталон — это MIDI, с которым сравнивается исполнение. Можно взять упражнение из библиотеки или загрузить свой MIDI-файл." />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={expectedSource}
                  onChange={(e) => setExpectedSource(e.target.value as any)}
                  className="rounded-xl2 border border-white/10 bg-black/20 px-3 py-2 text-sm"
                >
                  <option value="exercise">Из упражнения</option>
                  <option value="upload">Загрузить MIDI</option>
                </select>

                {expectedSource === "exercise" ? (
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    className="rounded-xl2 border border-white/10 bg-black/20 px-3 py-2 text-sm"
                  >
                    {exercises.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl2 border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                    <Upload className="h-4 w-4" /> Загрузить .mid
                    <input
                      type="file"
                      accept=".mid,.midi"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setStatus("Читаем MIDI…");
                        const ev = await parseMidiFile(f);
                        setExpected(ev);
                        setStatus(`Эталон загружен: ${ev.length} нот`);
                      }}
                    />
                  </label>
                )}

                <Pill>Эталон: {expected.length}</Pill>
              </div>
            </div>

            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                Действия
                <HelpTip text="Сброс очищает текущий эксперимент. Полный отчет появляется после оценки и ведет в подробный отчет по сессии." />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" onClick={reset}>
                  <Trash2 className="mr-2 inline h-4 w-4" /> Сброс
                </Button>
                {lastSessionId ? (
                  <Link href={`/session/${lastSessionId}`}>
                    <Button variant="outline">
                      Открыть полный отчет <ArrowRight className="ml-2 inline h-4 w-4" />
                    </Button>
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="MIDI-исполнение"
            subtitle="Сыграйте на устройстве → оцените MIDI"
            right={<Pill>{performedMIDI.length} нот</Pill>}
            help="Этот блок принимает MIDI-клавиатуру или компьютерную клавиатуру. Ноты попадают в попытку после отпускания клавиши."
          />
          <CardBody>
            <MidiConnect onNote={onMidi} />
            <div className="mt-4">
              <ComputerKeyboardMidi onNote={onMidi} />
            </div>
            <div className="mt-4">
              <PianoKeyboard pressed={pressed} range="compact" />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button onClick={() => evaluate("midi")} disabled={!expected.length || !performedMIDI.length}>
                <CheckCircle2 className="mr-2 inline h-4 w-4" /> Оценить MIDI
              </Button>
              <Button variant="outline" onClick={resetMidiTake}>
                <Trash2 className="mr-2 inline h-4 w-4" /> Новая попытка
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Аудиоисполнение"
            subtitle="Загрузите → распознайте → оцените аудио"
            right={<Pill>{audioNotes.length} нот</Pill>}
            help="Загрузите WAV/MP3/WebM, нажмите «Распознать», затем «Оценить аудио». Сервер превратит аудио в ноты и сравнит их с эталоном."
          />
          <CardBody>
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Upload className="h-4 w-4" />
                  {audioFile ? audioFile.name : "Выбрать mp3/wav/webm"}
                </div>
                <input type="file" accept="audio/*" className="hidden" onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)} />
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={transcribeAudio} disabled={!audioFile}>Распознать</Button>
                <Button variant="outline" onClick={() => { setAudioFile(null); setAudioNotes([]); }}>Сбросить аудио</Button>
                <Button onClick={() => evaluate("mic")} disabled={!expected.length || !audioNotes.length}>
                  <CheckCircle2 className="mr-2 inline h-4 w-4" /> Оценить аудио
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {summary ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Оценка"
              subtitle="Сравнение с эталонным MIDI"
              help="Оценка показывает итоговые метрики: F1, тайминг, пропущенные и лишние ноты. Это быстрый численный итог попытки."
            />
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-3">
                <KPI title="F1" value={summary.f1?.toFixed(3)} sub="Высота + атака" />
                <KPI title="Средняя ошибка тайминга" value={summary.mae_s ? `${(summary.mae_s*1000).toFixed(1)} мс` : "—"} sub="Средняя абсолютная ошибка" />
                <KPI title="Тайминг p95" value={summary.p95_s ? `${(summary.p95_s*1000).toFixed(1)} мс` : "—"} sub="95-й перцентиль" />
                <KPI title="F1 аккордов" value={(summary.chord_f1 ?? 0).toFixed(3)} sub={`точн. ${(summary.chord_precision ?? 0).toFixed(2)} · полн. ${(summary.chord_recall ?? 0).toFixed(2)}`} />
                <KPI title="Пропущено" value={`${summary.missed}`} sub="Ноты эталона не сыграны" />
                <KPI title="Лишних" value={`${summary.extra}`} sub="Сыграно вне эталона" />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Пиано-ролл"
              subtitle="Эталон окрашен по совпадениям, исполнение показано серым."
              help="Пиано-ролл показывает, где ноты эталона и исполнения расположены во времени. Цвет помогает быстро найти совпадения и ошибки."
            />
            <CardBody><PianoRoll expected={expected} performed={perfForRoll} matches={matches as any} /></CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Тепловая карта" subtitle="Где ошибки группируются во времени." help="Тепловая карта показывает зоны, где ошибки повторяются чаще всего: по времени и высоте нот." />
              <CardBody><ErrorHeatmap matches={matches as any} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Ошибки" subtitle="Пропущенные и лишние ноты." help="Список ошибок показывает конкретные пропущенные и лишние ноты, чтобы понять, что исправлять в следующей попытке." />
              <CardBody><ErrorList matches={matches as any} /></CardBody>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
