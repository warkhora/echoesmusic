"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------ scramble text ----------------------------- */

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/\\|<>*·—";

export function ScrambleText({
  text,
  className = "",
  speed = 26,
}: {
  text: string;
  className?: string;
  speed?: number;
}) {
  const reduce = useReducedMotion();
  const [scrambled, setScrambled] = useState<string | null>(null);
  const frame = useRef(0);
  const display = reduce ? text : (scrambled ?? text);

  useEffect(() => {
    if (reduce) return;
    frame.current = 0;
    const id = window.setInterval(() => {
      frame.current += 1;
      const revealed = frame.current / 1.6;
      setScrambled(
        text
          .split("")
          .map((ch, i) =>
            i < revealed || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          )
          .join(""),
      );
      if (revealed >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, reduce, speed]);

  return <span className={className}>{display}</span>;
}

/* --------------------------------- reveal -------------------------------- */

export function Reveal({
  children,
  delay = 0,
  y = 20,
  className = "",
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-40px" }}
      transition={{ duration: 0.75, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Line-mask reveal used for section headings. */
export function MaskedHeading({
  children,
  className = "",
  delay = 0,
  as: Tag = "h2",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "h1" | "h2" | "h3";
}) {
  const reduce = useReducedMotion();
  return (
    <Tag className={`overflow-hidden ${className}`}>
      <motion.span
        className="block"
        initial={reduce ? { y: 0 } : { y: "108%" }}
        whileInView={{ y: 0 }}
        viewport={{ once: true, margin: "-30px" }}
        transition={{ duration: 0.85, delay, ease: EASE }}
      >
        {children}
      </motion.span>
    </Tag>
  );
}

/* ------------------------------- equalizer -------------------------------- */

export function Equalizer({
  playing,
  className = "",
  bars = 4,
}: {
  playing: boolean;
  className?: string;
  bars?: number;
}) {
  const reduce = useReducedMotion();
  const delays = useMemo(() => Array.from({ length: bars }, (_, i) => `${i * 0.16}s`), [bars]);
  return (
    <span className={`flex h-3.5 items-end gap-[2px] ${className}`} aria-hidden>
      {delays.map((d, i) => (
        <span
          key={i}
          className={`w-[2px] rounded-full bg-current ${
            playing && !reduce ? "eq-bar" : ""
          }`}
          style={{
            height: playing ? "100%" : "30%",
            animationDelay: d,
            opacity: playing ? 1 : 0.45,
            transition: "height .4s ease, opacity .4s ease",
          }}
        />
      ))}
    </span>
  );
}

/* ------------------------------- count up --------------------------------- */

export function CountUp({ value, className = "" }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const [animated, setAnimated] = useState<number | null>(null);
  const shown = reduce ? value : (animated ?? 0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);
  return <span className={className}>{shown.toLocaleString()}</span>;
}
