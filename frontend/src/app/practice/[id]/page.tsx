"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { AssistantMode, Exercise, NoteEvent } from "@/lib/types";
import { fetchAndParseMidi } from "@/lib/midi";
import { MidiConnect } from "@/components/midi-connect";
import { ComputerKeyboardMidi } from "@/components/computer-keyboard-midi";
import { PianoEmulator } from "@/components/piano-emulator";
import { MicRecorder } from "@/components/mic-recorder";
import { MicLive } from "@/components/mic-live";
import { PianoRoll } from "@/components/piano-roll";
import { NoteComparisonVisualizer } from "@/components/note-comparison-visualizer";
import { SheetMusicPanel } from "@/components/sheet-music";
import { Card, CardBody, CardHeader, Button, HelpTip, Pill } from "@/components/ui";
import { useAuth } from "@/components/auth";
import { alignerLabelRu, assistantLabelRu, decisionLabelRu } from "@/lib/labels";

type PracticeMode = "learning" | "compare";
type InputMode = "emulator" | "midi" | "mic" | "mic_live";
type CorrectorComparisonRow = {
  mode: AssistantMode;
  summary: any;
  pipeline: any;
};

const CORRECTOR_OPTIONS: AssistantMode[] = ["heuristic", "tcn", "bilstm", "transformer", "off"];
const COMPARISON_CORRECTORS: AssistantMode[] = ["off", "heuristic", "tcn", "bilstm", "transformer"];

function ScoreTile({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-[rgb(var(--muted))]">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-[rgb(var(--muted))]">{sub}</div> : null}
    </div>
  );
}

function scoreLabel(f1: number) {
  if (f1 >= 0.95) return "Отлично";
  if (f1 >= 0.85) return "Хорошо";
  if (f1 >= 0.7) return "Неплохо";
  return "Нужно потренировать";
}

function formatMs(value: unknown) {
  return typeof value === "number" ? `${(value * 1000).toFixed(0)} мс` : "—";
}

function assistantLabel(mode: AssistantMode) {
  return assistantLabelRu(mode);
}

function fmtScore(value: unknown, decimals = 3) {
  return typeof value === "number" ? value.toFixed(decimals) : "—";
}

function fmtPct(value: unknown) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—";
}

function fmtThresholds(thresholds: any) {
  if (!thresholds || typeof thresholds.onset_thr !== "number" || typeof thresholds.frame_thr !== "number") return "—";
  return `${thresholds.onset_thr.toFixed(2)} / ${thresholds.frame_thr.toFixed(2)}`;
}

function notesSignature(notes: NoteEvent[]) {
  return notes
    .map((note) => `${note.midi_note}:${note.onset_s.toFixed(3)}:${note.offset_s.toFixed(3)}:${note.velocity}`)
    .join("|");
}

