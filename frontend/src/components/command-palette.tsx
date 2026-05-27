"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, CornerDownLeft } from "lucide-react";
import { useAuth } from "@/components/auth";

type Item = { label: string; href: string; hint?: string; roles?: string[] };

const items: Item[] = [
  { label: "Панель", href: "/", hint: "Главная" },
  { label: "Библиотека", href: "/library", hint: "Упражнения" },
  { label: "Лаборатория", href: "/lab", hint: "MIDI и аудиоанализ" },
  { label: "Прогресс", href: "/progress", hint: "История" },
  { label: "Тур", href: "/tour", hint: "Анимированный обзор функций" },
  { label: "Исследования", href: "/research", hint: "Сравнение корректоров", roles: ["researcher", "admin"] },
  { label: "Админка", href: "/admin", hint: "Пользователи и роли", roles: ["admin"] },
  { label: "Настройки", href: "/settings", hint: "Тема и отчеты" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();
  const { hasRole } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmdk = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (cmdk) {
        e.preventDefault();
        setOpen((v) => !v);
        setQ("");
      }
      if (open && e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const visible = items.filter((i) => !i.roles || hasRole(...(i.roles as any)));
    if (!s) return visible;
    return visible.filter((i) => (i.label + " " + (i.hint ?? "")).toLowerCase().includes(s));
  }, [hasRole, q]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-24"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <motion.div
            className="surface gradient-border relative w-full max-w-2xl rounded-3xl p-4"
            initial={{ y: -10, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <Search className="h-4 w-4 text-[rgb(var(--muted))]" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск… (Ctrl/⌘K)"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[rgb(var(--muted))]"
              />
              <div className="flex items-center gap-1 text-xs text-[rgb(var(--muted))]">
                <CornerDownLeft className="h-4 w-4" /> Ввод
              </div>
            </div>

            <div className="mt-3 max-h-[50vh] overflow-auto">
              {filtered.map((it) => (
                <button
                  key={it.href}
                  onClick={() => go(it.href)}
                  className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left hover:bg-white/5"
                >
                  <div>
                    <div className="text-sm font-semibold">{it.label}</div>
                    {it.hint ? <div className="text-xs text-[rgb(var(--muted))]">{it.hint}</div> : null}
                  </div>
                  <div className="text-xs text-[rgb(var(--muted))]">{it.href}</div>
                </button>
              ))}
            </div>

            <div className="mt-3 flex justify-between text-xs text-[rgb(var(--muted))]">
              <span>Ctrl/⌘K в любом месте</span>
              <span>Esc закрывает меню</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
