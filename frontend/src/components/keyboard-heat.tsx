"use client";
import { useMemo } from "react";
import type { MatchRow } from "@/lib/reportTypes";
import { midiToName } from "@/lib/reportInsights";

export function KeyboardHeat({ matches }: { matches: MatchRow[] }) {
  const { missed, extra, maxV } = useMemo(() => {
    const missed = new Map<number, number>();
    const extra = new Map<number, number>();
    for (const m of matches) {
      if (m.status === "missed" && m.expected) missed.set(m.expected.midi_note, (missed.get(m.expected.midi_note) ?? 0) + 1);
      if (m.status === "extra" && m.performed) extra.set(m.performed.midi_note, (extra.get(m.performed.midi_note) ?? 0) + 1);
    }
    let mx = 0;
    for (const v of missed.values()) mx = Math.max(mx, v);
    for (const v of extra.values()) mx = Math.max(mx, v);
    return { missed, extra, maxV: mx };
  }, [matches]);

  const start = 21, end = 108;
  const keys = useMemo(() => Array.from({length:end-start+1},(_,i)=>start+i), []);

  return (
    <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
      <div className="text-sm font-semibold">Ошибки на клавиатуре</div>
      <div className="mt-1 text-xs text-[rgb(var(--muted))]">Красный — пропущено, желтый — лишнее. Чем ярче цвет, тем чаще ошибка</div>
      <div className="mt-3 overflow-x-auto">
        <div className="flex h-10 min-w-[900px]">
          {keys.map((k) => {
            const m = missed.get(k) ?? 0;
            const e = extra.get(k) ?? 0;
            const aM = maxV ? m / maxV : 0;
            const aE = maxV ? e / maxV : 0;
            const bg = m>0
              ? `rgba(244,63,94,${0.12 + 0.78*aM})`
              : e>0
                ? `rgba(250,204,21,${0.10 + 0.70*aE})`
                : `rgba(255,255,255,0.03)`;
            return (
              <div key={k} title={`${midiToName(k)} · пропущено ${m} · лишних ${e}`} className="w-[8px] border-r border-black/20" style={{ background: bg }} />
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-[rgb(var(--muted))]">
        <span>A0</span><span>C8</span>
      </div>
    </div>
  );
}
