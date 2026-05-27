"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertCircle, ArrowRight, Crown, Flame, LineChart, Shield, Trophy, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth";
import { Card, CardBody, CardHeader, HelpTip, Pill } from "@/components/ui";
import { computeGamification, sessionXp } from "@/lib/gamification";
import { roleLabel } from "@/lib/labels";
import { formatInteger } from "@/lib/format";
import type { User } from "@/lib/types";

type UserProgress = {
  user: User;
  sessions: any[];
  stats: ReturnType<typeof computeGamification>;
  lastSession: any | null;
  lastSeenLabel: string;
  risk: "active" | "watch" | "inactive";
};

function statusLabel(risk: UserProgress["risk"]) {
  if (risk === "active") return "активен";
  if (risk === "watch") return "нужно внимание";
  return "нет практики";
}

function riskClass(risk: UserProgress["risk"]) {
  if (risk === "active") return "border-lime-300/30 bg-lime-300/10 text-lime-100";
  if (risk === "watch") return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  return "border-rose-300/30 bg-rose-300/10 text-rose-100";
}

function KPI({ title, value, sub, icon }: { title: string; value: string; sub: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between text-xs text-[rgb(var(--muted))]">
        <span>{title}</span>
        {icon}
      </div>
      <div className="mt-2 text-3xl font-black tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-[rgb(var(--muted))]">{sub}</div>
    </div>
  );
}

