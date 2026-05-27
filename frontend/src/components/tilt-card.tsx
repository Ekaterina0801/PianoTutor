"use client";
import { useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import clsx from "clsx";

export function TiltCard({ children, className="", maxTilt=10 }: { children: React.ReactNode; className?: string; maxTilt?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 180, damping: 18 });
  const sry = useSpring(ry, { stiffness: 180, damping: 18 });

  return (
    <motion.div
      ref={ref}
      className={clsx("will-change-transform", className)}
      style={{ perspective: 900 }}
      onMouseMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const ty = (px - 0.5) * 2 * maxTilt;
        const tx = -(py - 0.5) * 2 * maxTilt;
        rx.set(tx);
        ry.set(ty);
      }}
      onMouseLeave={() => { rx.set(0); ry.set(0); }}
    >
      <motion.div style={{ rotateX: srx, rotateY: sry }} className="h-full">
        {children}
      </motion.div>
    </motion.div>
  );
}
