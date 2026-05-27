"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import type { Exercise } from "@/lib/types";
import { Card, CardBody, CardHeader, Button, Pill } from "@/components/ui";

export default function LibraryPage() {
  const [items, setItems] = useState<Exercise[]>([]);
  const [q, setQ] = useState("");
  const [maxDiff, setMaxDiff] = useState<number>(5);

  useEffect(() => {
    api.exercises().then(setItems).catch(() => setItems([]));
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((e) => {
      const okQ = !s || (e.title.toLowerCase().includes(s) || (e.tags?.join(" ").toLowerCase().includes(s)));
      const okD = e.difficulty <= maxDiff;
      return okQ && okD;
    });
  }, [items, q, maxDiff]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Библиотека" subtitle="Упражнения для адаптивной практики и исследовательского эталона" />
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск гамм, аккордов, тегов…"
                className="w-full rounded-xl2 border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-white/10"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              Сложность ≤
              <input type="range" min={1} max={5} value={maxDiff} onChange={(e)=>setMaxDiff(Number(e.target.value))} />
              <span className="w-5 text-right">{maxDiff}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {filtered.map((e) => (
          <Card key={e.id}>
            <CardHeader
              title={e.title}
              subtitle={`${e.composer ?? "Упражнение"} · сложность ${e.difficulty}${e.tempo_bpm ? ` · ${e.tempo_bpm} BPM` : ""}`}
              right={<Pill>{e.tags?.[0] ?? "практика"}</Pill>}
            />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {(e.tags || []).slice(0, 5).map((t) => <Pill key={t}>{t}</Pill>)}
              </div>
              <div className="mt-4 flex gap-2">
                <Link href={`/practice/${e.id}`}><Button>Практика</Button></Link>
                <Link href={`/progress?exercise=${e.id}`}><Button variant="outline">Прогресс</Button></Link>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
