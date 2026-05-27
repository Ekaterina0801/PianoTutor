"use client";
import { ReactNode } from "react";
import { motion } from "framer-motion";
import { CircleHelp } from "lucide-react";
import clsx from "clsx";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35 }}
      className={clsx("surface rounded-3xl backdrop-blur-xl", className)}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
  help,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  help?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-6">
      <div>
        <div className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {title}
          {help ? <HelpTip text={help} /> : null}
        </div>
        {subtitle ? <div className="mt-1 text-sm text-[rgb(var(--muted))]">{subtitle}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("px-6 pb-6", className)}>{children}</div>;
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
      {children}
    </span>
  );
}

export function HelpTip({ text, side = "bottom" }: { text: string; side?: "top" | "bottom" }) {
  return (
    <span className="group/help relative inline-flex">
      <button
        type="button"
        className="inline-grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-white/5 text-[rgb(var(--muted))] transition hover:bg-white/10 hover:text-white focus:bg-white/10 focus:text-white"
        aria-label={text}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      <span
        className={clsx(
          "pointer-events-none absolute z-50 w-72 rounded-2xl border border-white/10 bg-zinc-950/95 p-3 text-left text-xs font-normal leading-relaxed text-zinc-100 opacity-0 shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition group-hover/help:opacity-100 group-focus-within/help:opacity-100",
          side === "top" ? "bottom-8 left-1/2 -translate-x-1/2" : "left-1/2 top-8 -translate-x-1/2",
        )}
      >
        {text}
      </span>
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed";

  const v =
    variant === "primary"
      ? "text-lime-950 bg-gradient-to-r from-lime-300 via-cyan-300 to-amber-300 shadow-[0_16px_36px_rgba(132,204,22,0.22)] hover:brightness-105 relative overflow-hidden"
      : variant === "outline"
      ? "border border-white/10 bg-white/5 hover:bg-white/10"
      : "hover:bg-white/10";

  return (
    <button disabled={disabled} onClick={onClick} className={clsx(base, v, className)}>
      {children}
      {variant === "primary" ? (
        <span
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              "linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.35) 18%, transparent 36%)",
            transform: "translateX(-120%)",
            animation: "shine 2.6s ease-in-out infinite",
          }}
        />
      ) : null}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-2xl border border-white/10 bg-white/5 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={
            "rounded-2xl px-3 py-1.5 text-xs font-semibold transition " +
            (o.value === value ? "bg-white text-zinc-950" : "text-[rgb(var(--muted))] hover:bg-white/10")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
