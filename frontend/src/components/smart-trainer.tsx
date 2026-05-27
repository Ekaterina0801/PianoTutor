"use client";
import { useMemo, useState } from "react";
import type { NoteEvent } from "@/lib/types";
import { Button, Pill } from "@/components/ui";

type Hand = "both" | "left" | "right";

function splitHand(n: NoteEvent): Hand {
  return n.midi_note < 60 ? "left" : "right";
}

export function SmartTrainer({
  expected,
  onSetRange,
}: {
  expected: NoteEvent[];
  onSetRange: (r: { t0: number; t1: number }) => void;
}) {
  const [hand, setHand] = useState<Hand>("both");
  const [loop, setLoop] = useState(true);
  const [t0, setT0] = useState(0);
  const [t1, setT1] = useState(8);
  const [bpm, setBpm] = useState(80);
  const [ramp, setRamp] = useState(true);

  const filtered = useMemo(() => {
    const xs = expected.filter((e) => e.onset_s >= t0 && e.onset_s <= t1);
    if (hand === "both") return xs;
    return xs.filter((e) => splitHand(e) === hand);
  }, [expected, t0, t1, hand]);

  return (
    <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Умная практика</div>
          <div className="mt-1 text-xs text-zinc-400">Повторяйте фрагмент, выбирайте руки и постепенно поднимайте темп</div>
        </div>
        <div className="flex gap-2">
          <Button variant={hand==="both" ? "primary":"outline"} onClick={()=>setHand("both")}>Обе</Button>
          <Button variant={hand==="left" ? "primary":"outline"} onClick={()=>setHand("left")}>Левая</Button>
          <Button variant={hand==="right" ? "primary":"outline"} onClick={()=>setHand("right")}>Правая</Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl2 border border-white/10 bg-white/5 p-3">
          <div className="text-xs text-zinc-400">Диапазон повтора, секунды</div>
          <div className="mt-2 flex items-center gap-2">
            <input className="w-full" type="number" value={t0} step={0.5} min={0} onChange={(e)=>setT0(Number(e.target.value))} />
            <span className="text-xs text-zinc-400">→</span>
            <input className="w-full" type="number" value={t1} step={0.5} min={0} onChange={(e)=>setT1(Number(e.target.value))} />
          </div>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={()=>{ setLoop(true); onSetRange({t0, t1}); }}>Применить диапазон</Button>
            <Button variant={loop ? "primary":"outline"} onClick={()=>setLoop(!loop)}>{loop ? "Повтор включен":"Повтор выключен"}</Button>
          </div>
        </div>

        <div className="rounded-xl2 border border-white/10 bg-white/5 p-3">
          <div className="text-xs text-zinc-400">Темп</div>
          <div className="mt-2 flex items-center gap-3">
            <input type="range" min={40} max={160} value={bpm} onChange={(e)=>setBpm(Number(e.target.value))} className="w-full" />
            <div className="text-sm font-semibold">{bpm} уд/мин</div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button variant={ramp ? "primary":"outline"} onClick={()=>setRamp(!ramp)}>{ramp ? "Разгон включен":"Разгон выключен"}</Button>
            <Pill>{filtered.length} нот в диапазоне</Pill>
          </div>
          <div className="mt-2 text-[11px] text-zinc-400">
            Разгон пока работает как настройка интерфейса; следующий шаг — адаптивный темп по точности
          </div>
        </div>
      </div>
    </div>
  );
}