export default function AdminPage() {
  const { hasRole, loading } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [sessionsByUser, setSessionsByUser] = useState<Record<string, any[]>>({});
  const [status, setStatus] = useState("Загрузка");

  useEffect(() => {
    if (loading) return;
    if (!hasRole("admin")) {
      setStatus("Недостаточно прав");
      return;
    }

    let cancelled = false;
    setStatus("Загружаем пользователей и прогресс");
    api.users()
      .then(async (xs) => {
        const pairs = await Promise.all(
          xs.map(async (user) => {
            try {
              return [user.id, await api.sessions(user.id)] as const;
            } catch {
              return [user.id, []] as const;
            }
          }),
        );
        if (cancelled) return;
        setUsers(xs);
        setSessionsByUser(Object.fromEntries(pairs));
        setStatus("Готово");
      })
      .catch(() => {
        if (!cancelled) setStatus("Ошибка доступа");
      });

    return () => {
      cancelled = true;
    };
  }, [hasRole, loading]);

  const rows = useMemo<UserProgress[]>(() => {
    return users.map((user) => {
      const sessions = sessionsByUser[user.id] ?? [];
      const stats = computeGamification(sessions);
      const sorted = [...sessions].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
      const lastSession = sorted[0] ?? null;
      const lastTime = lastSession ? new Date(lastSession.created_at).getTime() : 0;
      const daysSince = lastTime ? (Date.now() - lastTime) / (24 * 60 * 60 * 1000) : Infinity;
      const risk: UserProgress["risk"] = !sessions.length ? "inactive" : daysSince > 7 || stats.averageF1 < 0.55 ? "watch" : "active";
      return {
        user,
        sessions,
        stats,
        lastSession,
        lastSeenLabel: lastSession ? format(new Date(lastSession.created_at), "dd.MM HH:mm") : "—",
        risk,
      };
    });
  }, [sessionsByUser, users]);

  const totals = useMemo(() => {
    const allSessions = rows.flatMap((row) => row.sessions);
    const activeUsers = rows.filter((row) => row.sessions.length > 0).length;
    const totalXp = rows.reduce((acc, row) => acc + row.stats.totalXp, 0);
    const avgF1Rows = rows.filter((row) => row.stats.sessions.length);
    const avgF1 = avgF1Rows.length
      ? avgF1Rows.reduce((acc, row) => acc + row.stats.averageF1, 0) / avgF1Rows.length
      : 0;
    return { allSessions, activeUsers, totalXp, avgF1 };
  }, [rows]);

  const roleChart = useMemo(() => {
    return ["student", "teacher", "researcher", "admin"].map((role) => ({
      role: roleLabel(role),
      count: users.filter((u) => u.role === role).length,
    }));
  }, [users]);

  const topUsers = useMemo(() => [...rows].sort((a, b) => b.stats.totalXp - a.stats.totalXp).slice(0, 5), [rows]);
  const attentionUsers = useMemo(() => rows.filter((row) => row.risk !== "active").slice(0, 5), [rows]);

  if (!loading && !hasRole("admin")) {
    return (
      <Card>
        <CardHeader title="Администрирование" subtitle="Этот раздел доступен только администраторам" right={<Pill>{status}</Pill>} />
        <CardBody>
          <div className="rounded-3xl border border-rose-300/20 bg-rose-300/10 p-5 text-sm text-rose-100">
            Войдите под администратором, чтобы видеть статистику пользователей и прогресс
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      <Card>
        <CardHeader
          title="Администрирование"
          subtitle="Статистика пользователей, роли, прогресс и сигналы внимания."
          right={<Pill><Shield className="mr-1 h-3.5 w-3.5 text-lime-300" /> {status}</Pill>}
          help="Админка собирает пользователей и их сохраненные сессии. XP, уровни, F1 и серия считаются тем же алгоритмом, что видит ученик в личном прогрессе."
        />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KPI title="Пользователи" value={`${users.length}`} sub={`${totals.activeUsers} уже имеют практику`} icon={<Users className="h-5 w-5" />} />
            <KPI title="Сессии" value={`${totals.allSessions.length}`} sub="сохраненные попытки всех ролей" icon={<Activity className="h-5 w-5" />} />
            <KPI title="Общий XP" value={formatInteger(totals.totalXp)} sub="сумма прогресса пользователей" icon={<Trophy className="h-5 w-5" />} />
            <KPI title="Средний F1" value={totals.avgF1 ? totals.avgF1.toFixed(3) : "—"} sub="среди пользователей с попытками" icon={<LineChart className="h-5 w-5" />} />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
        <Card>
          <CardHeader
            title="Роли в системе"
            subtitle="Сколько аккаунтов есть в каждой роли."
            help="Роли ограничивают доступ: студент видит свою практику, преподаватель видит учеников, исследователь видит исследовательские отчеты, администратор видит всю систему."
          />
          <CardBody>
            <div className="h-64 rounded-[1.6rem] border border-white/10 bg-black/20 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roleChart}>
                  <XAxis dataKey="role" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#0b0b0e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16 }} />
                  <Bar dataKey="count" radius={[12, 12, 4, 4]} fill="#84cc16" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Лидеры прогресса"
            subtitle="Пользователи с максимальным XP."
            right={<HelpTip text="XP помогает быстро увидеть регулярность и качество практики. Для точной диагностики откройте сессию пользователя и посмотрите отчет по нотам." />}
          />
          <CardBody>
            <div className="space-y-3">
              {topUsers.map((row, index) => (
                <motion.div
                  key={row.user.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className="flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.045] p-4"
                >
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-lime-300 text-lime-950">
                    {index === 0 ? <Crown className="h-5 w-5" /> : <Trophy className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black">{row.user.name}</div>
                    <div className="mt-1 text-xs text-[rgb(var(--muted))]">{row.user.email} · уровень {row.stats.level}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-lime-200">{formatInteger(row.stats.totalXp)} XP</div>
                    <div className="text-xs text-[rgb(var(--muted))]">F1 {row.stats.averageF1 ? row.stats.averageF1.toFixed(3) : "—"}</div>
                  </div>
                </motion.div>
              ))}
              {!topUsers.length ? <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 text-sm text-[rgb(var(--muted))]">Пока нет пользователей.</div> : null}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Пользователи и прогресс"
          subtitle="Уровень, XP, средний F1, серия и последняя активность."
          right={<Pill>{rows.length} профилей</Pill>}
          help="Красный статус означает, что пользователь еще не сохранял попытки. Желтый статус появляется при паузе больше недели или низкой средней точности."
        />
        <CardBody>
          <div className="overflow-x-auto rounded-[1.6rem] border border-white/10">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-white/5 text-xs text-[rgb(var(--muted))]">
                <tr>
                  <th className="p-3">Пользователь</th>
                  <th className="p-3">Роль</th>
                  <th className="p-3">Статус</th>
                  <th className="p-3">Уровень</th>
                  <th className="p-3">XP</th>
                  <th className="p-3">Сессии</th>
                  <th className="p-3">Средний F1</th>
                  <th className="p-3">Лучший F1</th>
                  <th className="p-3">Серия</th>
                  <th className="p-3">Последняя активность</th>
                  <th className="p-3">Отчет</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user.id} className="border-t border-white/10">
                    <td className="p-3">
                      <div className="font-semibold">{row.user.name}</div>
                      <div className="text-xs text-[rgb(var(--muted))]">{row.user.email}</div>
                    </td>
                    <td className="p-3"><Pill>{roleLabel(row.user.role)}</Pill></td>
                    <td className="p-3"><span className={`inline-flex rounded-full border px-3 py-1 text-xs ${riskClass(row.risk)}`}>{statusLabel(row.risk)}</span></td>
                    <td className="p-3 tabular-nums">Ур. {row.stats.level}</td>
                    <td className="p-3 tabular-nums">{formatInteger(row.stats.totalXp)}</td>
                    <td className="p-3 tabular-nums">{row.sessions.length}</td>
                    <td className="p-3 tabular-nums">{row.stats.averageF1 ? row.stats.averageF1.toFixed(3) : "—"}</td>
                    <td className="p-3 tabular-nums">{row.stats.bestF1 ? row.stats.bestF1.toFixed(3) : "—"}</td>
                    <td className="p-3"><span className="inline-flex items-center gap-1"><Flame className="h-3.5 w-3.5 text-orange-300" /> {row.stats.streakDays}</span></td>
                    <td className="p-3 text-[rgb(var(--muted))]">{row.lastSeenLabel}</td>
                    <td className="p-3">
                      {row.lastSession?.id ? (
                        <Link href={`/session/${row.lastSession.id}`} className="inline-flex items-center gap-1 text-lime-200 hover:text-lime-100">
                          открыть <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Требуют внимания"
          subtitle="Нет практики, долгий перерыв или слабая точность."
          right={<AlertCircle className="h-5 w-5 text-amber-300" />}
          help="Этот блок помогает преподавателю или администратору быстро найти пользователей, которым стоит назначить простое упражнение или проверить, понятен ли режим записи."
        />
        <CardBody>
          <div className="grid gap-3 lg:grid-cols-2">
            {attentionUsers.map((row) => (
              <div key={row.user.id} className={`rounded-3xl border p-4 ${riskClass(row.risk)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black">{row.user.name}</div>
                    <div className="mt-1 text-xs opacity-80">{row.user.email}</div>
                  </div>
                  <Pill>{statusLabel(row.risk)}</Pill>
                </div>
                <div className="mt-3 text-sm opacity-90">
                  {row.sessions.length
                    ? `Последняя активность: ${row.lastSeenLabel}. Средний F1: ${row.stats.averageF1.toFixed(3)}.`
                    : "Пользователь еще не сохранил ни одной попытки."}
                </div>
              </div>
            ))}
            {!attentionUsers.length ? (
              <div className="rounded-3xl border border-lime-300/25 bg-lime-300/10 p-5 text-sm text-lime-100">
                Все пользователи выглядят активными по текущим правилам
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
