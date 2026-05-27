"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Award, CheckCircle2, ChevronRight, Crown, Flame, Gem, LockKeyhole, Map, Medal, Play, Sparkles, Star, Target, Trophy, Zap } from "lucide-react";
import type { Badge, GamificationStats, LevelDefinition, Quest } from "@/lib/gamification";
import { Button, HelpTip, Pill } from "@/components/ui";
import { formatInteger } from "@/lib/format";

function pct(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function toneClasses(tone: Quest["tone"]) {
  if (tone === "lime") return "from-lime-300 to-emerald-400 text-lime-950";
  if (tone === "cyan") return "from-cyan-300 to-sky-400 text-cyan-950";
  if (tone === "amber") return "from-amber-300 to-orange-400 text-amber-950";
  return "from-rose-300 to-pink-400 text-rose-950";
}

export function LevelHero({ stats, compact = false }: { stats: GamificationStats; compact?: boolean }) {
  const ring = `conic-gradient(rgb(132 204 22) ${Math.round(stats.levelProgress * 360)}deg, rgba(255,255,255,0.10) 0deg)`;
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(132,204,22,0.22),rgba(34,211,238,0.16)_45%,rgba(251,191,36,0.16))] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.16))]" />
      <div className="relative grid gap-5 md:grid-cols-[auto,1fr,auto] md:items-center">
        <motion.div
          className="grid h-28 w-28 place-items-center rounded-full p-2"
          style={{ background: ring }}
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
        >
          <div className="grid h-full w-full place-items-center rounded-full border border-white/15 bg-zinc-950/80 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <div>
              <div className="text-xs text-lime-200">Уровень</div>
              <div className="text-4xl font-black tabular-nums">{stats.level}</div>
            </div>
          </div>
        </motion.div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill><Crown className="mr-1 h-3.5 w-3.5 text-amber-300" /> {stats.levelTitle}</Pill>
            <Pill><Flame className="mr-1 h-3.5 w-3.5 text-orange-300" /> {stats.streakDays} дн. подряд</Pill>
            <HelpTip text="XP появляется после сохранения отчета. Больше XP дают точные ноты, чистые аккорды и попытки без лишних звуков." />
          </div>
          <h1 className={compact ? "mt-3 text-2xl font-black tracking-tight" : "mt-3 text-4xl font-black tracking-tight lg:text-5xl"}>
            {formatInteger(stats.totalXp)} XP
          </h1>
          <div className="mt-3 max-w-xl text-sm text-zinc-200">
            До следующего уровня: {formatInteger(stats.levelXp)} из {formatInteger(stats.nextLevelXp)} XP. Средняя точность {stats.accuracyPercent}%, верных нот: {formatInteger(stats.notesMastered)}.
          </div>
          <div className="mt-4 h-4 overflow-hidden rounded-full border border-white/10 bg-black/25">
            <motion.div
              className="premium-xp-bar h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: pct(stats.levelProgress) }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1">
          <MiniReward icon={<Zap className="h-4 w-4" />} label="Сегодня" value={`${stats.todayXp} XP`} />
          <MiniReward icon={<Trophy className="h-4 w-4" />} label="Лучший F1" value={stats.bestF1 ? stats.bestF1.toFixed(3) : "—"} />
          <MiniReward icon={<Gem className="h-4 w-4" />} label="Стабильность" value={stats.averageRobustness ? stats.averageRobustness.toFixed(3) : "—"} />
        </div>
      </div>
    </section>
  );
}

