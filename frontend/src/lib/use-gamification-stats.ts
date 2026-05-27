"use client";

import { useEffect, useMemo, useState } from "react";
import { computeGamification } from "@/lib/gamification";

const HYDRATION_SAFE_NOW = "2026-01-07T12:00:00.000Z";

export function useGamificationStats(items: any[] = []) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return useMemo(
    () => computeGamification(items, { now: mounted ? new Date() : HYDRATION_SAFE_NOW }),
    [items, mounted],
  );
}
