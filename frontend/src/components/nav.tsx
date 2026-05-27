"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Music2, LibraryBig, LineChart, FlaskConical, Settings, Piano, Sun, Moon, Shield, Microscope, LogOut, LogIn, Flame, Crown, Zap, Sparkles } from "lucide-react";
import { useTheme } from "@/components/theme";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";
import { useGamificationStats } from "@/lib/use-gamification-stats";
import { roleLabel } from "@/lib/labels";
import { formatInteger } from "@/lib/format";

const tabs = [
  { href: "/", label: "Панель", icon: Piano },
  { href: "/library", label: "Библиотека", icon: LibraryBig },
  { href: "/progress", label: "Прогресс", icon: LineChart },
  { href: "/tour", label: "Тур", icon: Sparkles },
  { href: "/lab", label: "Лаборатория", icon: FlaskConical },
  { href: "/research", label: "Исследования", icon: Microscope, roles: ["researcher", "admin"] },
  { href: "/admin", label: "Админка", icon: Shield, roles: ["admin"] },
  { href: "/settings", label: "Настройки", icon: Settings },
];

export function Nav() {
  const p = usePathname();
  const { theme, toggle } = useTheme();
  const { user, logout, hasRole } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const visibleTabs = tabs.filter((t: any) => !t.roles || hasRole(...t.roles));
  const stats = useGamificationStats(sessions);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      return;
    }
    api.sessions().then(setSessions).catch(() => setSessions([]));
  }, [user]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:block lg:w-72">
        <div className="h-full p-4">
          <div className="surface gradient-border h-full rounded-3xl p-4 backdrop-blur-xl">
            <Link href="/" className="flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-white/5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                <Music2 className="h-5 w-5" />
              </span>
              <div>
                <div className="font-semibold leading-tight">Пианист</div>
                <div className="text-xs text-[rgb(var(--muted))]">Занятия на пианино</div>
              </div>
            </Link>

            <nav className="mt-4 space-y-1">
              {visibleTabs.map((t) => {
                const active = p === t.href;
                const Icon = t.icon;
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={
                      "relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition " +
                      (active ? "text-zinc-950" : "text-[rgb(var(--muted))] hover:bg-white/5")
                    }
                  >
                    {active ? (
                      <motion.span
                        layoutId="sidepill"
                        className="absolute inset-0 rounded-2xl bg-white"
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    ) : null}
                    <span className="relative flex items-center gap-3">
                      <Icon className="h-4 w-4" />
                      {t.label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto pt-4">
              {user ? (
                <Link href="/progress" className="reward-pop mb-3 block rounded-3xl border border-lime-300/20 bg-[linear-gradient(135deg,rgba(132,204,22,0.18),rgba(34,211,238,0.11),rgba(251,191,36,0.10))] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-lime-200"><Crown className="h-3.5 w-3.5" /> Уровень {stats.level}</div>
                      <div className="mt-1 text-lg font-black">{formatInteger(stats.totalXp)} XP</div>
                    </div>
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-lime-300 text-lime-950">
                      <Zap className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/25">
                    <motion.div
                      className="premium-xp-bar h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.round(stats.levelProgress * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-[rgb(var(--muted))]">
                    <span>{stats.levelTitle}</span>
                    <span className="inline-flex items-center gap-1"><Flame className="h-3 w-3 text-orange-300" /> {stats.streakDays}</span>
                  </div>
                </Link>
              ) : null}
              <button
                onClick={toggle}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                title="Переключить тему"
              >
                <span className="text-[rgb(var(--muted))]">Тема</span>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              {user ? (
                <div className="mt-3 space-y-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-xs font-semibold">{user.name}</div>
                    <div className="text-[11px] text-[rgb(var(--muted))]">{roleLabel(user.role)} · {user.email}</div>
                  </div>
                  <button onClick={logout} className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                    <span className="text-[rgb(var(--muted))]">Выйти</span>
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Link href="/login" className="mt-3 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                  <span className="text-[rgb(var(--muted))]">Войти</span>
                  <LogIn className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile topbar */}
      <header className="lg:hidden sticky top-0 z-40">
        <div className="px-4 pt-4">
          <div className="surface flex items-center justify-between rounded-3xl px-4 py-3 backdrop-blur-xl">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/10">
                <Music2 className="h-5 w-5" />
              </span>
              Пианист
            </Link>
            <div className="flex items-center gap-2">
              {user ? (
                <Link href="/progress" className="rounded-2xl border border-lime-300/20 bg-lime-300/15 px-3 py-2 text-xs font-black text-lime-100">
                  Ур. {stats.level} · {stats.totalXp} XP
                </Link>
              ) : null}
              <button
                onClick={toggle}
                className="rounded-2xl border border-white/10 bg-white/5 p-2 hover:bg-white/10"
                title="Переключить тему"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 p-4">
        <div className="surface mx-auto max-w-xl rounded-3xl px-3 py-2 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            {visibleTabs.slice(0,5).map((t) => {
              const active = p === t.href;
              const Icon = t.icon;
              return (
                <Link key={t.href} href={t.href} className={"flex flex-col items-center gap-1 rounded-2xl px-3 py-2 text-xs " + (active ? "bg-white text-zinc-950" : "text-[rgb(var(--muted))]")}>
                  <Icon className="h-4 w-4" />
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
