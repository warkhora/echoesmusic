"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, AudioLines, ExternalLink, Info, PanelTopOpen, Sparkles } from "lucide-react";
import { useState } from "react";
import { AlbumArt } from "@/components/AlbumArt";
import { EASE, Equalizer, MaskedHeading, Reveal } from "@/components/motion";
import type { SpotifyAuth } from "@/hooks/useSpotifyAuth";
import { useClientValue } from "@/hooks/useClientValue";
import { appUrl } from "@/lib/spotify/auth";

export function SpotifyMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10.2" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <path d="M6.6 9.2c3.4-1 7-.7 9.9.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.5 12.4c2.8-.8 5.7-.5 8.1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8.3 15.4c2.2-.6 4.4-.4 6.3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

const PREVIEW = [
  { title: "Pale Aurora", artist: "Lune Ascendant", colors: ["#065f46", "#0d9488", "#a7f3d0"] as [string, string, string], seed: 59 },
  { title: "Glass Corridor", artist: "Ivo Marlow", colors: ["#4338ca", "#7c3aed", "#c4b5fd"] as [string, string, string], seed: 27 },
  { title: "Cathedral of Rain", artist: "Mira Solace", colors: ["#1e3a8a", "#3730a3", "#93c5fd"] as [string, string, string], seed: 104 },
];

