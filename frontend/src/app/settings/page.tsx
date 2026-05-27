"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Pill, Segmented } from "@/components/ui";
import { useTheme } from "@/components/theme";
import { useAuth } from "@/components/auth";
import { roleLabel } from "@/lib/labels";

type ReportMode = "tutor" | "analytics";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [reportMode, setReportMode] = useState<ReportMode>("tutor");

  useEffect(() => {
    const saved = (localStorage.getItem("pt_report_mode") as ReportMode | null) ?? null;
    if (saved) setReportMode(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("pt_report_mode", reportMode);
  }, [reportMode]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Настройки" subtitle="Профиль, тема и предпочтения отчетов." right={<Pill>{roleLabel(user?.role)}</Pill>} />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold">Профиль</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">{user ? `${user.name} · ${user.email}` : "Войдите, чтобы сохранять сессии."}</div>
            </div>

            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold">Тема</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">Переключение светлого и темного оформления</div>
              <div className="mt-3">
                <Segmented value={theme} options={[{label:"Темная", value:"dark"},{label:"Светлая", value:"light"}] as any} onChange={(v:any)=>setTheme(v)} />
              </div>
            </div>

            <div className="rounded-xl2 border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-semibold">Режим отчета</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">Учебный режим проще, аналитический показывает больше деталей</div>
              <div className="mt-3">
                <Segmented value={reportMode} options={[{label:"Учебный", value:"tutor"},{label:"Аналитика", value:"analytics"}] as any} onChange={(v:any)=>setReportMode(v)} />
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
