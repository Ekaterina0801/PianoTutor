"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteEvent } from "@/lib/types";

type MatchRow = { status: string; performed: NoteEvent | null; expected: NoteEvent | null; dt_onset_s?: number | null };

type Props = {
  expected: NoteEvent[];
  performed: NoteEvent[];
  matches?: MatchRow[];
  range?: { t0: number; t1: number };
  overlay?: boolean;
  show?: { correct: boolean; missed: boolean; extra: boolean };
  expectedOffsetS?: number;
};

const NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
function midiName(n: number) {
  const o = Math.floor(n/12) - 1;
  return `${NAMES[n%12]}${o}`;
}

function getRange(events: NoteEvent[]) {
  let t0 = Infinity, t1 = -Infinity, p0 = Infinity, p1 = -Infinity;
  for (const e of events) {
    t0 = Math.min(t0, e.onset_s);
    t1 = Math.max(t1, e.offset_s);
    p0 = Math.min(p0, e.midi_note);
    p1 = Math.max(p1, e.midi_note);
  }
  if (!isFinite(t0)) return { t0: 0, t1: 1, p0: 48, p1: 84 };
  return { t0, t1: Math.max(t1, t0 + 1e-3), p0: Math.floor(p0), p1: Math.ceil(p1) };
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
  const expectedStatuses = new Map<number, string>();
  const performedStatuses = new Map<number, string>();
  const usedExpected = new Set<number>();
  const usedPerformed = new Set<number>();

  for (const row of matches) {
    const expectedIndex = findNearestNoteIndex(expected, row.expected, usedExpected, expectedOffsetS);
    if (expectedIndex >= 0) {
      expectedStatuses.set(expectedIndex, row.status === "extra" ? "missed" : row.status);
      usedExpected.add(expectedIndex);
    }

    const performedIndex = findNearestNoteIndex(performed, row.performed, usedPerformed);
    if (performedIndex >= 0) {
      performedStatuses.set(performedIndex, row.status === "missed" ? "extra" : row.status);
      usedPerformed.add(performedIndex);
    }
  }

  return { expectedStatuses, performedStatuses };
}