export default function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [mode, setMode] = useState<PracticeMode>("learning");
  const [inputMode, setInputMode] = useState<InputMode>("emulator");
  const [pressed, setPressed] = useState<number[]>([]);
  const [performed, setPerformed] = useState<NoteEvent[]>([]);
  const [performedSource, setPerformedSource] = useState<"midi" | "mic">("midi");
  const [expected, setExpected] = useState<NoteEvent[]>([]);
  const activeRef = useRef<Map<number, { onset_s: number; velocity: number }>>(new Map());
  const midiStartRef = useRef<number | null>(null);
  const scoreSeqRef = useRef(0);
  const comparisonSeqRef = useRef(0);
  const [status, setStatus] = useState<string>("Готово");
  const [livePressed, setLivePressed] = useState<number[]>([]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [emulatorSummary, setEmulatorSummary] = useState<any>(null);
  const [emulatorMatches, setEmulatorMatches] = useState<any[]>([]);
  const [scorePipeline, setScorePipeline] = useState<any>(null);
  const [comparisonRows, setComparisonRows] = useState<CorrectorComparisonRow[]>([]);
  const [comparisonStatus, setComparisonStatus] = useState("Нет попытки");
  const [emulatorScoreStatus, setEmulatorScoreStatus] = useState("Сыграйте первые ноты");
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("heuristic");
  const [onsetTolS, setOnsetTolS] = useState(0.12);

  useEffect(() => { api.exercise(id).then(setExercise); }, [id]);

  useEffect(() => {
    if (!exercise) return;
    setStatus("Загружаем эталонный MIDI…");
    fetchAndParseMidi(exercise.midi_url)
      .then((ev) => { setExpected(ev); setStatus("Готово"); })
      .catch(() => { setExpected([]); setStatus("Готово, но без эталонного MIDI"); });
  }, [exercise]);

  useEffect(() => {
    if (mode === "compare" && inputMode === "mic_live") setInputMode("mic");
  }, [inputMode, mode]);

  useEffect(() => {
    if (mode !== "compare") return;

    const seq = scoreSeqRef.current + 1;
    scoreSeqRef.current = seq;

    if (!expected.length) {
      setEmulatorSummary(null);
      setEmulatorMatches([]);
      setScorePipeline(null);
      setComparisonRows([]);
      setComparisonStatus("Нет эталона");
      setEmulatorScoreStatus("Нет эталона");
      return;
    }

    if (!performed.length) {
      setEmulatorSummary(null);
      setEmulatorMatches([]);
      setScorePipeline(null);
      setComparisonRows([]);
      setComparisonStatus("Нет попытки");
      setEmulatorScoreStatus("Сыграйте первые ноты");
      return;
    }

    setEmulatorScoreStatus("Оцениваем...");
    const perfSnapshot = performed;
    const expectedSnapshot = expected;
    const exerciseId = exercise?.id ?? id ?? "practice";
    const source = inputMode === "mic" ? performedSource : "midi";

    const timer = window.setTimeout(async () => {
      try {
        const res = await api.scorePerformance({
          exercise_id: exerciseId,
          source,
          performed: perfSnapshot,
          expected: expectedSnapshot,
          onset_tol_s: onsetTolS,
          assistant: assistantMode,
          aligner: "safe_linear_dtw",
        });
        if (scoreSeqRef.current !== seq) return;
        const cleanedPerformed = res.events?.performed;
        if (source === "mic" && Array.isArray(cleanedPerformed) && notesSignature(cleanedPerformed) !== notesSignature(perfSnapshot)) {
          setPerformed(cleanedPerformed);
        }
        setEmulatorSummary(res.summary);
        setEmulatorMatches(res.events?.matches ?? []);
        setScorePipeline(res.pipeline ?? null);
        setEmulatorScoreStatus(`F1 ${(res.summary?.f1 ?? 0).toFixed(3)}`);
      } catch {
        if (scoreSeqRef.current !== seq) return;
        setEmulatorScoreStatus("Не удалось оценить");
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [mode, expected, performed, exercise?.id, id, inputMode, performedSource, assistantMode, onsetTolS]);

  useEffect(() => {
    if (mode !== "compare") return;
    if (!expected.length || !performed.length) return;

    const seq = comparisonSeqRef.current + 1;
    comparisonSeqRef.current = seq;
    const perfSnapshot = performed;
    const expectedSnapshot = expected;
    const exerciseId = exercise?.id ?? id ?? "practice";
    const source = inputMode === "mic" ? performedSource : "midi";
    const modes = COMPARISON_CORRECTORS;

    setComparisonStatus("Считаем корректоры...");
    const timer = window.setTimeout(async () => {
      try {
        const rows = await Promise.all(modes.map(async (assistant) => {
          const res = await api.scorePerformance({
            exercise_id: exerciseId,
            source,
            performed: perfSnapshot,
            expected: expectedSnapshot,
            onset_tol_s: onsetTolS,
            assistant,
            aligner: "safe_linear_dtw",
          });
          return { mode: assistant, summary: res.summary, pipeline: res.pipeline };
        }));
        if (comparisonSeqRef.current !== seq) return;
        rows.sort((a, b) => (b.summary?.robustness_score ?? 0) - (a.summary?.robustness_score ?? 0));
        setComparisonRows(rows);
        setComparisonStatus("Готово");
      } catch {
        if (comparisonSeqRef.current !== seq) return;
        setComparisonRows([]);
        setComparisonStatus("Не удалось сравнить корректоры");
      }
    }, 750);

    return () => window.clearTimeout(timer);
  }, [mode, expected, performed, exercise?.id, id, inputMode, performedSource, onsetTolS]);

  const onNote = (evt: NoteEvent, isOn: boolean) => {
    const note = evt.midi_note;
    if (midiStartRef.current === null) midiStartRef.current = evt.onset_s;
    const now = evt.onset_s - midiStartRef.current;
    if (isOn) {
      activeRef.current.set(note, { onset_s: now, velocity: evt.velocity });
    } else {
      const st = activeRef.current.get(note);
      if (st) {
        activeRef.current.delete(note);
        const finished: NoteEvent = { onset_s: st.onset_s, offset_s: now, midi_note: note, velocity: st.velocity };
        setPerformed((p) => [...p, finished]);
      }
    }
    setPressed((arr) => {
      const s = new Set(arr);
      if (isOn) s.add(evt.midi_note); else s.delete(evt.midi_note);
      return Array.from(s);
    });
  };

  const finish = async (source: "midi" | "mic", perf: NoteEvent[]) => {
    if (!exercise) return;
    if (!user) {
      setStatus("Войдите в аккаунт, чтобы сохранить сессию");
      router.push("/login");
      return;
    }
    setStatus("Сохраняем…");
    try {
      const res = await api.createSession({
        exercise_id: exercise.id,
        source,
        performed: perf,
        expected: expected.length ? expected : perf,
        onset_tol_s: onsetTolS,
        assistant: assistantMode,
        aligner: "safe_linear_dtw",
      });
      router.push(`/session/${res.session_id}`);
    } catch {
      setStatus("Не удалось сохранить сессию");
    }
  };

  const resetTake = () => {
    setPerformed([]);
    setPerformedSource("midi");
    setPressed([]);
    setLivePressed([]);
    setEmulatorSummary(null);
    setEmulatorMatches([]);
    setScorePipeline(null);
    setComparisonRows([]);
    setComparisonStatus("Нет попытки");
    setEmulatorScoreStatus("Сыграйте первые ноты");
    activeRef.current.clear();
    midiStartRef.current = null;
    setStatus("Готово к новой попытке");
  };

  const sourceForSave: "midi" | "mic" = inputMode === "mic" ? performedSource : "midi";
  const assistantDecision = scorePipeline?.assistant?.decision ?? emulatorSummary?.assistant_mode ?? assistantMode;
  const assistantDiagnostics = scorePipeline?.assistant?.diagnostics ?? {};
  const baselineRow = comparisonRows.find((row) => row.mode === "off");

  const renderSourceTabs = () => {
    const options: { label: string; value: InputMode }[] = [
      { label: "Эмулятор", value: "emulator" },
      { label: "MIDI", value: "midi" },
      { label: "Микрофон / файл", value: "mic" },
      ...(mode === "learning" ? [{ label: "Микрофон вживую", value: "mic_live" as InputMode }] : []),
    ];

    return (
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => setInputMode(option.value)}
            className={inputMode === option.value ? "rounded-2xl bg-white px-4 py-2 text-sm font-medium text-zinc-950" : "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  };

  const renderInputSurface = (actions = true) => (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          Источник ввода
          <HelpTip text="Источник определяет, откуда берутся сыгранные ноты: экранное пианино и MIDI дают точные события, микрофон сначала распознается AMT-моделью, микрофон вживую подходит только для одиночных нот." />
        </div>
        {renderSourceTabs()}
      </div>

      <div className="mt-4 rounded-3xl border border-white/10 bg-black/20 p-4">
        {inputMode === "mic" ? (
          <div>
            <div className="text-sm font-black text-lime-100">Что делать: запись → распознавание → мгновенная оценка</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Нажмите “Начать запись”, сыграйте упражнение, затем “Стоп и распознать”. Когда появится число нот, отчет и сравнение построятся автоматически.
            </div>
          </div>
        ) : inputMode === "midi" ? (
          <div>
            <div className="text-sm font-black text-cyan-100">Что делать: подключите MIDI или играйте с клавиатуры компьютера</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Каждая отпущенная клавиша сразу попадает в попытку. В режиме сравнения оценка пересчитывается без отдельной кнопки.
            </div>
          </div>
        ) : inputMode === "mic_live" ? (
          <div>
            <div className="text-sm font-black text-cyan-100">Что делать: включите детектор в реальном времени и играйте одиночные ноты</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Этот режим показывает текущую ноту с микрофона в реальном времени. Для полноценного отчета по фразе используйте “Микрофон / файл”.
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-black text-lime-100">Что делать: нажимайте клавиши экранного пианино</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Можно играть мышью, тачпадом или клавиатурой. В сравнении оценка появляется сразу после первых нот.
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-4">
        {inputMode === "emulator" ? (
          <PianoEmulator onNote={onNote} pressed={pressed} />
        ) : inputMode === "midi" ? (
          <>
            <MidiConnect onNote={onNote} />
            <ComputerKeyboardMidi onNote={onNote} />
          </>
        ) : inputMode === "mic" ? (
          <MicRecorder
            onStatus={setStatus}
            expectedNotes={mode === "compare" ? expected : undefined}
            onAnalyzed={(notes, source) => {
              setPerformed(notes);
              setPerformedSource(source);
            }}
          />
        ) : (
          <MicLive onPressedChange={setLivePressed} onRunningChange={setLiveRunning} />
        )}

        {actions ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {mode === "compare" ? (
              <Button onClick={() => finish(sourceForSave, performed)} className="w-full" disabled={!performed.length}>Сохранить отчет</Button>
            ) : null}
            <Button variant="outline" onClick={resetTake} className="w-full">Новая попытка</Button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const renderScoringControls = () => (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            Корректор
            <HelpTip text="Корректор пытается улучшить поток распознанных или сыгранных нот перед оценкой. Эвристический режим быстрый и стабильный, TCN/BiLSTM/Transformer используют обученные модели, «без корректора» показывает базовое сравнение." />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {CORRECTOR_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => setAssistantMode(option)}
                className={assistantMode === option ? "rounded-2xl bg-white px-4 py-2 text-sm font-medium text-zinc-950" : "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"}
              >
                {assistantLabel(option)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            Допуск атаки
            <HelpTip text="Допуск атаки задает, насколько поздно или рано можно нажать ноту, чтобы она считалась совпавшей с эталоном. 80 мс строже, 160 мс мягче." />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[0.08, 0.12, 0.16].map((option) => (
              <button
                key={option}
                onClick={() => setOnsetTolS(option)}
                className={onsetTolS === option ? "rounded-2xl bg-white px-4 py-2 text-sm font-medium text-zinc-950" : "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"}
              >
                {Math.round(option * 1000)} мс
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{exercise?.title ?? "Практика"}</h2>
          <p className="text-zinc-300">{status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setMode("learning")} className={mode==="learning" ? "rounded-2xl bg-white px-4 py-2 text-sm font-medium text-zinc-950" : "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"}>Обучение</button>
          <button onClick={() => setMode("compare")} className={mode==="compare" ? "rounded-2xl bg-white px-4 py-2 text-sm font-medium text-zinc-950" : "rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"}>Сравнение</button>
        </div>
      </div>

      {mode === "learning" ? (
        <div className="space-y-4">
          <NoteComparisonVisualizer
            expected={expected}
            performed={[]}
            title="Урок: эталон"
            subtitle="Запустите воспроизведение и следите за верхней клавиатурой, затем повторите на эмуляторе ниже."
            showPerformedLane={false}
          />

          <SheetMusicPanel
            notes={expected}
            tempoBpm={exercise?.tempo_bpm}
            title="Ноты урока"
            subtitle="Нотный стан построен из MIDI-эталона: смотрите запись, затем повторяйте на эмуляторе."
          />

          {renderInputSurface()}
        </div>
      ) : null}

      {mode === "compare" ? (
        <div className="space-y-4">
          <SheetMusicPanel
            notes={expected}
            tempoBpm={exercise?.tempo_bpm}
            title="Нотный стан эталона"
            subtitle="Перед попыткой проверьте ноты и такты, извлеченные из MIDI упражнения."
          />
          {renderScoringControls()}
          {renderInputSurface()}
        </div>
      ) : null}

      {mode === "compare" ? (
        <Card>
            <CardHeader
              title="Мгновенная оценка"
              subtitle="F1 · тайминг · ошибки"
              right={<Pill>{emulatorScoreStatus}</Pill>}
              help="Оценка пересчитывается автоматически после появления нот. F1 показывает совпадение нот, тайминг показывает точность атаки, пропущенные и лишние ноты показывают конкретные ошибки."
            />
          <CardBody>
            {emulatorSummary ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <ScoreTile title="Оценка" value={scoreLabel(emulatorSummary.f1 ?? 0)} sub={`F1 ${(emulatorSummary.f1 ?? 0).toFixed(3)}`} />
                  <ScoreTile title="Совпало" value={`${emulatorSummary.correct ?? 0} / ${expected.length}`} sub={`Точность ${(emulatorSummary.precision ?? 0).toFixed(2)} · полнота ${(emulatorSummary.recall ?? 0).toFixed(2)}`} />
                  <ScoreTile title="Ошибки" value={`${(emulatorSummary.missed ?? 0) + (emulatorSummary.extra ?? 0)}`} sub={`Пропущено ${emulatorSummary.missed ?? 0} · Лишних ${emulatorSummary.extra ?? 0}`} />
                  <ScoreTile title="Тайминг" value={formatMs(emulatorSummary.mae_s)} sub={`p95 ${formatMs(emulatorSummary.p95_s)}`} />
                  <ScoreTile title="Длительность" value={formatMs(emulatorSummary.duration_mae_s)} sub={`p95 ${formatMs(emulatorSummary.duration_p95_s)}`} />
                  <ScoreTile title="Сила нажатия" value={typeof emulatorSummary.velocity_mae === "number" ? emulatorSummary.velocity_mae.toFixed(1) : "—"} sub={`оценка ${((emulatorSummary.velocity_score ?? 0) * 100).toFixed(0)}%`} />
                  <ScoreTile title="Корректор" value={assistantLabel(assistantMode)} sub={`${decisionLabelRu(assistantDecision)} · допуск ${Math.round(onsetTolS * 1000)} мс`} />
                  <ScoreTile title="Порог качества" value={assistantDiagnostics.gate_reason ?? assistantDiagnostics.reason ?? "—"} sub={`изменение ${fmtPct(assistantDiagnostics.change_ratio)} · порог ${fmtThresholds(assistantDiagnostics.thresholds)}`} />
                  <ScoreTile title="Выравнивание" value={alignerLabelRu(emulatorSummary.aligner_mode)} sub={scorePipeline?.aligner?.guard ? `защита: ${decisionLabelRu(scorePipeline.aligner.guard)}` : "безопасный DTW"} />
                </div>
              </div>
            ) : (
              <div className="rounded-xl2 border border-white/10 bg-black/20 p-4 text-sm text-[rgb(var(--muted))]">
                {emulatorScoreStatus}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {mode === "compare" && performed.length ? (
        <Card>
          <CardHeader
            title="Сравнение корректоров текущей попытки"
            subtitle="Сравнение корректоров на одном и том же исполнении."
            right={<Pill>{comparisonStatus}</Pill>}
            help="Сравнение корректоров показывает, как меняется оценка одной и той же попытки при разных режимах обработки. Это помогает выбрать режим, который реально улучшает качество, а не просто меняет цифры."
          />
          <CardBody>
            {comparisonRows.length ? (
              <div className="space-y-3">
                {comparisonRows.length > 1 && new Set(comparisonRows.map((row) => fmtScore(row.summary?.f1))).size === 1 ? (
                  <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-50">
                    F1 одинаковый, потому что сейчас основная оценка сравнивает последовательность нот: если высоты и порядок совпадают, задержка не считается ошибкой ноты. Отличия корректоров смотрите в колонках “Атака”, “Длительность”, “Решение” и “Изменение”.
                  </div>
                ) : null}
              <div className="overflow-x-auto rounded-xl2 border border-white/10">
                <table className="w-full min-w-[1060px] text-left text-sm">
                  <thead className="bg-white/5 text-xs text-[rgb(var(--muted))]">
                    <tr>
                      <th className="p-3">Корректор</th>
                      <th className="p-3">F1 нот</th>
                      <th className="p-3">ΔF1</th>
                      <th className="p-3">Аккорды</th>
                      <th className="p-3">Атака</th>
                      <th className="p-3">Длительность</th>
                      <th className="p-3">Устойчивость</th>
                      <th className="p-3">Решение</th>
                      <th className="p-3">Причина защиты</th>
                      <th className="p-3">Порог</th>
                      <th className="p-3">Изменение</th>
                      <th className="p-3">Пороги</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((row) => {
                      const baseF1 = baselineRow?.summary?.f1 ?? row.summary?.f1 ?? 0;
                      const decision = row.pipeline?.assistant?.decision ?? row.summary?.assistant_mode ?? row.mode;
                      const diagnostics = row.pipeline?.assistant?.diagnostics ?? {};
                      return (
                        <tr key={row.mode} className={row.mode === assistantMode ? "border-t border-white/10 bg-cyan-300/10" : "border-t border-white/10"}>
                          <td className="p-3 font-semibold">{assistantLabel(row.mode)}</td>
                          <td className="p-3 tabular-nums">{fmtScore(row.summary?.f1)}</td>
                          <td className="p-3 tabular-nums">{fmtScore((row.summary?.f1 ?? 0) - baseF1, 3)}</td>
                          <td className="p-3 tabular-nums">{fmtScore(row.summary?.chord_f1)}</td>
                          <td className="p-3 tabular-nums">{formatMs(row.summary?.mae_s)}</td>
                          <td className="p-3 tabular-nums">{formatMs(row.summary?.duration_mae_s)}</td>
                          <td className="p-3 tabular-nums">{fmtScore(row.summary?.robustness_score)}</td>
                          <td className="p-3">{decisionLabelRu(decision)}</td>
                          <td className="p-3 text-[rgb(var(--muted))]">{diagnostics.reason ?? "—"}</td>
                          <td className="p-3 text-[rgb(var(--muted))]">{diagnostics.gate_reason ?? diagnostics.quality_gate ?? "—"}</td>
                          <td className="p-3 tabular-nums">{fmtPct(diagnostics.change_ratio)}</td>
                          <td className="p-3 tabular-nums">{fmtThresholds(diagnostics.thresholds)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            ) : (
              <div className="rounded-xl2 border border-white/10 bg-black/20 p-4 text-sm text-[rgb(var(--muted))]">{comparisonStatus}</div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {mode === "compare" && performed.length ? (
        <div className="space-y-4">
          <NoteComparisonVisualizer
            expected={expected}
            performed={performed}
            matches={emulatorMatches as any}
            expectedOffsetS={emulatorSummary?.best_offset_s ?? 0}
            sequenceMode
            title="Отчет: сравнение с эталоном"
            subtitle="Воспроизведение показывает последовательность нот: задержка не считается ошибкой, а уходит в метрику тайминга"
          />
          <Card>
            <CardHeader
              title="Пиано-ролл"
              subtitle="Эталон цветом, исполнение серым"
              right={<Pill>{performed.length} нот</Pill>}
              help="Пиано-ролл показывает ноты во времени: удобно увидеть, где исполнение опоздало, где нота пропущена и где появилась лишняя нота"
            />
            <CardBody>
              <PianoRoll expected={expected} performed={performed} matches={emulatorMatches as any} expectedOffsetS={emulatorSummary?.best_offset_s ?? 0} />
            </CardBody>
          </Card>
        </div>
      ) : null}

    </div>
  );
}
