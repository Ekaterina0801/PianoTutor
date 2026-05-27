"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileAudio, Mic, Radio, RotateCcw, Upload, Waves } from "lucide-react";
import { api } from "@/lib/api";
import { isMidiFile, parseMidiFile } from "@/lib/midi";
import type { NoteEvent } from "@/lib/types";
import { Button, Pill } from "@/components/ui";

type PerformedSource = "midi" | "mic";
type RecorderState = "idle" | "starting" | "recording" | "processing" | "ready" | "error";

const MAX_RECORDING_S = 20;
const MIN_RECORDING_S = 0.8;
const AUTO_STOP_AFTER_SILENCE_S = 1.3;
const SIGNAL_LEVEL_THRESHOLD = 0.055;
const MIN_RECORDED_PEAK_LEVEL = 0.06;
const NO_SIGNAL_HINT_S = 3;

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/wav",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function fileExtForMime(mime: string) {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

function fmtTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function friendlyError(err: any) {
  const raw = String(err?.message || err || "");
  if (raw.includes("Authorization token required") || raw.includes("401")) {
    return "Нужно войти в аккаунт: распознавание аудио на сервере защищено авторизацией";
  }
  if (raw.includes("Permission denied") || raw.includes("NotAllowedError")) {
    return "Браузер не дал доступ к микрофону. Разрешите микрофон в адресной строке и попробуйте снова.";
  }
  if (raw.includes("NotFoundError")) {
    return "Микрофон не найден. Проверьте устройство ввода в настройках системы.";
  }
  if (raw.includes("ffmpeg")) {
    return "Сервер не смог прочитать формат аудио. Загрузите WAV/WebM или проверьте ffmpeg.";
  }
  return raw || "Не удалось обработать запись.";
}

