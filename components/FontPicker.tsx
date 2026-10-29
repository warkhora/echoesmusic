"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EASE } from "@/components/motion";
import { FONT_KIND_LABEL, FONT_OPTIONS, type FontKind, type FontOption } from "@/lib/design";
import { usePreferences } from "@/state/preferences";

/** Height of one row × the six rows the menu shows before it scrolls. */
const ROW_HEIGHT = 42;
const VISIBLE_ROWS = 6;

/**
 * Liquid-glass font dropdown.
 *
 * Custom popover rather than a native `<select>`: an OS dropdown cannot render
 * each option in its own typeface, which is the whole point of a font picker.
 * Shows six rows at a time with a thin custom scrollbar.
 */
export function FontPicker({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (family: string) => void;
}) {
  const { prefs } = usePreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();

  const selected = FONT_OPTIONS.find((font) => font.id === value) ?? null;

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? FONT_OPTIONS.filter((font) =>
          `${font.label} ${FONT_KIND_LABEL[font.kind]}`.toLowerCase().includes(q),
        )
      : FONT_OPTIONS;
    const order: FontKind[] = ["clean", "wide", "futuristic", "mono", "display"];
    return order
      .map((kind) => ({ kind, fonts: matches.filter((font) => font.kind === kind) }))
      .filter((group) => group.fonts.length > 0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12.5px] font-semibold text-white/85">{label}</p>
        <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/30">
          {selected ? selected.kind : "custom"}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-white/38">{hint}</p>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`glass-thin mt-2.5 flex w-full items-center gap-3 rounded-[16px] px-3.5 py-2.5 text-left transition-all duration-300 ${
          open ? "border-white/25" : "hover:border-white/20"
        }`}
      >
        <span
          className="min-w-0 flex-1 truncate text-[14px] text-white/90"
          style={{ fontFamily: selected?.stack }}
        >
          {selected?.label ?? value}
        </span>
        <span
          className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-white/30"
          aria-hidden
        >
          Aa
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-white/45 transition-transform duration-400 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.8}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={label}
            initial={!prefs.uiAnimations ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="glass-menu absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[20px] p-1.5"
          >
            <label className="mb-1.5 flex items-center gap-2 rounded-[13px] border border-white/8 bg-black/25 px-3 py-2">
              <Search className="h-3 w-3 shrink-0 text-white/35" strokeWidth={1.8} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter 33 typefaces…"
                aria-label="Filter fonts"
                className="w-full bg-transparent text-[11.5px] text-white/85 outline-none placeholder:text-white/28"
              />
            </label>

            {/* six rows visible, then a thin custom scrollbar */}
            <div
              className="thin-scrollbar overflow-y-auto overscroll-contain pr-0.5"
              style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS }}
            >
              {grouped.length === 0 && (
                <p className="px-3 py-4 text-[11.5px] text-white/40">No typeface matches “{query}”.</p>
              )}
              {grouped.map((group) => (
                <div key={group.kind}>
                  <p className="glass-chip sticky top-0 z-10 bg-[#0c0e14]/85 px-3 py-1.5 font-mono text-[8.5px] uppercase tracking-[0.24em] text-white/30">
                    {FONT_KIND_LABEL[group.kind]}
                  </p>
                  {group.fonts.map((font: FontOption) => {
                    const active = font.id === value;
                    return (
                      <button
                        key={font.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onChange(font.id);
                          setOpen(false);
                          setQuery("");
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-[13px] px-3 text-left transition-colors duration-200 ${
                          active ? "bg-white/[0.10]" : "hover:bg-white/[0.06]"
                        }`}
                        style={{ height: ROW_HEIGHT }}
                      >
                        {/* the name rendered in its own typeface */}
                        <span
                          className={`min-w-0 flex-1 truncate text-[15px] ${active ? "text-white" : "text-white/78"}`}
                          style={{ fontFamily: font.stack }}
                        >
                          {font.label}
                        </span>
                        <span
                          className="shrink-0 text-[10px] text-white/32"
                          style={{ fontFamily: font.stack }}
                          aria-hidden
                        >
                          Aa 123
                        </span>
                        <span className="grid h-4 w-4 shrink-0 place-items-center">
                          {active && (
                            <motion.span
                              initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ duration: 0.25, ease: EASE }}
                              className="text-white"
                            >
                              <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                            </motion.span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
