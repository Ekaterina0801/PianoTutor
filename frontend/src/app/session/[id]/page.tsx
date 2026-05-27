"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, Pill, Segmented, Button } from "@/components/ui";
import { AnimatedNumber } from "@/components/animated-number";
import { PianoRoll } from "@/components/piano-roll";
import { ErrorHeatmap } from "@/components/error-heatmap";
import { ErrorList } from "@/components/error-list";
import { KeyboardHeat } from "@/components/keyboard-heat";
import { PitchErrorChart } from "@/components/pitch-error-chart";
import type { SessionDetails } from "@/lib/reportTypes";
import { buildInsights } from "@/lib/reportInsights";
import { alignerLabelRu, assistantLabelRu, decisionLabelRu, sourceLabelRu } from "@/lib/labels";

type View = "tutor" | "analytics";

function KPI({ title, value, sub }: { title: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
      <div className="text-xs text-[rgb(var(--muted))]">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-[rgb(var(--muted))]">{sub}</div> : null}
    </div>
  );
}

function grade(f1: number) {
  if (f1 >= 0.95) return { label: "Отлично", hint: "Остались только мелкие ошибки. Можно немного поднять темп.", tone: "bg-emerald-500/15 border-emerald-500/20" };
  if (f1 >= 0.85) return { label: "Хорошо", hint: "Есть несколько ошибок. Повторите проблемный фрагмент отдельно.", tone: "bg-amber-500/15 border-amber-500/20" };
  return { label: "Нужно потренировать", hint: "Замедлите темп и отдельно проработайте руки или короткие фразы.", tone: "bg-rose-500/15 border-rose-500/20" };
}