export function LoginScreen({ auth }: { auth: SpotifyAuth }) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  const connecting = auth.status === "connecting";
  // Resolved from the browser only — SSR paints an empty string, so there is
  // no hydration mismatch and no setState inside an effect.
  const selfUrl = useClientValue(appUrl, "");
  const blocked = auth.breakoutBlocked;

  return (
    <div className="relative z-10 flex h-full w-full items-center justify-center overflow-y-auto thin-scrollbar px-5 py-10">
      <div className="grid w-full max-w-[1120px] items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        {/* --------------------------------- copy -------------------------------- */}
        <div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE }}
            className="flex items-center gap-3"
          >
            <span className="relative grid h-11 w-11 place-items-center overflow-hidden rounded-2xl">
              <span
                className="absolute inset-0 animate-spin-slow"
                style={{
                  background:
                    "conic-gradient(from 0deg, var(--accent-1), var(--accent-2), var(--accent-3), var(--accent-1))",
                }}
              />
              <span className="absolute inset-[1.5px] rounded-[15px] bg-[#0b0c10]" />
              <AudioLines className="relative h-5 w-5 text-white/85" strokeWidth={1.5} />
            </span>
            <span>
              <span className="block font-mono text-[9.5px] uppercase tracking-[0.34em] text-white/40">
                a liquid glass client
              </span>
              <span className="block font-mono text-[9.5px] uppercase tracking-[0.34em] text-white/25">
                for spotify · v7.0.1
              </span>
            </span>
          </motion.div>

          <MaskedHeading
            as="h1"
            className="mt-8 font-display text-[clamp(4rem,11vw,7.5rem)] leading-[0.82] tracking-[-0.03em] text-white"
          >
            Echoes
          </MaskedHeading>

          <Reveal delay={0.18}>
            <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-white/55">
              A quieter way to hold your music. Translucent surfaces, an ambient field that
              re-lights with whatever is playing, and nothing else asking for your attention.
            </p>
          </Reveal>

          <Reveal delay={0.28} className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <motion.button
              type="button"
              onClick={() => void auth.login()}
              disabled={!auth.configured || connecting}
              whileHover={reduce || !auth.configured ? undefined : { scale: 1.02 }}
              whileTap={reduce ? undefined : { scale: 0.985 }}
              className="group glass relative flex items-center justify-center gap-3 overflow-hidden rounded-full px-7 py-4 text-[13.5px] font-semibold text-white transition-all duration-500 disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.25), 0 24px 60px -26px rgba(0,0,0,0.95), 0 0 50px -14px var(--accent-glow)",
              }}
            >
              <span
                className="absolute inset-0 opacity-70 transition-opacity duration-700 group-hover:opacity-100"
                style={{
                  background:
                    "linear-gradient(110deg, color-mix(in oklab, var(--accent-1) 55%, transparent), color-mix(in oklab, var(--accent-3) 45%, transparent))",
                }}
              />
              <span
                className="absolute inset-0 -translate-x-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.28),transparent)] transition-transform duration-[1100ms] group-hover:translate-x-full"
              />
              <SpotifyMark className="relative h-[18px] w-[18px]" />
              <span className="relative">
                {connecting
                  ? "Opening Spotify…"
                  : auth.framed
                    ? "Continue with Spotify"
                    : "Connect with Spotify"}
              </span>
              <ArrowRight className="relative h-4 w-4 transition-transform duration-500 group-hover:translate-x-1" strokeWidth={1.7} />
            </motion.button>

            <button
              type="button"
              onClick={auth.enterDemoMode}
              className="flex items-center justify-center gap-2.5 rounded-full border border-white/12 px-6 py-4 text-[13px] font-medium text-white/62 transition-all duration-400 hover:border-white/28 hover:bg-white/[0.05] hover:text-white"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.6} />
              Explore the demo catalog
            </button>
          </Reveal>

          {auth.framed && (
            <Reveal delay={0.33}>
              <div className="glass-thin mt-6 flex max-w-[520px] items-start gap-3 rounded-[18px] px-4 py-3">
                <PanelTopOpen className="mt-0.5 h-4 w-4 shrink-0 text-white/50" strokeWidth={1.6} />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-white/80">
                    Running inside a preview frame
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-white/45">
                    Spotify refuses to be embedded, so Echoes lifts itself to the top window
                    before handing off — and returns here once you approve.
                    {selfUrl && (
                      <>
                        {" "}
                        <a
                          href={selfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-white/70 underline decoration-white/25 underline-offset-2 transition-colors duration-300 hover:text-white"
                        >
                          Open in a new tab
                          <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </Reveal>
          )}

          {blocked && selfUrl && (
            <a
              href={selfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-3 text-[12.5px] font-semibold text-[#0b0c10] transition-transform duration-400 hover:scale-[1.03]"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              Open Echoes in its own tab
            </a>
          )}

          <Reveal delay={0.36}>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-white/28">
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-emerald-300/70" />
                OAuth 2.0 PKCE · no secret stored
              </span>
              <span className="flex items-center gap-1.5">
                <Equalizer playing bars={3} className="text-white/40" />
                tokens refreshed in the browser
              </span>
            </div>
          </Reveal>

          {!auth.configured && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.45, ease: EASE }}
              className="glass-thin mt-7 max-w-[520px] rounded-[20px] p-4"
            >
              <p className="flex items-center gap-2 text-[12px] font-semibold text-white/80">
                <Info className="h-3.5 w-3.5 text-white/45" strokeWidth={1.7} />
                Add a client id to enable the live connection
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-white/42">
                Create an app in the Spotify dashboard, whitelist{" "}
                <span className="font-mono text-white/60">{selfUrl || "http://localhost:3000/"}</span>{" "}
                as a redirect URI, then set:
              </p>
              <code className="mt-2.5 block overflow-x-auto rounded-xl border border-white/8 bg-black/35 px-3 py-2 font-mono text-[10.5px] text-white/60">
                NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_client_id
              </code>
            </motion.div>
          )}

          {auth.error && (
            <p className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-[12px] text-rose-100/85">
              {auth.error}
            </p>
          )}
        </div>

        {/* ------------------------------ floating preview --------------------- */}
        <div className="relative hidden min-h-[520px] lg:block">
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 1.1, ease: EASE }}
            className="absolute inset-0"
          >
            {/* main "now playing" card */}
            <motion.div
              animate={reduce ? undefined : { y: [0, -12, 0] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
              className="glass sheen absolute left-2 top-6 w-[330px] rounded-[26px] p-4"
              onMouseEnter={() => setHovered(0)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-center gap-3.5">
                <AlbumArt
                  seed={PREVIEW[0].seed}
                  colors={PREVIEW[0].colors}
                  rounded="rounded-xl"
                  className="h-16 w-16 shrink-0"
                  animate={hovered === 0}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-white/92">
                    {PREVIEW[0].title}
                  </p>
                  <p className="truncate text-[11.5px] text-white/45">{PREVIEW[0].artist}</p>
                  <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-white/10">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: "linear-gradient(90deg, var(--accent-1), var(--accent-3))" }}
                      animate={reduce ? { width: "52%" } : { width: ["12%", "88%", "12%"] }}
                      transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </div>
                </div>
                <Equalizer playing={!reduce} bars={4} className="text-[var(--accent-3)]" />
              </div>
            </motion.div>

            {/* queue stack */}
            {PREVIEW.slice(1).map((t, i) => (
              <motion.div
                key={t.title}
                animate={reduce ? undefined : { y: [0, 8 + i * 3, 0] }}
                transition={{ duration: 11 + i * 2, repeat: Infinity, ease: "easeInOut", delay: i * 0.6 }}
                className="glass-thin absolute w-[268px] rounded-[22px] p-3"
                style={{ right: i === 0 ? 6 : 30, top: 190 + i * 84, zIndex: 5 - i }}
                onMouseEnter={() => setHovered(i + 1)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="flex items-center gap-3">
                  <AlbumArt
                    seed={t.seed}
                    colors={t.colors}
                    rounded="rounded-lg"
                    className="h-11 w-11 shrink-0"
                    animate={hovered === i + 1}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-white/85">{t.title}</p>
                    <p className="truncate text-[10.5px] text-white/40">{t.artist}</p>
                  </div>
                </div>
              </motion.div>
            ))}

            {/* personalization chip */}
            <motion.div
              animate={reduce ? undefined : { y: [0, -9, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
              className="glass absolute bottom-8 left-10 w-[236px] rounded-[20px] p-3.5"
              style={{ zIndex: 8 }}
            >
              <p className="font-mono text-[8.5px] uppercase tracking-[0.24em] text-white/35">
                blur intensity
              </p>
              <div className="mt-2.5 h-[3px] rounded-full bg-white/12">
                <motion.span
                  className="block h-full rounded-full bg-white/70"
                  animate={reduce ? { width: "62%" } : { width: ["28%", "82%", "28%"] }}
                  transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
              <div className="mt-3 flex gap-1.5">
                {["#4c3bd4", "#0d9488", "#94a3b8"].map((c, i) => (
                  <span
                    key={c}
                    className="h-5 w-5 rounded-full ring-1 ring-inset ring-white/25"
                    style={{ background: c, transform: hovered === i ? "scale(1.15)" : undefined, transition: "transform .4s" }}
                  />
                ))}
                <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">
                  theme
                </span>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
