"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, AudioLines, KeyboardMusic, Sparkles, Target, Trophy } from "lucide-react";
import { Button, HelpTip, Pill } from "@/components/ui";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import { useGamificationStats } from "@/lib/use-gamification-stats";
import { DailyQuests, LessonPath, LevelHero, NextLessonCallout, WeeklyXP } from "@/components/gamification";

export default function Home() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      return;
    }
    api.sessions().then(setSessions).catch(() => setSessions([]));
  }, [user]);

  const stats = useGamificationStats(sessions);

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      <LevelHero stats={stats} />

      <div className="grid gap-4 lg:grid-cols-[1.15fr,0.85fr]">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Pill><Sparkles className="mr-1 h-3.5 w-3.5 text-lime-300" /> Игровой маршрут</Pill>
              <div className="mt-3 flex items-center gap-2">
                <h2 className="text-2xl font-black tracking-tight">Практика как серия уровней</h2>
                <HelpTip text="Начните с упражнения, выберите источник ввода: экранное пианино, MIDI, микрофон или файл. После сохранения отчета вы получите XP, уровень и достижения" />
              </div>
              <p className="mt-2 max-w-xl text-sm text-[rgb(var(--muted))]">
                Набирайте XP за точные попытки, закрывайте ежедневные задания и двигайтесь по карте навыков
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/tour">
                <Button variant="outline">Показать тур</Button>
              </Link>
              <Link href={user ? stats.nextLesson.href : "/login"}>
                <Button>{user ? "Продолжить" : "Войти"} <ArrowRight className="h-4 w-4" /></Button>
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <FeatureMetric icon={<KeyboardMusic className="h-5 w-5" />} title="MIDI вживую" value="точные события" />
            <FeatureMetric icon={<AudioLines className="h-5 w-5" />} title="Аудио AMT" value="аудио → ноты" />
            <FeatureMetric icon={<Trophy className="h-5 w-5" />} title="Ablation" value="5 корректоров" />
          </div>
        </section>

        <NextLessonCallout stats={stats} />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black tracking-tight">Ежедневные задания</h2>
            <div className="text-sm text-[rgb(var(--muted))]">Короткие цели на сегодня</div>
          </div>
          <Pill><Target className="mr-1 h-3.5 w-3.5 text-cyan-300" /> {stats.quests.filter((q) => q.done).length}/{stats.quests.length}</Pill>
        </div>
        <DailyQuests quests={stats.quests} />
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-xl font-black tracking-tight">Маршрут навыков</h2>
          <div className="text-sm text-[rgb(var(--muted))]">Прогресс от первой гаммы до стабильных аккордов</div>
        </div>
        <LessonPath stats={stats} />
      </section>

      <WeeklyXP stats={stats} />
    </div>
  );
}

function FeatureMetric({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between text-[rgb(var(--muted))]">
        <span className="text-xs">{title}</span>
        {icon}
      </div>
      <div className="mt-2 text-lg font-black">{value}</div>
    </div>
  );
}
