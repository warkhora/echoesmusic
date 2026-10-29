"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Columns3, Lock, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EASE } from "@/components/motion";
import { FIXED_COLUMNS, OPTIONAL_COLUMNS, useColumns, type ColumnId } from "@/state/columns";
import { usePreferences } from "@/state/preferences";

/**
 * The checkmark stroke. `pathLength={1}` normalises the path so the dash values
 * are exact regardless of the viewBox scale — the mark draws itself left→right
 * over 500 ms via `stroke-dashoffset`, with no box or border around it.
 */
const CHECK_PATH = "M1.6 5.6 L4.5 8.4 L10.4 2.2";

function AnimatedCheck({ visible }: { visible: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="grid h-4 w-4 shrink-0 place-items-center text-white">
      <AnimatePresence initial={false}>
        {visible && (
          <motion.svg
            viewBox="0 0 12 11"
            className="h-3.5 w-3.5 overflow-visible"
            fill="none"
            aria-hidden
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.18 } }}
          >
            <motion.path
              d={CHECK_PATH}
              pathLength={1}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={1}
              initial={reduce ? { strokeDashoffset: 0 } : { strokeDashoffset: 1 }}
              animate={{ strokeDashoffset: 0 }}
              exit={reduce ? { strokeDashoffset: 1 } : { strokeDashoffset: 1 }}
              transition={{ duration: 0.5, ease: EASE }}
            />
          </motion.svg>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * Liquid-glass column picker. A custom popover — never a native `<select>`, so
 * the frosted backdrop, organic radius and drawn checkmarks survive every OS.
 */
export function ColumnMenu() {
  const { prefs } = usePreferences();
  const { visible, isVisible, toggle, reset } = useColumns();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Choose visible columns"
        className={`glass-thin flex items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3 text-[11px] font-medium transition-all duration-400 ${
          open ? "border-white/25 text-white" : "text-white/55 hover:border-white/22 hover:text-white"
        }`}
      >
        <Columns3 className="h-3.5 w-3.5" strokeWidth={1.6} />
        <span className="hidden sm:inline">Columns</span>
        <span className="tnum rounded-full bg-white/10 px-1.5 py-px font-mono text-[9px] text-white/60">
          {visible.length}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Track table columns"
            initial={!prefs.uiAnimations ? false : { opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.34, ease: EASE }}
            className="glass-menu absolute right-0 top-[calc(100%+10px)] z-50 w-[262px] origin-top-right overflow-hidden rounded-[20px] p-1.5"
          >
            <span
              className="pointer-events-none absolute inset-x-6 top-0 h-px"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--accent-2), var(--accent-3), transparent)",
              }}
            />

            <p className="px-2.5 pb-1.5 pt-2 font-mono text-[8.5px] uppercase tracking-[0.26em] text-white/32">
              Optional columns
            </p>

            <ul className="flex flex-col gap-0.5">
              {OPTIONAL_COLUMNS.map((column) => {
                const on = isVisible(column.id);
                return (
                  <li key={column.id}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => toggle(column.id as ColumnId)}
                      className="group flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left transition-colors duration-300 hover:bg-white/[0.07]"
                    >
                      <AnimatedCheck visible={on} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[12.5px] font-medium transition-colors duration-300 ${
                            on ? "text-white/92" : "text-white/55 group-hover:text-white/80"
                          }`}
                        >
                          {column.label}
                        </span>
                        <span className="block truncate text-[10px] text-white/30">
                          {column.hint}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="mt-2 flex items-center gap-1.5 border-t border-white/8 px-2.5 pb-1.5 pt-2.5 font-mono text-[8.5px] uppercase tracking-[0.26em] text-white/28">
              <Lock className="h-2.5 w-2.5" strokeWidth={2} />
              Always visible
            </p>
            <ul className="flex flex-col gap-0.5">
              {FIXED_COLUMNS.map((column) => (
                <li
                  key={column.label}
                  className="flex cursor-default items-center gap-2.5 rounded-[14px] px-2.5 py-1.5 opacity-55"
                  title={column.hint}
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center text-white/45">
                    <Lock className="h-3 w-3" strokeWidth={1.7} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/70">
                    {column.label}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/8 px-1.5 pb-1 pt-2.5">
              <span className="px-1 font-mono text-[8.5px] uppercase tracking-[0.2em] text-white/25">
                saved locally
              </span>
              <button
                type="button"
                onClick={reset}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] text-white/55 transition-colors duration-300 hover:bg-white/[0.07] hover:text-white"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={1.8} />
                Reset
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