function MiniReward({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <motion.div
      whileHover={{ y: -3, scale: 1.02 }}
      className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
    >
      <div className="flex items-center gap-2 text-xs text-zinc-300">{icon}{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
    </motion.div>
  );
}

export function DailyQuests({ quests }: { quests: Quest[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {quests.map((quest, index) => (
        <motion.div
          key={quest.id}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.07, type: "spring", stiffness: 240, damping: 24 }}
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.055] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.18)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black">{quest.title}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">{quest.detail}</div>
            </div>
            <div className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${toneClasses(quest.tone)} shadow-[0_10px_30px_rgba(0,0,0,0.18)]`}>
              {quest.done ? <CheckCircle2 className="h-5 w-5" /> : <Target className="h-5 w-5" />}
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/25">
            <motion.div
              className={`h-full rounded-full bg-gradient-to-r ${toneClasses(quest.tone)}`}
              initial={{ width: 0 }}
              animate={{ width: pct(quest.progress / quest.goal) }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-[rgb(var(--muted))]">
            <span>{Math.min(quest.progress, quest.goal)} / {quest.goal}</span>
            <span className="font-semibold text-lime-200">+{quest.rewardXp} XP</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function LessonPath({ stats }: { stats: GamificationStats }) {
  const nodes = [
    { title: "Разминка", detail: "Гамма до мажор", href: "/practice/scale_c_major", done: stats.sessions.length >= 1, icon: Play },
    { title: "Точность", detail: "F1 0.85+", href: "/practice/scale_c_major", done: stats.averageF1 >= 0.85, icon: Star },
    { title: "Аккорды", detail: "Аккорды до мажор", href: "/practice/chords_c_major", done: stats.bestF1 >= 0.88, icon: Medal },
    { title: "Серия", detail: "3 дня подряд", href: "/progress", done: stats.streakDays >= 3, icon: Flame },
    { title: "Мастерство", detail: "F1 0.95+", href: "/practice/chords_c_major", done: stats.bestF1 >= 0.95, icon: Crown },
  ];
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/20 p-5">
      <div className="absolute left-10 top-12 h-[calc(100%-6rem)] w-1 rounded-full bg-white/10 md:left-1/2 md:top-14 md:h-1 md:w-[calc(100%-7rem)]" />
      <div className="grid gap-4 md:grid-cols-5">
        {nodes.map((node, index) => {
          const Icon = node.icon;
          const locked = !node.done && index > 0 && !nodes[index - 1].done;
          return (
            <Link key={node.title} href={locked ? "/progress" : node.href} className="relative">
              <motion.div
                whileHover={{ y: -5, scale: 1.02 }}
                className="group flex items-center gap-4 rounded-3xl border border-white/10 bg-zinc-950/60 p-4 md:flex-col md:text-center"
              >
                <motion.div
                  className={
                    "grid h-14 w-14 shrink-0 place-items-center rounded-2xl border shadow-[0_14px_35px_rgba(0,0,0,0.22)] " +
                    (node.done ? "border-lime-200/40 bg-lime-300 text-lime-950" : locked ? "border-white/10 bg-white/10 text-zinc-400" : "border-cyan-200/40 bg-cyan-300 text-cyan-950")
                  }
                  animate={node.done ? { scale: [1, 1.06, 1] } : undefined}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                >
                  {locked ? <LockKeyhole className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
                </motion.div>
                <div>
                  <div className="text-sm font-black">{node.title}</div>
                  <div className="mt-1 text-xs text-[rgb(var(--muted))]">{node.detail}</div>
                </div>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function LevelRoadmap({ stats }: { stats: GamificationStats }) {
  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {stats.levels.map((level, index) => (
        <motion.div
          key={level.level}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.035 }}
          className={
            "relative overflow-hidden rounded-3xl border p-4 " +
            (level.current
              ? "border-lime-300/40 bg-lime-300/12 shadow-[0_18px_45px_rgba(132,204,22,0.12)]"
              : level.unlocked
                ? "border-cyan-300/25 bg-cyan-300/10"
                : "border-white/10 bg-white/[0.045]")
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-[rgb(var(--muted))]">Уровень {level.level}</div>
              <div className="mt-1 text-sm font-black">{level.title}</div>
            </div>
            <div className={level.unlocked ? "grid h-10 w-10 place-items-center rounded-2xl bg-lime-300 text-lime-950" : "grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-zinc-400"}>
              {level.unlocked ? <CheckCircle2 className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/20">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-lime-300 via-cyan-300 to-amber-300"
              initial={{ width: 0 }}
              animate={{ width: pct(level.current ? level.progress : level.unlocked ? 1 : 0) }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-[rgb(var(--muted))]">
            <span>{formatInteger(level.requiredXp)} XP</span>
            <span>{formatInteger(level.nextRequiredXp)} XP</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function LevelTreeNode({ level, index }: { level: LevelDefinition; index: number }) {
  const active = level.current;
  const locked = !level.unlocked;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.025, type: "spring", stiffness: 220, damping: 22 }}
      className="relative min-w-0"
    >
      <div
        className={
          "relative flex min-h-[116px] flex-col overflow-hidden rounded-2xl border p-3 shadow-[0_18px_45px_rgba(0,0,0,0.20)] " +
          (active
            ? "border-lime-200/60 bg-lime-300 text-lime-950"
            : level.unlocked
              ? "border-cyan-300/35 bg-cyan-300/12 text-zinc-50"
              : "border-white/10 bg-zinc-950/80 text-zinc-400")
        }
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className={active ? "text-[10px] font-black uppercase text-lime-900/70" : "text-[10px] font-black uppercase text-[rgb(var(--muted))]"}>
              {level.chapter}
            </div>
            <div className="mt-1 text-sm font-black leading-tight">{level.level}. {level.title}</div>
          </div>
          <div className={active ? "grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-lime-950 text-lime-200" : level.unlocked ? "grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-cyan-300 text-cyan-950" : "grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10"}>
            {locked ? <LockKeyhole className="h-4 w-4" /> : active ? <Crown className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          </div>
        </div>
        <div className={active ? "mt-2 line-clamp-2 text-[11px] leading-snug text-lime-950/80" : "mt-2 line-clamp-2 text-[11px] leading-snug text-[rgb(var(--muted))]"}>
          {level.perk}
        </div>
        <div className={active ? "mt-auto h-1.5 overflow-hidden rounded-full bg-lime-950/20" : "mt-auto h-1.5 overflow-hidden rounded-full bg-black/25"}>
          <motion.div
            className={active ? "h-full rounded-full bg-lime-950" : "h-full rounded-full bg-gradient-to-r from-lime-300 to-cyan-300"}
            initial={{ width: 0 }}
            animate={{ width: pct(active ? level.progress : level.unlocked ? 1 : 0) }}
          />
        </div>
      </div>
    </motion.div>
  );
}

export function LevelTree({ stats }: { stats: GamificationStats }) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(132,204,22,0.08),rgba(251,191,36,0.08))] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black tracking-tight">Дерево уровней</h2>
            <HelpTip text="Уровни открываются за XP. Каждый уровень просто подсказывает, на что обратить внимание дальше: темп, чистоту нот, аккорды или регулярность занятий." />
          </div>
          <div className="text-sm text-[rgb(var(--muted))]">Небольшая карта прогресса: где вы сейчас и что откроется дальше</div>
        </div>
        <Pill><Map className="mr-1 h-3.5 w-3.5 text-cyan-300" /> {stats.levels.filter((l) => l.unlocked).length}/{stats.levels.length}</Pill>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.levels.map((level, index) => <LevelTreeNode key={level.level} level={level} index={index} />)}
      </div>
    </div>
  );
}

export function BadgeGrid({ badges }: { badges: Badge[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {badges.map((badge) => (
        <motion.div
          key={badge.id}
          whileHover={{ y: -4 }}
          className={"rounded-3xl border p-4 " + (badge.earned ? "border-amber-300/30 bg-amber-300/10" : "border-white/10 bg-white/[0.045]")}
        >
          <div className="flex items-start gap-3">
            <div className={"grid h-11 w-11 place-items-center rounded-2xl " + (badge.earned ? "bg-amber-300 text-amber-950" : "bg-white/10 text-zinc-400")}>
              {badge.earned ? <Award className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-black">{badge.title}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">{badge.detail}</div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/20">
            <motion.div
              className={badge.earned ? "h-full rounded-full bg-amber-300" : "h-full rounded-full bg-cyan-300"}
              initial={{ width: 0 }}
              animate={{ width: pct(badge.progress) }}
            />
          </div>
          <div className="mt-2 text-xs text-[rgb(var(--muted))]">{Math.round(badge.progress * 100)}% условия</div>
        </motion.div>
      ))}
    </div>
  );
}

export function WeeklyXP({ stats }: { stats: GamificationStats }) {
  const maxXp = Math.max(120, ...stats.weekly.map((d) => d.xp));
  return (
    <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-black">Неделя XP</div>
          <div className="text-xs text-[rgb(var(--muted))]">Лучше понемногу, но чаще</div>
        </div>
        <Sparkles className="h-5 w-5 text-lime-300" />
      </div>
      <div className="flex h-44 items-end gap-2">
        {stats.weekly.map((day) => (
          <div key={day.label} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-32 w-full items-end rounded-2xl bg-white/5 p-1">
              <motion.div
                className="w-full rounded-xl bg-gradient-to-t from-lime-400 via-cyan-300 to-amber-200"
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(8, (day.xp / maxXp) * 100)}%` }}
                transition={{ type: "spring", stiffness: 130, damping: 18 }}
                title={`${day.xp} XP`}
              />
            </div>
            <div className="text-[11px] font-semibold text-[rgb(var(--muted))]">{day.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NextLessonCallout({ stats }: { stats: GamificationStats }) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(132,204,22,0.12),rgba(251,191,36,0.12))] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-black">Следующий шаг</div>
          <div className="mt-1 text-2xl font-black tracking-tight">{stats.nextLesson.title}</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">{stats.nextLesson.subtitle}</div>
        </div>
        <Link href={stats.nextLesson.href}>
          <Button className="w-full sm:w-auto">
            Начать <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
