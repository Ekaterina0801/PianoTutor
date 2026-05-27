"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pill } from "@/components/ui";

type LiveState = "idle" | "starting" | "running" | "error";
const MIC_PERMISSION_TIMEOUT_MS = 8000;
const EMPTY_PRESSED: number[] = [];

function hzToMidi(hz: number) {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

function midiName(n: number) {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const octave = Math.floor(n/12) - 1;
  return `${names[n%12]}${octave}`;
}

function detectPitchYin(buffer: Float32Array, sampleRate: number) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i += 1) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.01) return { hz: 0, conf: 0 };

  const n = buffer.length;
  const minHz = 45;
  const maxHz = 2200;
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxTau = Math.min(n - 2, Math.floor(sampleRate / minHz));
  const diff = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let i = 0; i < n - tau; i += 1) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    running += diff[tau];
    cmnd[tau] = diff[tau] * tau / (running || 1e-9);
  }

  let tau0 = -1;
  const threshold = 0.15;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau += 1;
      tau0 = tau;
      break;
    }
  }
  if (tau0 === -1) return { hz: 0, conf: 0 };

  let betterTau = tau0;
  if (tau0 > 1 && tau0 < maxTau) {
    const s0 = cmnd[tau0 - 1];
    const s1 = cmnd[tau0];
    const s2 = cmnd[tau0 + 1];
    const denom = 2 * s1 - s2 - s0;
    if (Math.abs(denom) > 1e-9) betterTau = tau0 + (s2 - s0) / (2 * denom);
  }

  return {
    hz: sampleRate / betterTau,
    conf: Math.max(0, Math.min(1, 1 - cmnd[tau0])),
  };
}

function friendlyError(err: any) {
  const raw = String(err?.name || err?.message || err || "");
  if (raw.includes("MIC_PERMISSION_TIMEOUT")) {
    return "Браузер не ответил на запрос микрофона. Проверьте всплывающее разрешение в адресной строке или разрешите микрофон в настройках сайта";
  }
  if (raw.includes("MIC_START_CANCELLED")) {
    return "Подключение микрофона отменено";
  }
  if (raw.includes("NotAllowedError") || raw.includes("PermissionDeniedError")) {
    return "Доступ к микрофону запрещен. Разрешите микрофон в адресной строке и нажмите “Старт” еще раз";
  }
  if (raw.includes("NotFoundError") || raw.includes("DevicesNotFoundError")) {
    return "Микрофон не найден. Проверьте устройство ввода в настройках системы";
  }
  if (raw.includes("NotReadableError")) {
    return "Микрофон занят другим приложением. Закройте другое приложение записи и попробуйте снова";
  }
  return raw || "Не удалось включить микрофон.";
}

