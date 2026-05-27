"use client";
import { useMemo } from "react";
import type { MatchRow } from "@/lib/reportTypes";

export function ErrorHeatmap({
  matches,
  bins = 24,
  onSelectRange,
}: {
  matches: MatchRow[];
  bins?: number;
  onSelectRange?: (r: { t0: number; t1: number }) => void;
}) {
  const { values, maxV, t0, t1 } = useMemo(() => {
    const ts: number[] = [];
    for (const m of matches) {
      if (m.expected) ts.push(m.expected.onset_s);
      else if (m.performed) ts.push(m.performed.onset_s);
    }
    if (!ts.length) return { values: Array(bins).fill(0), maxV: 0, t0: 0, t1: 1 };
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const values = Array(bins).fill(0);
    for (const m of matches) {
      if (m.status === "correct") continue;
      const t = m.expected?.onset_s ?? m.performed?.onset_s ?? t0;
      const idx = Math.min(bins - 1, Math.max(0, Math.floor(((t - t0) / Math.max(1e-6, (t1 - t0))) * bins)));
      values[idx] += 1;
    }
    const maxV = Math.max(...values);
    return { values, maxV, t0, t1 };
  }, [matches, bins]);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Тепловая карта ошибок</div>
          <div className="text-xs text-[rgb(var(--muted))]">Нажмите на сегмент, чтобы приблизить пиано-ролл</div>
        </div>
        <div className="text-xs text-[rgb(var(--muted))]">{bins} сегментов</div>
      </div>

      <div className="mt-3 grid grid-cols-12 gap-2">
        {values.map((v, i) => {
          const a = maxV ? v / maxV : 0;
          const bg = `rgba(244,63,94,${0.08 + 0.72*a})`; // rose glow
          const bin0 = t0 + (i / bins) * (t1 - t0);
          const bin1 = t0 + ((i + 1) / bins) * (t1 - t0);
          return (
            <button
              key={i}
              onClick={() => onSelectRange?.({ t0: bin0, t1: bin1 })}
              title={`${bin0.toFixed(1)} с – ${bin1.toFixed(1)} с · ошибок ${v}`}
              className="h-6 rounded-xl2 border border-white/10 hover:scale-[1.02] transition"
              style={{ background: v ? bg : "rgba(255,255,255,0.04)" }}
            />
          );
        })}
      </div>
    </div>
  );
}