export function MicRecorder({
  onAnalyzed,
  onStatus,
  expectedNotes,
}: {
  onAnalyzed: (notes: NoteEvent[], source: PerformedSource) => void;
  onStatus: (s: string) => void;
  expectedNotes?: NoteEvent[];
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const startedAtRef = useRef(0);
  const stopReasonRef = useRef<"manual" | "silence" | "limit">("manual");
  const heardSignalRef = useRef(false);
  const lastSignalAtRef = useRef(0);
  const noSignalHintShownRef = useRef(false);
  const peakLevelRef = useRef(0);

  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [lastFileName, setLastFileName] = useState("");
  const [lastNotes, setLastNotes] = useState(0);
  const [error, setError] = useState("");

  const mimeType = useMemo(pickMimeType, []);
  const busy = state === "starting" || state === "processing";
  const recording = state === "recording";
  const progress = Math.min(1, elapsed / MAX_RECORDING_S);

  const stopLevelMeter = async () => {
    if (levelFrameRef.current !== null) window.cancelAnimationFrame(levelFrameRef.current);
    levelFrameRef.current = null;
    try {
      audioSourceRef.current?.disconnect();
    } catch {}
    audioSourceRef.current = null;
    try {
      await audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
    setLevel(0);
  };

  const cleanupStream = async () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    await stopLevelMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (levelFrameRef.current !== null) window.cancelAnimationFrame(levelFrameRef.current);
      try {
        audioSourceRef.current?.disconnect();
      } catch {}
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioCtxRef.current?.close();
    };
  }, []);

  const startLevelMeter = async (stream: MediaStream) => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    audioCtxRef.current = ctx;
    audioSourceRef.current = source;

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      const nextLevel = Math.min(1, rms * 8);
      peakLevelRef.current = Math.max(peakLevelRef.current, nextLevel);
      if (nextLevel > SIGNAL_LEVEL_THRESHOLD) {
        heardSignalRef.current = true;
        lastSignalAtRef.current = Date.now();
      }
      setLevel(nextLevel);
      levelFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  };

  const transcribe = async (file: File) => {
    setState("processing");
    setError("");
    setLastFileName(file.name);
    try {
      if (isMidiFile(file)) {
        onStatus("Читаем MIDI-файл игры...");
        const notes = await parseMidiFile(file);
        setLastNotes(notes.length);
        setState("ready");
        onStatus(`MIDI загружен: ${notes.length} нот. Оценка появится автоматически.`);
        onAnalyzed(notes, "midi");
        return;
      }

      onStatus("Отправляем запись на распознавание. Обычно это занимает несколько секунд...");
      const notes = await api.transcribe(file, MAX_RECORDING_S, expectedNotes);
      setLastNotes(notes.length);
      setState("ready");
      onStatus(`Распознавание прошло: ${notes.length} очищенных нот. Ниже уже считается сравнение с эталоном`);
      onAnalyzed(notes, "mic");
    } catch (err: any) {
      const message = friendlyError(err);
      setError(message);
      setState("error");
      onStatus(message);
    }
  };

  const stop = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    stopReasonRef.current = "manual";
    setState("processing");
    onStatus("Останавливаем запись и готовим аудио...");
    try {
      recorder.requestData();
    } catch {}
    recorder.stop();
  };

  const autoStop = (reason: "silence" | "limit") => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    stopReasonRef.current = reason;
    setState("processing");
    onStatus(reason === "silence" ? "Обнаружена пауза после игры. Готовим аудио..." : "20 секунд записаны. Готовим аудио...");
    try {
      recorder.requestData();
    } catch {}
    recorder.stop();
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "Браузер не поддерживает запись с микрофона. Загрузите WAV/WebM-файл вручную";
      setError(message);
      setState("error");
      onStatus(message);
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      const message = "MediaRecorder недоступен в этом браузере. Попробуйте Chrome/Edge или загрузите аудиофайл";
      setError(message);
      setState("error");
      onStatus(message);
      return;
    }

    setError("");
    setLastNotes(0);
    setElapsed(0);
    chunksRef.current = [];
    stopReasonRef.current = "manual";
    heardSignalRef.current = false;
    lastSignalAtRef.current = 0;
    noSignalHintShownRef.current = false;
    peakLevelRef.current = 0;
    onAnalyzed([], "mic");
    setState("starting");
    onStatus("Запрашиваем доступ к микрофону...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;
      await startLevelMeter(stream);

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        const message = "Ошибка браузерной записи. Попробуйте перезапустить запись или выбрать файл";
        setError(message);
        setState("error");
        onStatus(message);
        void cleanupStream();
      };
      recorder.onstop = async () => {
        const duration = (Date.now() - startedAtRef.current) / 1000;
        setElapsed(Math.min(duration, MAX_RECORDING_S));
        await cleanupStream();
        recorderRef.current = null;

        if (duration < MIN_RECORDING_S) {
          const message = "Запись слишком короткая. Нажмите запись, сыграйте фразу и остановите после звука";
          setError(message);
          setState("error");
          onStatus(message);
          return;
        }

        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (!blob.size) {
          const message = "Браузер не вернул аудиоданные. Проверьте разрешение микрофона и устройство ввода";
          setError(message);
          setState("error");
          onStatus(message);
          return;
        }

        if (!heardSignalRef.current || peakLevelRef.current < MIN_RECORDED_PEAK_LEVEL) {
          const message = "Микрофон не услышал музыкальный сигнал. Запись не отправлена на распознавание, чтобы тишина не превратилась в ложную ноту. Сыграйте ближе к микрофону или громче :)";
          setError(message);
          setState("error");
          onStatus(message);
          return;
        }

        const ext = fileExtForMime(type);
        const file = new File([blob], `microphone-take.${ext}`, { type });
        const stopMessage =
          stopReasonRef.current === "silence"
            ? "Обнаружена пауза после игры. Распознаем фрагмент..."
            : stopReasonRef.current === "limit"
              ? "20 секунд записаны. Распознаем фрагмент..."
              : "Запись остановлена. Распознаем фрагмент...";
        onStatus(stopMessage);
        await transcribe(file);
      };

      startedAtRef.current = Date.now();
      recorder.start(250);
      setState("recording");
      onStatus("Запись идет: сыграйте упражнение. Сервис сам остановится после паузы или нажмите “Стоп”");
      timerRef.current = window.setInterval(() => {
        const next = (Date.now() - startedAtRef.current) / 1000;
        setElapsed(Math.min(next, MAX_RECORDING_S));
        if (next >= MAX_RECORDING_S) {
          autoStop("limit");
          return;
        }

        if (!heardSignalRef.current && next >= NO_SIGNAL_HINT_S && !noSignalHintShownRef.current) {
          noSignalHintShownRef.current = true;
          onStatus("Запись идет, но микрофон почти не слышит звук. Сыграйте ближе к микрофону или громче :)");
          return;
        }

        if (
          heardSignalRef.current &&
          next >= MIN_RECORDING_S &&
          lastSignalAtRef.current > 0 &&
          (Date.now() - lastSignalAtRef.current) / 1000 >= AUTO_STOP_AFTER_SILENCE_S
        ) {
          autoStop("silence");
        }
      }, 120);
    } catch (err: any) {
      await cleanupStream();
      const message = friendlyError(err);
      setError(message);
      setState("error");
      onStatus(message);
    }
  };

  const reset = () => {
    setState("idle");
    setElapsed(0);
    setLevel(0);
    setLastFileName("");
    setLastNotes(0);
    setError("");
    chunksRef.current = [];
    onStatus("Готово к записи с микрофона");
  };

  return (
    <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(132,204,22,0.10),rgba(255,255,255,0.035))] p-5 shadow-[0_22px_60px_rgba(0,0,0,0.20)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Pill>
            <Radio className="mr-1 h-3.5 w-3.5 text-lime-300" />
            Микрофон и запись
          </Pill>
          <h3 className="mt-3 text-2xl font-black tracking-tight">Сыграйте фрагмент, сервис сам распознает ноты</h3>
          <div className="mt-2 max-w-2xl text-sm text-[rgb(var(--muted))]">
            Нажмите запись и сыграйте упражнение рядом с микрофоном. После паузы сервис сам остановит запись, распознает ноты и запустит сравнение
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[360px]">
          <StepPill active={state === "starting" || state === "recording"} done={state === "processing" || state === "ready"} label="1. Запись" />
          <StepPill active={state === "processing"} done={state === "ready"} label="2. Распознавание" />
          <StepPill active={state === "ready"} done={state === "ready"} label="3. Оценка" />
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr,0.9fr]">
        <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={recording || state === "processing" ? "reward-pop grid h-14 w-14 place-items-center rounded-2xl bg-rose-400 text-rose-950" : "grid h-14 w-14 place-items-center rounded-2xl bg-lime-300 text-lime-950"}>
                {recording || state === "processing" ? <Waves className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </div>
              <div>
                <div className="text-xs text-[rgb(var(--muted))]">{state === "processing" ? "Обработка" : "Длительность"}</div>
                <div className="text-3xl font-black tabular-nums">{fmtTime(elapsed)}</div>
              </div>
            </div>

            {!recording ? (
              <Button onClick={start} disabled={busy} className="min-h-12 px-6">
                <Mic className="h-4 w-4" />
                {state === "starting" ? "Подключаем..." : state === "processing" ? "Распознаем..." : "Начать запись"}
              </Button>
            ) : (
              <Button variant="outline" onClick={stop} className="min-h-12 border-rose-300/30 bg-rose-400/15 px-6 text-rose-100 hover:bg-rose-400/20">
                Стоп и распознать
              </Button>
            )}
          </div>

          <div className="mt-5 space-y-3">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-[rgb(var(--muted))]">
                <span>{recording ? "Идет запись, автостоп после паузы" : "Окно распознавания"}</span>
                <span>{recording ? `${Math.max(0, MAX_RECORDING_S - Math.floor(elapsed))} с осталось` : `${Math.round(progress * 100)}%`}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-black/30">
                <div className="premium-xp-bar h-full rounded-full transition-all duration-150" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-[rgb(var(--muted))]">
                <span>Уровень входного сигнала</span>
                <span>{level > SIGNAL_LEVEL_THRESHOLD ? "сигнал есть" : recording ? "сыграйте громче" : "ожидает"}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-black/30">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-lime-300 to-amber-300 transition-all duration-75"
                  style={{ width: `${Math.max(2, level * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black">Альтернатива записи</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">Можно загрузить WAV/MP3/WebM или MIDI-файл исполнения.</div>
            </div>
            {state === "ready" ? <CheckCircle2 className="h-5 w-5 text-lime-300" /> : state === "error" ? <AlertCircle className="h-5 w-5 text-rose-300" /> : <FileAudio className="h-5 w-5 text-cyan-300" />}
          </div>

          <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[0.045] px-4 py-4 text-center text-sm text-zinc-200 transition hover:bg-white/[0.075]">
            <Upload className="mb-2 h-5 w-5 text-cyan-300" />
            {state === "starting" ? "Подключаем микрофон..." : busy ? "Обрабатываем файл..." : "Выбрать аудио или MIDI"}
            <span className="mt-1 text-xs text-[rgb(var(--muted))]">После выбора анализ начнется автоматически</span>
            <input
              type="file"
              accept="audio/*,.wav,.mp3,.flac,.m4a,.webm,.ogg,.mid,.midi"
              className="hidden"
              disabled={busy || recording}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void transcribe(file);
                event.currentTarget.value = "";
              }}
            />
          </label>

          <div className="mt-4 grid gap-2 text-xs text-[rgb(var(--muted))]">
            <div className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2">
              <span>Последний файл</span>
              <span className="max-w-[180px] truncate text-zinc-200">{lastFileName || "—"}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2">
              <span>Распознано нот</span>
              <span className="font-semibold text-lime-200">{lastNotes || "—"}</span>
            </div>
          </div>

          <Button variant="outline" onClick={reset} disabled={recording || busy} className="mt-4 w-full">
            <RotateCcw className="h-4 w-4" />
            Сбросить микрофон
          </Button>
        </div>
      </div>

      {busy ? (
        <div className="mt-4 rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-50">
          {state === "starting"
            ? "Подключаем микрофон. Если браузер спросит разрешение, нажмите “Разрешить”."
            : "Распознавание выполняется на сервере: сначала аудио приводится к WAV, затем AMT-модель выделяет ноты, после чего результат сразу отправляется на сравнение."}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-3xl border border-rose-300/25 bg-rose-400/10 p-4 text-sm text-rose-50">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function StepPill({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div
      className={
        "rounded-2xl border px-3 py-2 text-center text-xs font-black transition " +
        (done
          ? "border-lime-300/35 bg-lime-300 text-lime-950"
          : active
            ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100"
            : "border-white/10 bg-white/5 text-[rgb(var(--muted))]")
      }
    >
      {label}
    </div>
  );
}
