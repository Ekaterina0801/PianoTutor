"use client";
import { useMemo } from "react";
import type { MatchRow } from "@/lib/reportTypes";
import { midiToName } from "@/lib/reportInsights";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

export function PitchErrorChart({ matches }: { matches: MatchRow[] }) {
  const data = useMemo(() => {
    const map = new Map<number, {missed:number; extra:number}>();
    for (const m of matches) {
      if (m.status === "missed" && m.expected) {
        const v = map.get(m.expected.midi_note) ?? {missed:0, extra:0};
        v.missed += 1; map.set(m.expected.midi_note, v);
      }
      if (m.status === "extra" && m.performed) {
        const v = map.get(m.performed.midi_note) ?? {missed:0, extra:0};
        v.extra += 1; map.set(m.performed.midi_note, v);
      }
    }
    return Array.from(map.entries())
      .sort((a,b)=>(b[1].missed+b[1].extra)-(a[1].missed+a[1].extra))
      .slice(0, 12)
      .map(([m,v]) => ({ note: midiToName(m), missed: v.missed, extra: v.extra }));
  }, [matches]);

  if (!data.length) return (
    <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
      <div className="text-sm font-semibold">Самые проблемные ноты</div>
      <div className="mt-1 text-xs text-[rgb(var(--muted))]">Ошибок нет!</div>
    </div>
  );

  return (
    <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
      <div className="text-sm font-semibold">Самые проблемные ноты</div>
      <div className="mt-1 text-xs text-[rgb(var(--muted))]">Какие высоты чаще всего пропускаются или добавляются лишними</div>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="note" tick={{ fill: "rgb(var(--muted))", fontSize: 10 }} />
            <YAxis tick={{ fill: "rgb(var(--muted))", fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
            <Bar dataKey="missed" name="Пропущено" />
            <Bar dataKey="extra" name="Лишнее" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
