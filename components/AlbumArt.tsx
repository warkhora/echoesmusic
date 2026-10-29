"use client";

import { memo, useId, useMemo } from "react";
import type { Triad } from "@/lib/types";

interface AlbumArtProps {
  seed: number;
  colors: Triad;
  imageUrl?: string | null;
  className?: string;
  rounded?: string;
  /** Slow Ken Burns breathing on real artwork. */
  animate?: boolean;
}

/**
 * Procedural cover art. Every demo release gets a deterministic, generated
 * sleeve — no external image requests, no broken art, and the palette always
 * matches the ambient field behind the glass.
 */
function AlbumArtBase({ seed, colors, imageUrl, className = "", rounded = "rounded-2xl", animate = true }: AlbumArtProps) {
  const uid = useId().replace(/:/g, "");
  const variant = seed % 5;
  const [c1, c2, c3] = colors;

  const rings = useMemo(
    () => Array.from({ length: 4 + (seed % 3) }, (_, i) => 14 + i * (9 + (seed % 5))),
    [seed],
  );
  const dots = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        x: 8 + (i % 6) * 17,
        y: 10 + Math.floor(i / 6) * 16,
        r: 1 + ((seed + i * 7) % 5) * 0.5,
        o: 0.1 + ((seed + i * 3) % 9) * 0.045,
      })),
    [seed],
  );

  if (imageUrl) {
    return (
      <div className={`cover-zoom relative overflow-hidden bg-black/40 ${rounded} ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover ${animate ? "animate-breathe" : ""}`}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-white/5" />
      </div>
    );
  }

  return (
    <div className={`cover-zoom relative overflow-hidden bg-black ${rounded} ${className}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id={`lg-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c1} />
            <stop offset="58%" stopColor={c2} />
            <stop offset="100%" stopColor={c1} />
          </linearGradient>
          <radialGradient id={`rg-${uid}`} cx="0.3" cy="0.26" r="0.78">
            <stop offset="0%" stopColor={c3} stopOpacity="0.95" />
            <stop offset="100%" stopColor={c3} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`vg-${uid}`} cx="0.5" cy="0.5" r="0.72">
            <stop offset="55%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
        </defs>

        <rect width="100" height="100" fill={`url(#lg-${uid})`} />
        <rect width="100" height="100" fill={`url(#rg-${uid})`} />

        {variant === 0 && (
          <g fill="none" stroke="#fff" strokeOpacity="0.22">
            {rings.map((r) => (
              <circle key={r} cx={30 + (seed % 40)} cy={70 - (seed % 30)} r={r} strokeWidth="0.5" />
            ))}
          </g>
        )}

        {variant === 1 && (
          <g>
            <circle cx="50" cy={42 + (seed % 12)} r={20 + (seed % 8)} fill="#fff" fillOpacity="0.14" />
            <g stroke="#000" strokeOpacity="0.28" strokeWidth="0.8">
              {Array.from({ length: 7 }, (_, i) => (
                <line key={i} x1="0" y1={62 + i * 5} x2="100" y2={58 + i * 6} />
              ))}
            </g>
          </g>
        )}

        {variant === 2 && (
          <g fill="#fff" fillOpacity="0.1">
            {Array.from({ length: 6 }, (_, i) => (
              <rect
                key={i}
                x={-30 + i * 22 + (seed % 6)}
                y="-20"
                width={5 + (i % 3) * 3}
                height="160"
                transform={`rotate(${18 + (seed % 12)} 50 50)`}
              />
            ))}
          </g>
        )}

        {variant === 3 && (
          <g fill="#fff">
            {dots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={d.r} fillOpacity={d.o} />
            ))}
          </g>
        )}

        {variant === 4 && (
          <g fill="none" stroke="#fff" strokeOpacity="0.26" strokeWidth="0.9">
            {Array.from({ length: 5 }, (_, i) => (
              <path
                key={i}
                d={`M-5 ${30 + i * 11} C 22 ${14 + i * 12}, 44 ${54 + i * 9}, 105 ${26 + i * 12}`}
              />
            ))}
          </g>
        )}

        <rect width="100" height="100" fill={`url(#vg-${uid})`} />
        <rect width="100" height="100" fill="#fff" fillOpacity="0.03" />
      </svg>
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/12" />
    </div>
  );
}

/**
 * Memoised: the player clock and library refreshes re-render large trees, and a
 * procedural sleeve should only re-render when its own inputs change.
 */
export const AlbumArt = memo(
  AlbumArtBase,
  (a, b) =>
    a.seed === b.seed &&
    a.imageUrl === b.imageUrl &&
    a.className === b.className &&
    a.rounded === b.rounded &&
    a.animate === b.animate &&
    a.colors[0] === b.colors[0] &&
    a.colors[1] === b.colors[1] &&
    a.colors[2] === b.colors[2],
);
