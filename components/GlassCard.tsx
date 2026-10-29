"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useRef, type ElementType, type ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  radius?: string;
  interactive?: boolean;
  thin?: boolean;
  glow?: string;
  delay?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Translucent, pointer-reactive glass panel — the atom of the whole UI. */
export function GlassCard({
  children,
  className = "",
  as,
  radius = "rounded-3xl",
  interactive = true,
  thin = false,
  glow,
  delay = 0,
  onClick,
  style,
}: GlassCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }, []);

  const surface = `${thin ? "glass-thin" : "glass"} ${radius} ${
    interactive ? "sheen lift" : ""
  } ${className}`;

  const Tag = (as ?? "div") as ElementType;

  return (
    <motion.div
      ref={ref as React.Ref<HTMLDivElement>}
      onPointerMove={interactive ? onPointerMove : undefined}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={surface}
      onClick={onClick}
      style={{
        ...(glow ? ({ "--accent-glow": glow } as React.CSSProperties) : {}),
        ...style,
      }}
    >
      <Tag className="relative z-[1] h-full w-full">{children}</Tag>
    </motion.div>
  );
}
