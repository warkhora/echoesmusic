"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Play, Search, SearchX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AlbumArt } from "@/components/AlbumArt";
import { ArtistLinks } from "@/components/EntityLink";
import { EASE } from "@/components/motion";
import { Spinner } from "@/components/Spinner";
import { SEARCH_MIN_CHARS, useSearch } from "@/hooks/useSearch";
import { formatTime, type EchoTrack } from "@/lib/types";
import { usePlayer } from "@/state/player";
import { usePreferences } from "@/state/preferences";
import { useRouter } from "next/navigation";

/**
 * Global search in the top bar.
 *
 * Debounced at 300 ms from the second character, ranked by the listener's own
 * taste, and answered in a liquid-glass dropdown of five tracks. Enter opens the
 * full `/search?q=…` page.
 */
export function GlobalSearch() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { prefs } = usePreferences();
  const { query, results, loading, error, capped, search, clear } = useSearch(5);
  const { current, isPlaying, playFrom } = usePlayer();

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  // Clamped rather than reset in an effect: a shorter result set cannot leave
  // the highlight pointing past the end, and no extra render is needed.
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  const play = (track: EchoTrack, index: number) => {
    playFrom({ track, tracks: results.map((hit) => hit.track), index, source: "search" });
    setOpen(false);
  };

  const submit = () => {
    const term = query.trim();
    if (term.length < SEARCH_MIN_CHARS) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  const showPanel = open && query.trim().length >= SEARCH_MIN_CHARS;

  return (
    <div className="relative w-full min-w-0" ref={rootRef}>
      <label
        className={`glass-thin flex items-center gap-2.5 rounded-full px-3.5 py-2 transition-all duration-300 ${
          showPanel ? "border-white/25" : "hover:border-white/20"
        }`}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-white/40" strokeWidth={1.7} />
        <input
          value={query}
          onChange={(event) => {
            search(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (results.length && event.shiftKey) {
                play(results[activeIndex].track, activeIndex);
                return;
              }
              submit();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
          }}
          placeholder="Search tracks, artists, albums…"
          aria-label="Global search"
          aria-expanded={showPanel}
          role="combobox"
          aria-controls="echoes-search-results"
          autoComplete="off"
          className="w-full min-w-0 bg-transparent text-[12.5px] text-white/88 outline-none placeholder:text-white/30"
        />
        {loading && <Spinner size={11} />}
        {query && !loading && (
          <button
            type="button"
            onClick={() => {
              clear();
              setOpen(false);
            }}
            aria-label="Clear search"
            className="shrink-0 text-white/35 transition-all duration-300 hover:rotate-90 hover:text-white"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        )}
      </label>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            id="echoes-search-results"
            role="listbox"
            initial={!prefs.uiAnimations ? false : { opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="glass-menu absolute left-0 right-0 top-[calc(100%+10px)] z-[70] origin-top overflow-hidden rounded-[20px] p-1.5"
          >
            {error ? (
              <p className="px-3 py-4 text-[11.5px] leading-relaxed text-white/50">{error}</p>
            ) : loading && !results.length ? (
              <div className="flex flex-col gap-2 p-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="skeleton h-[46px] rounded-2xl" />
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="flex items-center gap-3 px-3 py-4">
                <SearchX className="h-4 w-4 shrink-0 text-white/35" strokeWidth={1.6} />
                <p className="text-[11.5px] leading-relaxed text-white/45">
                  No tracks match “{query.trim()}”.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {results.map(({ track, score }, index) => {
                  const isCurrent = current?.id === track.id;
                  return (
                    <li key={`${track.id}-${index}`}>
                      <div
                        role="option"
                        aria-selected={index === activeIndex}
                        onMouseEnter={() => setActive(index)}
                        className={`group relative flex items-center gap-3 rounded-[16px] px-2 py-2 transition-colors duration-200 ${
                          index === activeIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
                        }`}
                      >
                        {/* cover: darkens on hover and reveals a play triangle */}
                        <button
                          type="button"
                          onClick={() => play(track, index)}
                          aria-label={`Play ${track.title}`}
                          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl"
                        >
                          <AlbumArt
                            seed={track.artSeed}
                            colors={track.colors}
                            imageUrl={track.imageUrl}
                            rounded="rounded-xl"
                            className="h-full w-full"
                            animate={isCurrent && isPlaying}
                          />
                          <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/55" />
                          <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                            {isCurrent && isPlaying ? (
                              <span className="flex h-3.5 items-end gap-[2px]">
                                {[0, 1, 2].map((bar) => (
                                  <span
                                    key={bar}
                                    className="eq-bar w-[2px] rounded-full bg-white"
                                    style={{ height: "100%", animationDelay: `${bar * 0.15}s` }}
                                  />
                                ))}
                              </span>
                            ) : (
                              <Play className="ml-0.5 h-4 w-4 text-white" fill="currentColor" strokeWidth={0} />
                            )}
                          </span>
                        </button>

                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-[13px] font-medium leading-tight ${
                              isCurrent ? "text-[var(--accent-3)]" : "text-white/90"
                            }`}
                          >
                            {track.title}
                          </p>
                          {/* every credited artist is its own /artist/[id] link */}
                          <p className="mt-0.5 truncate text-[11px] text-white/42">
                            <ArtistLinks track={track} />
                          </p>
                        </div>

                        {score.relevance > 0.15 && score.reasons[0] && (
                          <span
                            title={`Ranked by your taste: ${score.reasons.join(", ")}`}
                            className="hidden shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.16em] text-[var(--accent-3)]/85 sm:block"
                          >
                            {score.reasons[0]}
                          </span>
                        )}
                        <span className="tnum w-10 shrink-0 text-right font-mono text-[10px] text-white/32">
                          {formatTime(track.durationMs)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/8 px-3 pb-1 pt-2">
              <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-white/25">
                {capped ? "capped by app tier" : `${results.length} result${results.length === 1 ? "" : "s"}`}
                {results.length ? " · ranked by your taste" : ""}
              </span>
              {query.trim().length >= SEARCH_MIN_CHARS && (
                <button
                  type="button"
                  onClick={submit}
                  className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-white/60 transition-colors duration-300 hover:bg-white/[0.07] hover:text-white"
                >
                  See all results ↵
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