export function MicLive({
  onPressedChange,
  onRunningChange,
}: {
  onPressedChange?: (pressed: number[]) => void;
  onRunningChange?: (running: boolean) => void;
}) {
  const [state, setState] = useState<LiveState>("idle");
  const [hz, setHz] = useState<number | null>(null);
  const [conf, setConf] = useState<number>(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Готово к запуску");

  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastAnalysisRef = useRef(0);
  const startTokenRef = useRef(0);
  const stateRef = useRef<LiveState>("idle");
  const lastPressedKeyRef = useRef("");

  const midi = useMemo(() => (hz && hz > 20 ? hzToMidi(hz) : null), [hz]);
  const pressed = useMemo(() => (midi !== null && conf > 0.55 ? [midi] : EMPTY_PRESSED), [midi, conf]);
  const running = state === "running";
  const starting = state === "starting";

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const key = pressed.join(",");
    if (key === lastPressedKeyRef.current) return;
    lastPressedKeyRef.current = key;
    onPressedChange?.(pressed);
  }, [pressed, onPressedChange]);

  const resetAudioState = async () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { sourceRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
    try { await ctxRef.current?.close(); } catch {}
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    analyserRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
  };

  const requestMicrophone = (token: number) =>
    new Promise<MediaStream>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("MIC_PERMISSION_TIMEOUT"));
      }, MIC_PERMISSION_TIMEOUT_MS);

      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      }).then((stream) => {
        window.clearTimeout(timeoutId);
        if (settled || token !== startTokenRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          if (!settled) {
            settled = true;
            reject(new Error("MIC_START_CANCELLED"));
          }
          return;
        }
        settled = true;
        resolve(stream);
      }).catch((err) => {
        window.clearTimeout(timeoutId);
        if (settled) return;
        settled = true;
        reject(err);
      });
    });

  useEffect(() => {
    return () => {
      startTokenRef.current += 1;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      try { sourceRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop());
      void ctxRef.current?.close();
    };
  }, []);

  const start = async () => {
    if (stateRef.current === "starting" || stateRef.current === "running") return;
    const token = startTokenRef.current + 1;
    startTokenRef.current = token;
    setStatus("Нажатие получено. Проверяем доступ к микрофону...");
    setError("");
    setHz(null);
    setConf(0);

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "Браузер не поддерживает доступ к микрофону. Откройте страницу в Chrome/Edge/Safari на localhost или через HTTPS";
      setError(message);
      setStatus(message);
      stateRef.current = "error";
      setState("error");
      onRunningChange?.(false);
      return;
    }

    stateRef.current = "starting";
    setState("starting");
    setStatus("Запрашиваем доступ к микрофону. Если браузер покажет запрос, нажмите “Разрешить”");

    try {
      const stream = await requestMicrophone(token);
      if (token !== startTokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("AudioContext недоступен в этом браузере");

      const ctx = new AudioContextCtor();
      await ctx.resume();
      ctxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      sourceRef.current = source;
      analyserRef.current = analyser;

      const data = new Float32Array(analyser.fftSize);
      const tick = (time: number) => {
        if (!analyserRef.current || !ctxRef.current) return;
        if (time - lastAnalysisRef.current >= 75) {
          lastAnalysisRef.current = time;
          analyserRef.current.getFloatTimeDomainData(data);
          const next = detectPitchYin(data, ctxRef.current.sampleRate);
          if (next.hz > 20 && next.conf > 0.2) setHz(next.hz);
          else setHz(null);
          setConf(next.conf);
        }
        rafRef.current = window.requestAnimationFrame(tick);
      };

      if (token !== startTokenRef.current) return;
      stateRef.current = "running";
      setState("running");
      setStatus("Слушаем микрофон. Сыграйте ноту рядом с микрофоном");
      onRunningChange?.(true);
      rafRef.current = window.requestAnimationFrame(tick);
    } catch (err: any) {
      if (token !== startTokenRef.current) return;
      await resetAudioState();
      const message = friendlyError(err);
      setError(message);
      setStatus(message);
      stateRef.current = "error";
      setState("error");
      setHz(null);
      setConf(0);
      onRunningChange?.(false);
    }
  };

  const stop = async () => {
    startTokenRef.current += 1;
    stateRef.current = "idle";
    setState("idle");
    setStatus(starting ? "Подключение отменено" : "Остановлено");
    onRunningChange?.(false);
    await resetAudioState();
    setHz(null);
    setConf(0);
  };

  const activate = () => {
    if (stateRef.current === "starting" || stateRef.current === "running") void stop();
    else void start();
  };

  const buttonLabel = running ? "Стоп" : starting ? "Отменить" : "Старт";
  const buttonClass = running || starting
    ? "relative z-10 inline-flex min-h-12 touch-manipulation select-none items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 active:scale-[0.99]"
    : "relative z-10 inline-flex min-h-12 touch-manipulation select-none items-center justify-center rounded-2xl bg-gradient-to-r from-lime-300 via-cyan-300 to-amber-300 px-6 py-2.5 text-sm font-semibold text-lime-950 shadow-[0_16px_36px_rgba(132,204,22,0.22)] transition hover:brightness-105 active:scale-[0.99]";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Микрофон вживую: одна нота</div>
          <div className="mt-1 text-xs text-zinc-400">Распознавание высоты в реальном времени, лучше всего для мелодий и одиночных нот</div>
        </div>
        <button
          type="button"
          data-mic-live-action="toggle"
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            event.preventDefault();
            activate();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            activate();
          }}
          onClick={(event) => event.preventDefault()}
          className={buttonClass}
        >
          {buttonLabel}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Pill>{running ? "слушаем" : starting ? "подключаем микрофон" : state === "error" ? "ошибка" : "ожидает старта"}</Pill>
        <span className="text-xs text-zinc-400">{status}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-zinc-400">Нота</div>
          <div className="mt-1 text-2xl font-semibold">{midi !== null ? midiName(midi) : "—"}</div>
        </div>
        <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-zinc-400">Гц</div>
          <div className="mt-1 text-2xl font-semibold">{hz ? hz.toFixed(1) : "—"}</div>
        </div>
        <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
          <div className="text-xs text-zinc-400">Уверенность</div>
          <div className="mt-1 text-2xl font-semibold">{(conf*100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="rounded-xl2 border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
        Лайв-режим работает как быстрый детектор одной ноты. Основная визуализация ниже сравнивает текущую распознанную клавишу с эталоном
      </div>

      {error ? (
        <div className="rounded-xl2 border border-rose-300/25 bg-rose-400/10 p-3 text-sm text-rose-50">
          {error}
        </div>
      ) : null}
    </div>
  );
}
