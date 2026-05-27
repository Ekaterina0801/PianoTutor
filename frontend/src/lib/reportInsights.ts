import type { MatchRow } from "@/lib/reportTypes";

const NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
export function midiToName(n: number) {
  const octave = Math.floor(n/12) - 1;
  return `${NAMES[n%12]}${octave}`;
}

function topK(map: Map<number, number>, k=5) {
  return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,k);
}

export function buildInsights(matches: MatchRow[]) {
  const missed = new Map<number, number>();
  const extra = new Map<number, number>();

  for (const m of matches) {
    if (m.status === "missed" && m.expected) missed.set(m.expected.midi_note, (missed.get(m.expected.midi_note) ?? 0) + 1);
    if (m.status === "extra" && m.performed) extra.set(m.performed.midi_note, (extra.get(m.performed.midi_note) ?? 0) + 1);
  }

  const topMissed = topK(missed).map(([m,c])=>({midi:m, name:midiToName(m), count:c}));
  const topExtra = topK(extra).map(([m,c])=>({midi:m, name:midiToName(m), count:c}));

  const errs = matches.filter(m=>m.status!=="correct").map(m => m.expected?.onset_s ?? m.performed?.onset_s ?? 0);
  let worstWindow = null as null | {t0:number;t1:number;count:number};
  if (errs.length) {
    const t0 = Math.min(...errs), t1 = Math.max(...errs);
    const bins = 12;
    const v = Array(bins).fill(0);
    for (const t of errs) {
      const idx = Math.min(bins-1, Math.max(0, Math.floor(((t - t0)/Math.max(1e-6,(t1-t0)))*bins)));
      v[idx] += 1;
    }
    let bestI = 0;
    for (let i=1;i<bins;i++) if (v[i]>v[bestI]) bestI=i;
    const a0 = t0 + (bestI/bins)*(t1-t0);
    const a1 = t0 + ((bestI+1)/bins)*(t1-t0);
    worstWindow = {t0:a0, t1:a1, count:v[bestI]};
  }

  return { topMissed, topExtra, worstWindow };
}
