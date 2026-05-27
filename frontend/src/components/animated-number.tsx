"use client";
import { useEffect, useMemo, useState } from "react";

export function AnimatedNumber({ value, decimals=0, durationMs=700 }: { value: number; decimals?: number; durationMs?: number }) {
  const [v, setV] = useState(0);
  const target = useMemo(() => Number.isFinite(value) ? value : 0, [value]);

  useEffect(() => {
    const start = performance.now();
    const from = v;
    const to = target;
    let raf = 0;

    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      // easeOutCubic
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return <span>{v.toFixed(decimals)}</span>;
}
