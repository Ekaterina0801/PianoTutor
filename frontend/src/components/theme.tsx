"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "dark" | "light";
type Ctx = { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void; };

const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const saved = (localStorage.getItem("pt_theme") as Theme | null) ?? null;
    const preferDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    const t: Theme = saved ?? (preferDark ? "dark" : "light");
    setThemeState(t);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    localStorage.setItem("pt_theme", theme);
  }, [theme]);

  const api = useMemo(() => ({
    theme,
    setTheme: (t: Theme) => setThemeState(t),
    toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
  }), [theme]);

  return <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("ThemeProvider missing");
  return ctx;
}