function fmtMs(value: unknown, decimals = 1) {
  return typeof value === "number" ? <><AnimatedNumber value={value * 1000} decimals={decimals} /> мс</> : "—";
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionDetails | null>(null);
  const [view, setView] = useState<View>("tutor");
  const [showJson, setShowJson] = useState(false);
  const [range, setRange] = useState<{t0:number;t1:number} | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [filters, setFilters] = useState({correct:true, missed:true, extra:true});

  useEffect(() => {
    const saved = (localStorage.getItem("pt_report_mode") as View | null) ?? null;
    if (saved) setView(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("pt_report_mode", view);
  }, [view]);

  useEffect(() => {
    api.sessionDetails(id).then(setData).catch(()=>setData(null));
  }, [id]);

  const metrics = data?.metrics ?? null;
  const pipeline = data?.pipeline ?? null;
  const expected = data?.events?.expected ?? [];
  const performed = data?.events?.performed ?? [];
  const matches = data?.events?.matches ?? [];

  const ins = useMemo(() => buildInsights(matches as any), [matches]);
  const correct = metrics ? (metrics.correct ?? Math.max(0, expected.length - (metrics.missed ?? 0))) : 0;
  const f1 = metrics?.f1 ?? 0;
  const g = grade(f1);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Отчет сессии"
          subtitle={data ? `${data.exercise_id} · ${data.created_at} · ${sourceLabelRu(data.source)}` : id}
          right={
            <div className="flex items-center gap-2">
              <Segmented value={view} options={[{label:"Учебный", value:"tutor"},{label:"Аналитика", value:"analytics"}] as any} onChange={(v:any)=>setView(v)} />
              {metrics ? <Pill>F1 {f1.toFixed(3)} · {assistantLabelRu(metrics.assistant_mode)}</Pill> : null}
            </div>
          }
        />
        <CardBody>
          {!metrics ? <div className="text-sm text-[rgb(var(--muted))]">Загрузка…</div> : (
            <div className="space-y-4">
              <div className={`rounded-xl2 border p-4 ${g.tone}`}>
                <div className="text-sm font-semibold">{g.label}</div>
                <div className="mt-1 text-xs text-[rgb(var(--muted))]">{g.hint}</div>
              </div>

              
              <div className="grid gap-3 sm:grid-cols-3">
                <KPI title="Совпало" value={<><AnimatedNumber value={correct} /> / <AnimatedNumber value={expected.length} /></>} sub="Корректные ноты" />
                <KPI title="Ошибки" value={<AnimatedNumber value={metrics.missed + metrics.extra} />} sub={`Пропущено ${metrics.missed} · Лишних ${metrics.extra}`} />
                <KPI title="F1" value={<AnimatedNumber value={f1} decimals={3} />} sub="Высота + атака" />
                <KPI title="Средняя ошибка тайминга" value={fmtMs(metrics.mae_s)} sub="Средняя абсолютная ошибка" />
                <KPI title="Тайминг p95" value={fmtMs(metrics.p95_s)} sub="95-й перцентиль" />
                <KPI title="Ошибка длительности" value={fmtMs(metrics.duration_mae_s)} sub={`Оценка ${((metrics.duration_score ?? 0) * 100).toFixed(0)}%`} />
                <KPI title="Ошибка силы нажатия" value={<AnimatedNumber value={(metrics.velocity_mae ?? 0)} decimals={1} />} sub={`Оценка ${((metrics.velocity_score ?? 0) * 100).toFixed(0)}%`} />
                <KPI title="F1 аккордов" value={<AnimatedNumber value={(metrics.chord_f1 ?? 0)} decimals={3} />} sub={`точн. ${(metrics.chord_precision ?? 0).toFixed(2)} · полн. ${(metrics.chord_recall ?? 0).toFixed(2)}`} />
                <KPI title="Левая / правая" value={`${(metrics.left_f1 ?? 0).toFixed(2)} / ${(metrics.right_f1 ?? 0).toFixed(2)}`} sub="F1 по рукам" />
                <KPI title="Устойчивость" value={<AnimatedNumber value={(metrics.robustness_score ?? 0)} decimals={3} />} sub="Сводная исследовательская метрика" />
                <KPI title="Смещение темпа" value={`${(metrics.tempo_drift_pct ?? 0).toFixed(1)}%`} sub="Линейный тренд атак" />
                <KPI title="Корректор" value={assistantLabelRu(metrics.assistant_mode)} sub={decisionLabelRu(pipeline?.assistant?.decision)} />
                <KPI title="Выравнивание" value={alignerLabelRu(metrics.aligner_mode)} sub={pipeline?.aligner?.guard ? `защита: ${decisionLabelRu(pipeline.aligner.guard)}` : "конвейер выравнивания"} />
              </div>


              {view === "tutor" ? (
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-semibold">Чаще пропущено</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ins.topMissed.length ? ins.topMissed.map((x) => <Pill key={x.midi}>{x.name} · {x.count}</Pill>) : <div className="text-xs text-[rgb(var(--muted))]">—</div>}
                    </div>
                  </div>
                  <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-semibold">Чаще лишнее</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ins.topExtra.length ? ins.topExtra.map((x) => <Pill key={x.midi}>{x.name} · {x.count}</Pill>) : <div className="text-xs text-[rgb(var(--muted))]">—</div>}
                    </div>
                  </div>
                  <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-semibold">Проблемное окно</div>
                    <div className="mt-2 text-xs text-[rgb(var(--muted))]">
                      {ins.worstWindow ? `${ins.worstWindow.t0.toFixed(1)} с – ${ins.worstWindow.t1.toFixed(1)} с · ошибок: ${ins.worstWindow.count}` : "—"}
                    </div>
                    <div className="mt-3 text-xs text-[rgb(var(--muted))]">Совет: повторите этот фрагмент отдельно в медленном темпе</div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Пиано-ролл" subtitle="Наведите курсор для подсказок, нажмите тепловую карту для приближения, переключайте слои и фильтры." right={
          <div className="flex items-center gap-2">
            <button onClick={()=>setOverlay(v=>!v)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">{overlay? "Слои":"Раздельно"}</button>
            <button onClick={()=>setFilters(f=>({...f, correct:!f.correct}))} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">Совпало</button>
            <button onClick={()=>setFilters(f=>({...f, missed:!f.missed}))} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">Пропущено</button>
            <button onClick={()=>setFilters(f=>({...f, extra:!f.extra}))} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">Лишнее</button>
            <Pill>{expected.length} эталон · {performed.length} исполнение</Pill>
          </div>
        } />
        <CardBody><PianoRoll expected={expected} performed={performed} matches={matches as any} range={range ?? undefined} overlay={overlay} show={filters} /></CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Тепловая карта" subtitle="Где ошибки группируются во времени." /><CardBody><ErrorHeatmap matches={matches as any} onSelectRange={(r)=>setRange(r)} /></CardBody></Card>
        <Card><CardHeader title="Ошибки" subtitle="Пропущенные и лишние ноты." /><CardBody><ErrorList matches={matches as any} /></CardBody></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Клавиатура ошибок" subtitle="Какие высоты нот чаще всего ошибочны." /><CardBody><KeyboardHeat matches={matches as any} /></CardBody></Card>
        <Card><CardHeader title="Ошибки по высоте" subtitle="Главные проблемные ноты: пропущенные и лишние." /><CardBody><PitchErrorChart matches={matches as any} /></CardBody></Card>
      </div>

      <Card>
        <CardHeader title="Происхождение данных / приложение" subtitle="Сырой JSON для отладки и приложения к ВКР." right={<Button variant="outline" onClick={()=>setShowJson(v=>!v)}>{showJson ? "Скрыть" : "Показать"} JSON</Button>} />
        {showJson ? (
          <CardBody>
            <pre className="max-h-[520px] overflow-auto rounded-xl2 border border-white/10 bg-black/30 p-4 text-xs">
              {JSON.stringify({ metrics, pipeline: data?.pipeline, events: data?.events }, null, 2)}
            </pre>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
