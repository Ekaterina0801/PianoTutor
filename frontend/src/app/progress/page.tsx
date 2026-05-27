"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, Flame, Music2, Sparkles, Star } from "lucide-react";
import { Card, CardBody, CardHeader, HelpTip, Pill } from "@/components/ui";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import { sessionXp } from "@/lib/gamification";
import { useGamificationStats } from "@/lib/use-gamification-stats";
import { BadgeGrid, DailyQuests, LevelHero, LevelRoadmap, LevelTree, NextLessonCallout, WeeklyXP } from "@/components/gamification";

export default function ProgressPage() {
  const [items, setItems] = useState<any[]>([]);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    api.sessions().then(setItems).catch(() => setItems([]));
  }, [user]);

  const stats = useGamificationStats(items);
  const rows = useMemo(() => {
    return stats.sessions.map((s) => ({
      id: s.id,
      exerciseId: s.exerciseId,
      date: s.createdAt ? format(new Date(s.createdAt), "MM-dd HH:mm") : "—",
      f1: Number(s.metrics.f1 ?? 0),
      robustness: Number(s.metrics.robustness_score ?? 0),
      xp: sessionXp(s.metrics),
      missed: Number(s.metrics.missed ?? 0),
      extra: Number(s.metrics.extra ?? 0),
    }));
  }, [stats.sessions]);

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      <LevelHero stats={stats} />

      <LevelTree stats={stats} />

      <div className="grid gap-4 xl:grid-cols-[1fr,0.72fr]">
        <Card>
          <CardHeader
            title="Как меняется точность"
            subtitle="Точность и стабильность по сохраненным попыткам"
            right={<Pill>{rows.length} сессий</Pill>}
            help="F1 показывает, насколько исполнение совпало с эталоном. Стабильность учитывает еще несколько метрик: тайминг, аккорды и длительности."
          />
          <CardBody>
            <div className="h-72 rounded-[1.6rem] border border-white/10 bg-black/20 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rows}>
                  <defs>
                    <linearGradient id="f1Fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#84cc16" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#84cc16" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="robustFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: "#a1a1aa", fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 1]} tick={{ fill: "#a1a1aa", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0b0b0e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16 }} />
                  <Area type="monotone" dataKey="f1" stroke="#84cc16" strokeWidth={3} fill="url(#f1Fill)" />
                  <Area type="monotone" dataKey="robustness" stroke="#22d3ee" strokeWidth={2} fill="url(#robustFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <WeeklyXP stats={stats} />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black tracking-tight">Ежедневные задания</h2>
              <HelpTip text="Это короткие цели на сегодня. Они помогают не думать, с чего начать занятие." />
            </div>
            <div className="text-sm text-[rgb(var(--muted))]">Небольшие цели на одно занятие</div>
          </div>
          <Pill><Sparkles className="mr-1 h-3.5 w-3.5 text-lime-300" /> +XP</Pill>
        </div>
        <DailyQuests quests={stats.quests} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black tracking-tight">Список уровней</h2>
              <HelpTip text="XP начисляется после сохранения отчета. Чем чище попытка, тем быстрее растет уровень." />
            </div>
            <div className="text-sm text-[rgb(var(--muted))]">Порог XP для каждого уровня</div>
          </div>
          <Pill>Уровень {stats.level}</Pill>
        </div>
        <LevelRoadmap stats={stats} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black tracking-tight">Достижения</h2>
              <HelpTip text="Достижения отмечают заметные вещи: первую попытку, регулярность, чистые сессии, аккорды и хороший тайминг." />
            </div>
            <div className="text-sm text-[rgb(var(--muted))]">То, что уже получилось</div>
          </div>
          <Pill>{stats.badges.filter((b) => b.earned).length}/{stats.badges.length}</Pill>
        </div>
        <BadgeGrid badges={stats.badges} />
      </section>

      <NextLessonCallout stats={stats} />

      <section>
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black tracking-tight">История попыток</h2>
            <HelpTip text="Здесь лежат сохраненные отчеты. Можно открыть любую попытку и посмотреть ошибки подробнее." />
          </div>
          <div className="text-sm text-[rgb(var(--muted))]">Сохраненные занятия и отчеты</div>
        </div>
        <div className="space-y-3">
          {[...rows].reverse().map((s, index) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.025 }}
            >
              <Link href={`/session/${s.id}`} className="group flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.045] p-4 transition hover:bg-white/[0.075]">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-lime-300 text-lime-950 shadow-[0_12px_30px_rgba(132,204,22,0.18)]">
                  {s.f1 >= 0.9 ? <Star className="h-5 w-5" /> : s.extra === 0 ? <Flame className="h-5 w-5" /> : <Music2 className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">{s.exerciseId}</div>
                  <div className="mt-1 text-xs text-[rgb(var(--muted))]">{s.date} · пропущено {s.missed} · лишних {s.extra}</div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-black text-lime-200">+{s.xp} XP</div>
                  <div className="text-xs text-[rgb(var(--muted))]">F1 {s.f1.toFixed(3)}</div>
                </div>
                <ChevronRight className="h-5 w-5 text-[rgb(var(--muted))] transition group-hover:translate-x-0.5" />
              </Link>
            </motion.div>
          ))}
          {!rows.length ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 text-sm text-[rgb(var(--muted))]">
              Пока нет сохраненных занятий. Сыграйте упражнение и сохраните отчет — здесь появится прогресс.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
