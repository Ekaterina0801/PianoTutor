"use client";
import type { MatchRow } from "@/lib/reportTypes";

function fmt(t: number | null | undefined) {
  if (t === null || t === undefined) return "—";
  return `${t.toFixed(2)} с`;
}

export function ErrorList({ matches, limit=40 }: { matches: MatchRow[]; limit?: number }) {
  const items = matches
    .filter((m) => m.status !== "correct")
    .slice(0, limit);

  return (
    <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
      <div className="text-sm font-semibold text-zinc-100">Ошибки</div>
      <div className="mt-1 text-xs text-zinc-400">Пропущенные и лишние ноты, первые {limit}.</div>
      <div className="mt-3 max-h-[260px] overflow-auto text-sm">
        {items.length === 0 ? <div className="text-zinc-500">Ошибок нет</div> : null}
        {items.map((m, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 mb-2">
            <div className="text-zinc-100">
              {m.status === "missed" ? "ПРОПУЩЕНО" : m.status === "extra" ? "ЛИШНЕЕ" : m.status.toUpperCase()}
              <span className="ml-2 text-zinc-300">
                {m.expected ? `эталон ${m.expected.midi_note}` : ""}
                {m.performed ? ` исполнение ${m.performed.midi_note}` : ""}
              </span>
            </div>
            <div className="text-xs text-zinc-400">
              {fmt(m.expected?.onset_s ?? m.performed?.onset_s)} {m.dt_onset_s !== null ? `· сдвиг ${fmt(m.dt_onset_s)}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
