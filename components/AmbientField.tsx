"use client";

import { useReducedMotion } from "framer-motion";
import { useId } from "react";

interface AmbientFieldProps {
  enabled: boolean;
  grain: boolean;
  motion: boolean;
  /** 0 – 1, scales bloom intensity */
  intensity?: number;
}

/**
 * The living backdrop.
 *
 * Performance notes (this layer is on screen constantly, so it is built to be
 * composited rather than repainted):
 *  · blooms are radial gradients — soft by construction, so no `filter: blur()`
 *    has to be recomputed every frame;
 *  · only `transform` and `opacity` animate, with `will-change` promoting each
 *    blob to its own layer;
 *  · the turbulence mesh is rasterised once (no animated filter primitives) and
 *    drifted with a CSS transform on a promoted layer;
 *  · no `mix-blend-mode`, which would force the whole stack to re-composite.
 */
export function AmbientField({ enabled, grain, motion, intensity = 1 }: AmbientFieldProps) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const animate = enabled && motion && !reduce;

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#0b0c10]" aria-hidden>
      {/* base wash */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#151926_0%,#0b0c10_58%,#07080b_100%)]" />

      {/* drifting blooms */}
      <div
        className="ambient-layer"
        style={{ opacity: enabled ? intensity : 0, filter: "none" }}
      >
        <div
          className={`blob h-[46vw] w-[46vw] left-[-6vw] top-[-8vw] ${animate ? "animate-drift-a" : ""}`}
          style={{
            background:
              "radial-gradient(circle at 45% 45%, color-mix(in oklab, var(--accent-1) 78%, transparent) 0%, color-mix(in oklab, var(--accent-1) 32%, transparent) 42%, transparent 70%)",
            opacity: 0.72,
          }}
        />
        <div
          className={`blob h-[40vw] w-[40vw] right-[-6vw] top-[4vh] ${animate ? "animate-drift-b" : ""}`}
          style={{
            background:
              "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent-2) 72%, transparent) 0%, color-mix(in oklab, var(--accent-2) 26%, transparent) 46%, transparent 72%)",
            opacity: 0.6,
          }}
        />
        <div
          className={`blob h-[52vw] w-[52vw] left-[22vw] bottom-[-20vw] ${animate ? "animate-drift-c" : ""}`}
          style={{
            background:
              "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent-3) 62%, transparent) 0%, color-mix(in oklab, var(--accent-3) 22%, transparent) 48%, transparent 74%)",
            opacity: 0.5,
          }}
        />
      </div>

      {/* liquid mesh — filtered once, drifted with a transform */}
      <div
        className={`absolute inset-0 transition-opacity duration-1000 ${animate ? "animate-drift-b" : ""}`}
        style={{
          opacity: enabled ? 0.42 * intensity : 0,
          filter: "blur(38px)",
          willChange: animate ? "transform" : "auto",
          animationDuration: "72s",
        }}
      >
        <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
          <defs>
            <filter id={`liquid-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="2" seed="7" result="noise" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="64"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
            <linearGradient id={`lm-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.5" />
              <stop offset="55%" stopColor="var(--accent-1)" stopOpacity="0.36" />
              <stop offset="100%" stopColor="var(--accent-3)" stopOpacity="0.46" />
            </linearGradient>
          </defs>
          <g filter={`url(#liquid-${uid})`}>
            <ellipse cx="150" cy="120" rx="150" ry="96" fill={`url(#lm-${uid})`} />
            <ellipse cx="430" cy="260" rx="170" ry="110" fill="var(--accent-3)" fillOpacity="0.28" />
            <ellipse cx="300" cy="60" rx="120" ry="70" fill="var(--accent-2)" fillOpacity="0.24" />
          </g>
        </svg>
      </div>

      {/* colour veil + vignette */}
      <div className="mesh-veil absolute inset-0 opacity-40 mix-blend-soft-light" />
      <div className="vignette absolute inset-0" />

      {/* film grain */}
      <div
        className={`grain absolute -inset-[15%] transition-opacity duration-700 ${
          grain && animate ? "grain-anim" : ""
        }`}
        style={{ opacity: grain ? 0.05 : 0, mixBlendMode: "overlay", willChange: "transform" }}
      />
    </div>
  );
}
