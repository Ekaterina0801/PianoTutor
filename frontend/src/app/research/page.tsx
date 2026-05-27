"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Microscope, Play } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth";
import { Button, Card, CardBody, CardHeader, Pill } from "@/components/ui";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function fmt(x: any, d = 3) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

function pctDelta(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}`;
}

function toneDelta(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n) || Math.abs(n) < 0.001) return "text-[rgb(var(--muted))]";
  return n > 0 ? "text-emerald-300" : "text-rose-300";
}

function shortConfig(config = "") {
  const [assistant = "", aligner = ""] = config.split("+");
  const a: Record<string, string> = {
    off: "Без",
    heuristic: "Эврист.",
    tcn: "TCN",
    tcn_fallback: "TCN резерв",
    bilstm: "BiLSTM",
    bilstm_fallback: "BiLSTM резерв",
    transformer: "Трансф.",
    transformer_fallback: "Трансф. резерв",
    experimental: "Эксп.",
  };
  const b: Record<string, string> = {
    offset: "Сдвиг",
    linear_dtw: "DTW",
    safe_linear_dtw: "Безопасн.",
  };
  return `${a[assistant] ?? assistant}/${b[aligner] ?? aligner}`;
}

function configFullLabel(config = "") {
  const [assistant = "", aligner = ""] = config.split("+");
  const a: Record<string, string> = {
    off: "Без корректора",
    heuristic: "Эвристический корректор",
    tcn: "TCN",
    tcn_fallback: "TCN, резервный режим",
    bilstm: "BiLSTM",
    bilstm_fallback: "BiLSTM, резервный режим",
    transformer: "Transformer",
    transformer_fallback: "Transformer, резервный режим",
    experimental: "Экспериментальный",
  };
  const b: Record<string, string> = {
    offset: "смещение",
    linear_dtw: "линейный DTW",
    safe_linear_dtw: "безопасный DTW",
  };
  return `${a[assistant] ?? assistant}${aligner ? ` + ${b[aligner] ?? aligner}` : ""}`;
}

function ConfigBadge({ config }: { config: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate font-semibold">{shortConfig(config)}</span>
      <span className="truncate text-[11px] text-[rgb(var(--muted))]" title={configFullLabel(config)}>
        {configFullLabel(config)}
      </span>
    </div>
  );
}

function FindingCard({
  title,
  value,
  detail,
  tone = "neutral",
}: {
  title: string;
  value: string;
  detail: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
      : tone === "bad"
        ? "border-rose-400/25 bg-rose-400/10 text-rose-100"
        : "border-white/10 bg-black/20 text-[rgb(var(--fg))]";
  return (
    <div className={`rounded-xl2 border p-4 ${toneClass}`}>
      <div className="text-xs text-[rgb(var(--muted))]">{title}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="mt-2 text-sm leading-relaxed text-[rgb(var(--muted))]">{detail}</div>
    </div>
  );
}

export default function ResearchPage() {
  const { hasRole } = useAuth();
  const [status, setStatus] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [current, setCurrent] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!hasRole("researcher", "admin")) return;
    const [s, r] = await Promise.all([api.researchStatus(), api.researchRuns()]);
    setStatus(s);
    setRuns(r);
  };

  useEffect(() => { load().catch(()=>{}); }, [hasRole]);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.runBenchmark({
        samples: 24,
        seed: 42,
        seed_count: 5,
        jitter_s: 0.045,
        miss_prob: 0.08,
        extra_prob: 0.06,
        aligner_modes: ["offset", "linear_dtw", "safe_linear_dtw"],
      });
      setCurrent(res);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const leaderboard = useMemo(() => current?.metrics?.leaderboard ?? runs[0]?.metrics?.leaderboard ?? [], [current, runs]);
  const metrics = useMemo(() => current?.metrics ?? runs[0]?.metrics ?? null, [current, runs]);
  const best = metrics?.best ?? leaderboard[0] ?? null;
  const diagnostics = metrics?.diagnostics ?? {};
  const tcnBest = useMemo(
    () => leaderboard.find((row: any) => String(row.config).startsWith("tcn+") || String(row.config).startsWith("tcn_fallback+")),
    [leaderboard],
  );
  const rawDtwWorst = useMemo(
    () => leaderboard
      .filter((row: any) => String(row.config).endsWith("+linear_dtw"))
      .sort((a: any, b: any) => Number(a.delta_robustness ?? 0) - Number(b.delta_robustness ?? 0))[0],
    [leaderboard],
  );
  const bestChord = useMemo(
    () => [...leaderboard].sort((a: any, b: any) => Number(b.chord_f1 ?? 0) - Number(a.chord_f1 ?? 0))[0],
    [leaderboard],
  );
  const chartRows = useMemo(
    () => leaderboard.map((row: any) => ({ ...row, chart_label: shortConfig(row.config) })),
    [leaderboard],
  );
  const markdown = useMemo(() => {
    const lines = ["# Исследовательский бенчмарк", "", "| Конфиг | F1 | ΔF1 | F1 аккордов | MAE, с | Устойчивость | Δ устойчивости |", "|---|---:|---:|---:|---:|---:|---:|"];
    for (const row of leaderboard) lines.push(`| ${configFullLabel(row.config)} | ${fmt(row.f1)} ± ${fmt(row.f1_std)} | ${pctDelta(row.delta_f1)} | ${fmt(row.chord_f1)} | ${fmt(row.mae_s)} | ${fmt(row.robustness_score)} ± ${fmt(row.robustness_std)} | ${pctDelta(row.delta_robustness)} |`);
    return lines.join("\n");
  }, [leaderboard]);

  if (!hasRole("researcher", "admin")) {
    return <Card><CardHeader title="Исследовательская лаборатория" subtitle="Нужна роль исследователя или администратора." /><CardBody><div className="text-sm text-[rgb(var(--muted))]">Войдите под researcher@piano.local или admin@piano.local.</div></CardBody></Card>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Исследовательская лаборатория"
          subtitle="Многостартовый бенчмарк, ablation и оценка обработки данных до/после нейросети."
          right={<Pill>{status?.bilstm_available && status?.transformer_available ? "Нейросетевые контрольные точки готовы" : "Резервный режим нейросетей"}</Pill>}
        />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-[rgb(var(--muted))]">Учитель AMT</div>
              <div className="mt-1 text-lg font-semibold">{status?.teacher_amt ?? "—"}</div>
            </div>
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-[rgb(var(--muted))]">Корректоры</div>
              <div className="mt-1 truncate text-sm font-semibold" title={status?.corrector_checkpoint ?? ""}>{status?.corrector_checkpoint ?? "—"}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                BiLSTM {status?.bilstm_available ? "готов" : "резерв"} · Transformer {status?.transformer_available ? "готов" : "резерв"}
              </div>
            </div>
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-[rgb(var(--muted))]">Лучший запуск</div>
              <div className="mt-1 text-lg font-semibold">{best?.config ? shortConfig(best.config) : "—"}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">Δ устойчивости {pctDelta(best?.delta_robustness)} · паттернов: {diagnostics.total_patterns ?? "—"}</div>
            </div>
          </div>
          {status && !status.tcn_available ? (
            <div className="mt-4 rounded-xl2 border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
              Контрольная точка TCN не найдена: режим отображается как <b>TCN, резервный режим</b>, чтобы не выдавать резервный режим за обученную нейросеть
            </div>
          ) : null}
          {status && (!status.bilstm_available || !status.transformer_available) ? (
            <div className="mt-4 rounded-xl2 border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
              Контрольная точка BiLSTM/Transformer не найдена: соответствующий режим будет отмечен как резервный
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={run} disabled={busy}><Play className="h-4 w-4" /> {busy ? "Запуск..." : "Запустить бенчмарк"}</Button>
            <Button variant="outline" onClick={()=>navigator.clipboard?.writeText(markdown)}><Download className="h-4 w-4" /> Скопировать Markdown</Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Выводы запуска"
          subtitle="Автоматическая интерпретация бенчмарка: лучший режим, вклад нейросети и рискованные отключения модулей."
          right={<Pill>{diagnostics.total_patterns ?? 0} паттернов</Pill>}
        />
        <CardBody>
          <div className="grid gap-3 lg:grid-cols-4">
            <FindingCard
              title="Лучший режим"
              value={best?.config ? shortConfig(best.config) : "—"}
              detail={`F1 ${fmt(best?.f1)} · ΔF1 ${pctDelta(best?.delta_f1)} · устойчивость ${fmt(best?.robustness_score)}.`}
              tone={Number(best?.delta_robustness ?? 0) > 0 ? "good" : "neutral"}
            />
            <FindingCard
              title="Вклад TCN"
              value={tcnBest?.config ? shortConfig(tcnBest.config) : "—"}
              detail={`Δ устойчивости ${pctDelta(tcnBest?.delta_robustness)} · F1 аккордов ${fmt(tcnBest?.chord_f1)}. ${status?.tcn_available ? "Используется обученная контрольная точка." : "Пока работает резервный режим."}`}
              tone={Number(tcnBest?.delta_robustness ?? 0) > 0 ? "good" : "neutral"}
            />
            <FindingCard
              title="Аккорды"
              value={bestChord?.config ? shortConfig(bestChord.config) : "—"}
              detail={`Лучший F1 аккордов ${fmt(bestChord?.chord_f1)} · Δ аккордов ${pctDelta(bestChord?.delta_chord_f1)}.`}
              tone={Number(bestChord?.delta_chord_f1 ?? 0) > 0 ? "good" : "neutral"}
            />
            <FindingCard
              title="Риск DTW"
              value={rawDtwWorst?.config ? shortConfig(rawDtwWorst.config) : "—"}
              detail={`Сырой linear_dtw показывает Δ устойчивости ${pctDelta(rawDtwWorst?.delta_robustness)}; безопасная политика оставлена как защита от переискажения времени.`}
              tone={Number(rawDtwWorst?.delta_robustness ?? 0) < 0 ? "bad" : "neutral"}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Таблица лидеров" subtitle="Среднее ± стандартное отклонение по нескольким seed; Δ считается относительно off+offset." right={<Microscope className="h-5 w-5 text-[rgb(var(--muted))]" />} />
        <CardBody>
          <div className="h-[320px] rounded-xl2 border border-white/10 bg-black/20 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 12, bottom: 10, left: 0 }}>
                <XAxis dataKey="chart_label" tick={{ fill: "#a1a1aa", fontSize: 11 }} interval={0} height={42} />
                <YAxis domain={[0, 1]} tick={{ fill: "#a1a1aa", fontSize: 10 }} />
                <Tooltip
                  labelFormatter={(_, payload: any) => configFullLabel(payload?.[0]?.payload?.config ?? "")}
                  contentStyle={{ background: "#0b0b0e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar dataKey="robustness_score" name="Устойчивость" fill="#22d3ee" />
                <Bar dataKey="f1" name="F1" fill="#a3e635" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-[rgb(var(--muted))]">Политика безопасного выравнивания</div>
              <div className="mt-1 text-sm">{diagnostics.safe_aligner_policy ?? "—"}</div>
            </div>
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-[rgb(var(--muted))]">Сиды × примеры</div>
              <div className="mt-1 text-sm">{diagnostics.seed_count ?? metrics?.seed_count ?? "—"} × {diagnostics.samples_per_seed ?? metrics?.samples ?? "—"}</div>
            </div>
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-[rgb(var(--muted))]">База сравнения</div>
              <div className="mt-1 text-sm">Без корректора + смещение · устойчивость {fmt(metrics?.baseline?.robustness_score)}</div>
            </div>
          </div>
          <div className="mt-4 max-w-full overflow-x-auto rounded-xl2 border border-white/10">
            <table className="w-full min-w-[860px] table-fixed text-left text-sm">
              <thead className="bg-white/5 text-xs text-[rgb(var(--muted))]">
                <tr><th className="w-[190px] p-3">Конфиг</th><th className="w-[104px] p-3">F1 ± ст. откл.</th><th className="w-[76px] p-3">ΔF1</th><th className="w-[112px] p-3">F1 аккордов</th><th className="w-[82px] p-3">MAE, мс</th><th className="w-[100px] p-3">Левая/правая</th><th className="w-[132px] p-3">Устойчивость</th><th className="w-[76px] p-3">Δ уст.</th><th className="w-[90px] p-3">Безопасн.</th></tr>
              </thead>
              <tbody>
                {leaderboard.map((r:any)=>(
                  <tr key={r.config} className="border-t border-white/10">
                    <td className="p-3"><ConfigBadge config={r.config} /></td>
                    <td className="p-3 tabular-nums">{fmt(r.f1)} ± {fmt(r.f1_std)}</td>
                    <td className={`p-3 tabular-nums ${toneDelta(r.delta_f1)}`}>{pctDelta(r.delta_f1)}</td>
                    <td className="p-3 tabular-nums">{fmt(r.chord_f1)} ± {fmt(r.chord_f1_std)}</td>
                    <td className="p-3 tabular-nums">{fmt((r.mae_s ?? 0)*1000, 1)} мс</td>
                    <td className="p-3 tabular-nums">{fmt(r.left_f1, 2)} / {fmt(r.right_f1, 2)}</td>
                    <td className="p-3 tabular-nums">{fmt(r.robustness_score)} ± {fmt(r.robustness_std)}</td>
                    <td className={`p-3 tabular-nums ${toneDelta(r.delta_robustness)}`}>{pctDelta(r.delta_robustness)}</td>
                    <td className="p-3 tabular-nums">{r.safe_warp_accept_rate == null ? "—" : `${fmt(r.safe_warp_accept_rate * 100, 0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="История запусков" subtitle="Исследовательские запуски сохраняются в SQLite для воспроизводимости в дипломной работе." right={<Pill>{runs.length}</Pill>} />
        <CardBody>
          <div className="space-y-2">
            {runs.map((r)=><div key={r.id} className="rounded-xl2 border border-white/10 bg-black/20 p-3 text-sm"><div className="font-semibold">{r.name}</div><div className="mt-1 text-xs text-[rgb(var(--muted))]">{r.created_at} · лучший {r.metrics?.best?.config ? configFullLabel(r.metrics.best.config) : "—"} · устойчивость {(r.metrics?.best?.robustness_score ?? 0).toFixed(3)}</div></div>)}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