export function PianoRoll({ expected, performed, matches, range, overlay=false, show, expectedOffsetS = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1.0);          // 1 = default
  const [play, setPlay] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [tip, setTip] = useState<{x:number;y:number; txt:string} | null>(null);

  const showFlags = show ?? { correct:true, missed:true, extra:true };

  const matchIndexes = useMemo(
    () => buildMatchIndexes(expected, performed, matches, expectedOffsetS),
    [expected, expectedOffsetS, performed, matches],
  );

  const full = useMemo(() => {
    const rE = getRange(expected);
    const rP = getRange(performed);
    return {
      t0: Math.min(rE.t0, rP.t0),
      t1: Math.max(rE.t1, rP.t1),
      p0: Math.min(rE.p0, rP.p0),
      p1: Math.max(rE.p1, rP.p1),
    };
  }, [expected, performed]);

  const view = range ?? { t0: full.t0, t1: full.t1 };

  useEffect(() => {
    setPlayhead(view.t0);
  }, [view.t0, view.t1]);

  useEffect(() => {
    if (!play) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t:number) => {
      const dt = (t - last) / 1000;
      last = t;
      setPlayhead((ph) => {
        const next = ph + dt;
        if (next >= view.t1) return view.t0;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [play, view.t0, view.t1]);

  const draw = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = 320;
    canvas.style.height = `${h}px`;
    canvas.style.width = "100%";
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // margins
    const left = 44;
    const top = 14;
    const bottom = 26;
    const innerW = w - left - 10;
    const innerH = h - top - bottom;

    const t0 = view.t0;
    const t1 = view.t1;
    const span = Math.max(1e-6, t1 - t0) / zoom;

    const tA = t0;
    const tB = t0 + span;

    const p0 = full.p0;
    const p1 = full.p1;
    const P = Math.max(1, p1 - p0 + 1);
    const rowH = innerH / P;

    // background grid
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;

    // vertical seconds grid
    const secs = 6;
    for (let i=0;i<=secs;i++){
      const x = left + (i/secs)*innerW;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top+innerH); ctx.stroke();
      const tt = tA + (i/secs)*(tB-tA);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "10px ui-sans-serif";
      ctx.fillText(tt.toFixed(1), x-8, h-10);
    }

    // pitch labels (every 4)
    for (let p=p0; p<=p1; p+=4){
      const y = top + (p1 - p)*rowH + rowH*0.7;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText(midiName(p), 6, y);
    }

    // helper mapping
    const xOf = (t:number) => left + ((t - tA) / (tB - tA)) * innerW;
    const yOf = (m:number) => top + (p1 - m) * rowH;

    // expected notes
    for (let i = 0; i < expected.length; i += 1) {
      const e = expected[i];
      if (e.offset_s < tA || e.onset_s > tB) continue;
      const status = matchIndexes.expectedStatuses.get(i) ?? "missed";
      if (status==="correct" && !showFlags.correct) continue;
      if (status==="missed" && !showFlags.missed) continue;
      const x0 = xOf(Math.max(tA, e.onset_s));
      const x1 = xOf(Math.min(tB, e.offset_s));
      const y = yOf(e.midi_note);
      const hh = Math.max(2, rowH*0.7);
      const yy = overlay ? y + rowH*0.15 : y - 2; // expected slightly higher
      if (status === "correct") ctx.fillStyle = "rgba(52,211,153,0.75)"; // emerald
      else ctx.fillStyle = "rgba(244,63,94,0.78)"; // rose
      ctx.fillRect(x0, yy, Math.max(1, x1-x0), hh);
    }

    // performed notes
    for (let i = 0; i < performed.length; i += 1) {
      const n = performed[i];
      if (n.offset_s < tA || n.onset_s > tB) continue;
      const status = matchIndexes.performedStatuses.get(i) ?? "extra";
      if (status==="extra" && !showFlags.extra) continue;

      const x0 = xOf(Math.max(tA, n.onset_s));
      const x1 = xOf(Math.min(tB, n.offset_s));
      const y = yOf(n.midi_note);
      const hh = Math.max(2, rowH*0.7);
      const yy = overlay ? y + rowH*0.15 : y + rowH*0.35;
      ctx.fillStyle = status==="extra" ? "rgba(250,204,21,0.65)" : "rgba(148,163,184,0.55)";
      ctx.fillRect(x0, yy, Math.max(1, x1-x0), hh);
    }

    // playhead
    const px = xOf(Math.min(tB, Math.max(tA, playhead)));
    ctx.strokeStyle = "rgba(34,211,238,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, top+innerH); ctx.stroke();
  };

  useEffect(() => { draw(); }, [expected, performed, matches, view.t0, view.t1, zoom, playhead, overlay, showFlags.correct, showFlags.missed, showFlags.extra]);

  // tooltip hit-test (simple: nearest note rectangle)
  const onMove = (e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    // map to time/pitch approx
    const w = wrap.clientWidth;
    const left = 44;
    const top = 14;
    const h = 320;
    const innerW = w - left - 10;
    const innerH = h - top - 26;

    if (x < left || y < top || x > left+innerW || y > top+innerH) { setTip(null); return; }

    const span = Math.max(1e-6, (view.t1 - view.t0)) / zoom;
    const tA = view.t0;
    const tB = view.t0 + span;
    const tt = tA + ((x-left)/innerW)*(tB-tA);

    const p0 = full.p0, p1 = full.p1;
    const rowH = innerH / Math.max(1, (p1-p0+1));
    const pitch = Math.round(p1 - ((y-top)/rowH));

    // find closest expected/performed within small window
    const near = (arr: NoteEvent[], label: string) => {
      let best: NoteEvent | null = null;
      let bestd = 1e9;
      for (const n of arr) {
        const d = Math.abs(n.onset_s - tt) + 0.02*Math.abs(n.midi_note - pitch);
        if (d < bestd && Math.abs(n.onset_s-tt) < 0.25 && Math.abs(n.midi_note-pitch) < 2) { bestd=d; best=n; }
      }
      if (!best) return null;
      return { n: best, label };
    };

    const a = near(expected, "Эталон");
    const b = near(performed, "Исполнение");
    const pick = a && b ? (Math.abs(a.n.onset_s-tt) < Math.abs(b.n.onset_s-tt) ? a : b) : (a ?? b);
    if (!pick) { setTip(null); return; }
    const txt = `${pick.label}: ${midiName(pick.n.midi_note)}  ${pick.n.onset_s.toFixed(2)}–${pick.n.offset_s.toFixed(2)} с`;
    setTip({ x, y, txt });
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold">Пиано-ролл</div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setPlay(v=>!v)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
            {play ? "Пауза" : "Играть"}
          </button>
          <button onClick={()=>setPlayhead(view.t0)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
            Сброс
          </button>
          <div className="flex items-center gap-2 text-xs text-[rgb(var(--muted))]">
            Масштаб
            <input type="range" min="1" max="6" step="0.25" value={zoom} onChange={(e)=>setZoom(Number(e.target.value))} />
          </div>
          <div className="text-xs text-[rgb(var(--muted))]">{playhead.toFixed(2)} с</div>
        </div>
      </div>

      <div ref={wrapRef} className="relative mt-3" onMouseMove={onMove} onMouseLeave={()=>setTip(null)}>
        <canvas ref={canvasRef} className="w-full rounded-2xl border border-white/10" />
        {tip ? (
          <div className="absolute z-10 -translate-y-full rounded-2xl border border-white/10 bg-black/70 px-3 py-2 text-xs text-white backdrop-blur"
               style={{ left: Math.min(tip.x+12, 520), top: tip.y-8 }}>
            {tip.txt}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[rgb(var(--muted))]">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /> совпало</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-rose-400" /> пропущено</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-300" /> лишнее</span>
      </div>
    </div>
  );
}
