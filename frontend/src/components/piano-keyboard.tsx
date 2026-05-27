"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const isWhite = (m: number) => WHITE.has(m % 12);

type Props = {
  pressed: number[];
  /** Full 88 keys (A0..C8) or compact (C3..C6) */
  range?: "full" | "compact";
  /** Auto-scroll to keep pressed notes visible */
  autoCenter?: boolean;
  /** Show minimap strip above keys */
  showMiniMap?: boolean;
};

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export function PianoKeyboard({
  pressed,
  range = "full",
  autoCenter = true,
  showMiniMap = true,
}: Props) {
  const pressedSet = useMemo(() => new Set(pressed), [pressed]);

  const start = range === "full" ? 21 : 48;  // A0 : C3
  const end = range === "full" ? 108 : 84;   // C8 : C6

  const keys = useMemo(() => Array.from({ length: end - start + 1 }, (_, i) => start + i), [start, end]);
  const whites = useMemo(() => keys.filter(isWhite), [keys]);

  // Map midi note -> white index (for positioning)
  const whiteIndex = useMemo(() => {
    const m = new Map<number, number>();
    whites.forEach((n, i) => m.set(n, i));
    return m;
  }, [whites]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 1, scrollWidth: 1 });

  // update viewport info for minimap
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const on = () => setViewport({ left: el.scrollLeft, width: el.clientWidth, scrollWidth: el.scrollWidth });
    on();
    el.addEventListener("scroll", on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", on as any);
      ro.disconnect();
    };
  }, []);

  // Auto-center on pressed notes (median white key if possible; otherwise nearest white)
  useEffect(() => {
    if (!autoCenter) return;
    const el = scrollerRef.current;
    if (!el) return;
    if (!pressed.length) return;

    const px = 36; // width of a white key in px (must match CSS below)
    const wCount = whites.length;

    // choose a target note among pressed that has a white index; else pick nearest lower white
    const sorted = [...pressed].sort((a, b) => a - b);
    let target = sorted[Math.floor(sorted.length / 2)];
    let wi = whiteIndex.get(target);
    if (wi === undefined) {
      // find nearest white below
      for (let n = target; n >= start; n--) {
        wi = whiteIndex.get(n);
        if (wi !== undefined) break;
      }
    }
    if (wi === undefined) return;

    const centerX = wi * px + px / 2;
    const desired = centerX - el.clientWidth / 2;
    const maxScroll = el.scrollWidth - el.clientWidth;
    el.scrollLeft = clamp(desired, 0, Math.max(0, maxScroll));
  }, [pressed, autoCenter, whiteIndex, whites.length, start]);

  const MiniMap = () => {
    if (!showMiniMap) return null;
    const el = scrollerRef.current;
    const w = viewport.scrollWidth || 1;
    const left = viewport.left / w;
    const width = viewport.width / w;

    // pressed markers projected to minimap by white index
    const markers = pressed
      .map((n) => {
        let wi = whiteIndex.get(n);
        if (wi === undefined) {
          for (let x = n; x >= start; x--) {
            const t = whiteIndex.get(x);
            if (t !== undefined) { wi = t; break; }
          }
        }
        if (wi === undefined) return null;
        return { wi };
      })
      .filter(Boolean) as { wi: number }[];

    const wCount = whites.length || 1;

    return (
      <div className="mb-2 rounded-xl2 border border-white/10 bg-black/20 p-2">
        <div className="relative h-3 w-full overflow-hidden rounded-lg bg-white/5">
          {/* viewport window */}
          <div
            className="absolute top-0 h-full rounded-lg border border-white/10 bg-white/10"
            style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
          />
          {/* pressed markers */}
          {markers.slice(0, 24).map((m, i) => {
            const x = (m.wi / wCount) * 100;
            return (
              <div
                key={i}
                className="absolute top-0 h-full w-[2px] bg-emerald-400/80"
                style={{ left: `${x}%` }}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
          <span>A0</span>
          <span>C8</span>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full">
      <MiniMap />
      <div
        ref={scrollerRef}
        className="overflow-x-auto rounded-xl2 border border-white/10 bg-black/20"
        style={{ WebkitOverflowScrolling: "touch" as any }}
      >
        <div className="relative h-44" style={{ width: `${whites.length * 36}px` }}>
          {/* White keys */}
          <div className="absolute inset-0 flex h-full">
            {whites.map((n) => (
              <div
                key={n}
                className={
                  "relative h-full w-[36px] border-r border-black/30 " +
                  (pressedSet.has(n) ? "bg-emerald-200" : "bg-zinc-100")
                }
              >
                <div className="absolute bottom-1 left-1 text-[10px] text-zinc-600">{n}</div>
              </div>
            ))}
          </div>

          {/* Black keys */}
          <div className="pointer-events-none absolute inset-0">
            {keys.filter((n) => !isWhite(n)).map((n) => {
              // place black key between adjacent whites
              // find the next white above, then position between
              let nextWhiteIdx = whites.findIndex((w) => w > n);
              if (nextWhiteIdx < 0) nextWhiteIdx = whites.length - 1;
              const wi = Math.max(0, nextWhiteIdx - 1);
              const leftPx = wi * 36 + 26; // tweak for nicer alignment
              return (
                <div
                  key={n}
                  className={
                    "absolute top-0 h-28 w-6 rounded-b-lg shadow-soft " +
                    (pressedSet.has(n) ? "bg-emerald-500" : "bg-zinc-900")
                  }
                  style={{ left: `${leftPx}px` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
        <span>Диапазон: {range === "full" ? "88 клавиш (A0–C8)" : "компактный (C3–C6)"}</span>
        <span>·</span>
        <span>Прокрутка по горизонтали</span>
        <span>·</span>
        <span>Автоцентр: {autoCenter ? "вкл." : "выкл."}</span>
      </div>
    </div>
  );
}
