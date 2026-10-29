"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Disc3, ExternalLink, ListMusic, Pause, Play, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { AlbumArt } from "@/components/AlbumArt";
import { Spinner } from "@/components/Spinner";
import Link from "next/link";
import { ArtistLink, ArtistLinks } from "@/components/EntityLink";
import { EASE, Equalizer } from "@/components/motion";
import { Waveform } from "@/components/Waveform";
import { useArtistDetail } from "@/hooks/useArtistDetail";
import { peekArtist } from "@/hooks/useEntityPage";
import { sameArtistTracks } from "@/lib/playback/queue";
import { spotifyArtistUrl } from "@/lib/spotify/detailCache";
import { formatCount, formatTime, type EchoTrack, type Triad } from "@/lib/types";
import { useLibrary } from "@/state/library";
import { usePlayer } from "@/state/player";
import { usePreferences } from "@/state/preferences";

/**
 * The immersive view of the Now Playing panel.
 *
 * It renders inside the panel's own column — the layout grows that column and
 * collapses the main content column to zero width *without unmounting it* — so
 * every provider, the Web Playback SDK and the audio element stay alive and
 * playback is never interrupted by expanding or collapsing.
 */
export function ExpandedNowPlaying({ token }: { token: string | null }) {
  const reduce = useReducedMotion();
  const { prefs } = usePreferences();
  const autoplayOn = prefs.autoplay;
  const {
    current,
    isPlaying,
    toggle,
    upNext,
    upNextIsSequential,
    playSource,
    playFrom,
    queue,
    index,
    autoplayFetching,
  } = usePlayer();
  const { catalog, playlistTracks, savedIds, toggleSaved } = useLibrary();

  const credits = current?.artistList ?? [];
  const primary = credits[0]?.name ?? current?.artist?.split(",")[0]?.trim() ?? null;
  const artistId = credits[0]?.id ?? current?.artistIds?.[0] ?? null;

  // Cache-only: the artist card reuses whatever the compact panel already fetched.
  const { artist } = useArtistDetail(artistId, token);
  const artistPage = artistId ? peekArtist(artistId) : undefined;

  /** Five more tracks by the same artist, from data already in memory. */
  const recommended = useMemo(
    () =>
      sameArtistTracks(
        current,
        { catalog: catalog.tracks, playlistTracks, artistPage: artistPage?.popularTracks },
        5,
      ),
    [current, catalog.tracks, playlistTracks, artistPage],
  );

  /**
   * The artist's other releases — cover, year and kind.
   *
   * Primary source is the cached artist page (zero requests). When it has not
   * been fetched yet — notably in demo mode, which has no Spotify artist pages —
   * the section falls back to grouping the library by album for this artist, so
   * the panel is never an empty void on a large screen.
   */
  const discography = useMemo<DiscEntry[]>(() => {
    const fromPage = (artistPage?.albums ?? [])
      .filter((release) => release.id !== current?.albumId)
      .slice(0, 8)
      .map((release) => ({
        id: release.id,
        name: release.name,
        year: release.year ?? null,
        kind: release.description || "release",
        colors: release.colors,
        imageUrl: release.imageLargeUrl ?? release.imageUrl ?? null,
        href: `/album/${release.id}`,
        tracks: release.tracks ?? [],
      }));
    if (fromPage.length) return fromPage;

    if (!current) return [];
    const ids = new Set(current.artistIds ?? []);
    const primary = (current.artistList?.[0]?.name ?? current.artist.split(",")[0] ?? "")
      .trim()
      .toLowerCase();
    const groups = new Map<string, EchoTrack[]>();
    for (const track of catalog.tracks) {
      const matchById = (track.artistIds ?? []).some((id) => ids.has(id));
      const matchByName =
        (track.artistList?.[0]?.name ?? track.artist.split(",")[0] ?? "").trim().toLowerCase() ===
        primary;
      if ((!matchById && !matchByName) || !track.album) continue;
      const list = groups.get(track.album) ?? [];
      list.push(track);
      groups.set(track.album, list);
    }
    return [...groups.entries()]
      .filter(([name]) => name.toLowerCase() !== (current.album ?? "").toLowerCase())
      .slice(0, 8)
      .map(([name, tracks]) => ({
        id: tracks[0].albumId ?? `group:${name}`,
        name,
        year: tracks[0].year ?? null,
        kind: `${tracks.length} track${tracks.length === 1 ? "" : "s"}`,
        colors: tracks[0].colors,
        imageUrl: tracks[0].imageLargeUrl ?? tracks[0].imageUrl ?? null,
        href: tracks[0].albumId ? `/album/${tracks[0].albumId}` : null,
        tracks,
      }));
  }, [artistPage, current, catalog.tracks]);

  if (!current) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-5 px-8 text-center">
        <motion.span
          animate={reduce ? undefined : { scale: [1, 1.07, 1], opacity: [0.55, 0.9, 0.55] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          className="grid h-20 w-20 place-items-center rounded-3xl"
          style={{
            background:
              "conic-gradient(from 200deg, var(--accent-1), var(--accent-2), var(--accent-3), var(--accent-1))",
            boxShadow: "0 0 70px -12px var(--accent-glow)",
          }}
        />
        <div>
          <h2 className="font-display text-[clamp(2rem,4vw,3rem)] leading-none tracking-tight text-white">
            Nothing playing right now
          </h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-[13px] leading-relaxed text-white/45">
            Start a track and this view fills with the artwork, the artist and what comes next.
          </p>
        </div>
      </div>
    );
  }

  const spotifyUrl = spotifyArtistUrl(artistId, primary);
  const sourceLabel = upNextIsSequential
    ? playSource === "album"
      ? "from this album"
      : playSource === "artist"
        ? "from this artist"
        : playSource === "saved"
          ? "from Saved Songs"
          : "from this playlist"
    : "recommended for you";

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="grid h-full min-h-0 gap-6 overflow-hidden xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.95fr)]"
    >
      {/* ============================ main section ============================ */}
      <div className="flex h-full min-h-0 flex-col gap-4 pr-1">
        {/* Top group keeps its full structural height; the discography below
            takes the remaining space and scrolls internally. */}
        <div className="flex shrink-0 flex-col gap-5">
        <div className="flex flex-col items-center gap-7 lg:flex-row lg:items-end">
          {/* large high-res artwork */}
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: EASE }}
            className="relative shrink-0"
          >
            <span
              className="pointer-events-none absolute -inset-8 -z-10 rounded-[40px] blur-3xl transition-opacity duration-1000"
              style={{
                background: `radial-gradient(circle at 50% 45%, ${current.colors[1]}, transparent 68%)`,
                opacity: isPlaying ? 0.5 : 0.2,
              }}
            />
            <AlbumArt
              seed={current.artSeed}
              colors={current.colors}
              imageUrl={current.imageLargeUrl ?? current.imageUrl}
              rounded="rounded-[26px]"
              className="h-[clamp(168px,17vw,344px)] w-[clamp(168px,17vw,344px)] shadow-[0_44px_90px_-38px_rgba(0,0,0,1)]"
              animate={isPlaying}
            />
            <button
              type="button"
              onClick={toggle}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="absolute bottom-4 right-4 grid h-14 w-14 place-items-center rounded-full bg-white text-[#0b0c10] shadow-[0_18px_40px_rgba(0,0,0,0.65)] transition-transform duration-400 hover:scale-105"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="ml-0.5 h-5 w-5" fill="currentColor" strokeWidth={0} />
              )}
            </button>
          </motion.div>

          {/* title + clickable artists */}
          <div className="min-w-0 flex-1 text-center lg:text-left">
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/35">
              {isPlaying ? "now playing" : "paused"}
              {current.album ? ` · ${current.album}` : ""}
            </p>
            <h2 className="mt-3 font-display text-[clamp(2rem,4.4vw,3.4rem)] font-bold leading-[0.98] tracking-tight text-white">
              {current.title}
            </h2>
            <p className="mt-3 text-[15px] leading-snug text-white/48">
              <ArtistLinks track={current} className="text-white/48" />
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {current.year ? <Chip label={String(current.year)} /> : null}
              <Chip label={formatTime(current.durationMs)} />
              {current.bpm ? <Chip label={`${current.bpm} bpm`} accent /> : null}
              {current.musicalKey ? <Chip label={current.musicalKey} /> : null}
              <button
                type="button"
                onClick={() => void toggleSaved(current)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] transition-colors duration-300 ${
                  savedIds.has(current.id)
                    ? "border-white/18 bg-white/[0.08] text-[var(--accent-3)]"
                    : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white"
                }`}
              >
                {savedIds.has(current.id) ? "saved" : "save"}
              </button>
            </div>
          </div>
        </div>

        {/* atmospheric visualizer */}
        <div className="glass-thin relative flex min-h-[clamp(112px,13vh,196px)] shrink-0 flex-col overflow-hidden rounded-[24px] px-5 py-4">
          <span
            className="pointer-events-none absolute inset-0 opacity-45"
            style={{
              background:
                "radial-gradient(120% 90% at 50% 120%, color-mix(in oklab, var(--accent-1) 55%, transparent), transparent 70%)",
            }}
          />
          <div className="relative flex items-center justify-between gap-3">
            <p className="font-mono text-[8.5px] uppercase tracking-[0.26em] text-white/30">
              atmosphere
            </p>
            <Equalizer playing={isPlaying} className="text-[var(--accent-3)]" bars={4} />
          </div>
          <Waveform
            playing={isPlaying}
            seed={current.id}
            className="relative mt-4 min-h-[clamp(76px,10vh,152px)] flex-1"
          />
        </div>

        {/* artist card */}
        <div className="glass-thin flex items-center gap-4 rounded-[24px] p-4">
          <span className="relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-white/20">
            {artist?.imageLargeUrl || artist?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={artist.imageLargeUrl ?? artist.imageUrl ?? undefined}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <AlbumArt
                seed={(primary ?? "artist").length * 29 + 5}
                colors={artist?.colors ?? current.colors}
                rounded="rounded-full"
                className="h-full w-full"
                animate={false}
              />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[8.5px] uppercase tracking-[0.26em] text-white/30">
              {typeof artist?.listeners === "number" && artist.listeners > 0
                ? `${formatCount(artist.listeners)} listeners`
                : "artist"}
            </p>
            <p className="mt-1 truncate text-[19px] font-bold tracking-tight text-white">
              <ArtistLink
                id={artistId ?? artist?.id}
                name={artist?.name ?? primary ?? "Unknown artist"}
                className="text-white hover:text-white"
              />
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-white/40">
              {artist?.genres?.length
                ? artist.genres.slice(0, 3).join(" · ")
                : artist?.bio && artist.bio !== "Artist on Spotify"
                  ? artist.bio
                  : "Spotify exposes no biography for this artist."}
            </p>
          </div>
          <a
            href={spotifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[11.5px] font-semibold text-[#0b0c10] transition-transform duration-400 hover:scale-[1.03]"
          >
            View on Spotify
            <ExternalLink
              className="h-3.5 w-3.5 transition-transform duration-400 group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </a>
        </div>

        </div>

        {/* ------------------------- artist discography -------------------------
            Fills the remaining height and scrolls internally so it can never
            push up or squeeze the sections above. */}
        <section className="glass-thin thin-scrollbar min-h-0 flex-1 overflow-y-auto rounded-[24px] p-4 2xl:p-5">
          <header className="flex items-end justify-between gap-3 px-1 pb-3">
            <div>
              <p className="flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.26em] text-white/32">
                <Disc3 className="h-3 w-3 text-[var(--accent-3)]" strokeWidth={1.8} />
                releases
              </p>
              <h3 className="mt-1.5 font-display text-[22px] leading-none tracking-tight text-white 2xl:text-[26px]">
                Artist Discography
              </h3>
            </div>
            <span className="font-mono text-[9px] text-white/25">
              {discography.length
                ? `${discography.length} release${discography.length === 1 ? "" : "s"}`
                : "none yet"}
            </span>
          </header>

          {discography.length === 0 ? (
            <div className="flex items-center justify-between gap-4 px-1 py-4">
              <p className="text-[12px] leading-relaxed text-white/40">
                No other releases are cached yet. Open the artist page once and Echoes will keep
                their albums and singles here.
              </p>
              {artistId && (
                <Link
                  href={`/artist/${artistId}`}
                  className="glass-thin shrink-0 rounded-full px-3.5 py-2 text-[11px] font-medium text-white/70 transition-colors duration-300 hover:text-white"
                >
                  Open artist page
                </Link>
              )}
            </div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(clamp(118px,9vw,196px),1fr))] 2xl:gap-4">
              {discography.map((release) => {
                const Shell: "a" | "button" = release.href ? "a" : "button";
                return (
                <Shell
                  key={release.id}
                  {...(release.href
                    ? { href: release.href }
                    : {
                        type: "button" as const,
                        onClick: () =>
                          release.tracks.length &&
                          playFrom({
                            track: release.tracks[0],
                            tracks: release.tracks,
                            index: 0,
                            source: "album" as const,
                          }),
                      })}
                  className="group block rounded-[16px] p-2 text-left transition-colors duration-300 hover:bg-white/[0.06] 2xl:p-2.5"
                >
                  <span className="relative block overflow-hidden rounded-[12px]">
                    <AlbumArt
                      seed={release.id.length * 19 + release.name.length}
                      colors={release.colors}
                      imageUrl={release.imageUrl}
                      rounded="rounded-[12px]"
                      className="aspect-square w-full transition-transform duration-[1.1s] group-hover:scale-[1.05]"
                      animate={false}
                    />
                    <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/35" />
                  </span>
                  <span className="mt-2 block truncate px-0.5 text-[12.5px] font-medium text-white/88 2xl:text-[13.5px]">
                    {release.name}
                  </span>
                  <span className="mt-0.5 block truncate px-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white/32">
                    {release.year ?? "—"} · {release.kind}
                  </span>
                </Shell>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* =========================== sidebar section =========================== */}
      <div className="thin-scrollbar flex min-h-0 flex-col gap-6 overflow-y-auto pr-1 2xl:gap-7">
        {/* recommended from the current artist */}
        <section className="glass-thin flex min-h-0 flex-[1.25] flex-col rounded-[24px] p-4 2xl:p-6">
          <header className="flex items-center gap-2 px-1 pb-3 2xl:pb-4">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-3)]" strokeWidth={1.8} />
            <p className="flex-1 font-mono text-[9px] uppercase tracking-[0.26em] text-white/34">
              more from {primary ?? "this artist"}
            </p>
            <span className="font-mono text-[9px] text-white/24">{recommended.length}/5</span>
          </header>
          {recommended.length === 0 ? (
            <p className="px-1 py-4 text-[12px] leading-relaxed text-white/40">
              No other tracks by this artist are in your library yet. Open their page to see the full
              discography.
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 2xl:gap-2">
              {recommended.map((track) => (
                <li key={track.id} className="flex min-h-[clamp(66px,7.5vh,132px)] flex-1">
                  <MiniRow
                    track={track}
                    playing={isPlaying}
                    large
                    onPlay={() =>
                      playFrom({ track, tracks: [current, ...recommended], index: 0, source: "artist" })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* next up */}
        <section className="glass-thin flex min-h-0 flex-1 flex-col rounded-[24px] p-4 2xl:p-6">
          <header className="flex items-center gap-2 px-1 pb-3 2xl:pb-4">
            <ListMusic className="h-3.5 w-3.5 text-white/42" strokeWidth={1.8} />
            <p className="flex-1 font-mono text-[9px] uppercase tracking-[0.26em] text-white/34">
              next up
            </p>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/24">
              {sourceLabel}
            </span>
          </header>
          {upNext.length === 0 && !autoplayFetching ? (
            <p className="px-1 py-4 text-[12px] leading-relaxed text-white/40">
              {autoplayOn
                ? "Nothing queued yet — Echoes appends similar tracks as this track nears its end."
                : "Nothing queued. Autoplay is off, so playback stops when this track ends."}
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 2xl:gap-2">
              {autoplayFetching && (
                <li className="flex items-center gap-2 px-2 py-2 text-[11px] text-white/38">
                  <Spinner size={11} />
                  finding similar tracks…
                </li>
              )}
              {upNext.map((track, position) => (
                <li key={`${track.id}-${position}`} className="flex min-h-[clamp(66px,7.5vh,132px)] flex-1">
                  <MiniRow
                    track={track}
                    playing={isPlaying}
                    large
                    index={position + 1}
                    onPlay={() => {
                      const at = queue.findIndex((item) => item.id === track.id);
                      playFrom({
                        track,
                        tracks: at >= 0 ? queue : [...queue, ...upNext],
                        index: at >= 0 ? at : queue.length + position,
                        source: upNextIsSequential ? playSource : "queue",
                      });
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-auto px-1 pt-4 font-mono text-[9px] uppercase tracking-[0.2em] text-white/22">
            blur {prefs.blurIntensity}px · {prefs.font1} / {prefs.font2}
          </p>
        </section>
      </div>
    </motion.div>
  );
}

interface DiscEntry {
  id: string;
  name: string;
  year: number | null;
  kind: string;
  colors: Triad;
  imageUrl: string | null;
  /** Album page when a real id exists; null means "play it" instead. */
  href: string | null;
  tracks: EchoTrack[];
}

function Chip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] ${
        accent
          ? "border-white/14 bg-white/[0.07] text-[var(--accent-3)]"
          : "border-white/10 bg-white/[0.03] text-white/40"
      }`}
    >
      {label}
    </span>
  );
}

/**
 * Immersive-scale row: larger cover, generous padding, and `h-full` so the row
 * stretches with its list item and the cards fill tall screens instead of
 * leaving an empty interior.
 */
function MiniRow({
  track,
  playing,
  onPlay,
  index,
  large,
}: {
  track: EchoTrack;
  playing: boolean;
  onPlay: () => void;
  index?: number;
  large?: boolean;
}) {
  const auto = Boolean(track.auto);
  return (
    <button
      type="button"
      onClick={onPlay}
      className={`group flex h-full w-full items-center rounded-[16px] text-left transition-colors duration-300 hover:bg-white/[0.07] ${
        large ? "gap-4 px-3 py-3.5 2xl:px-4 2xl:py-4" : "gap-2.5 px-2 py-2"
      }`}
    >
      <span className={`relative shrink-0 overflow-hidden rounded-xl ${large ? "h-[clamp(44px,3.4vw,78px)] w-[clamp(44px,3.4vw,78px)]" : "h-[clamp(34px,2.4vw,54px)] w-[clamp(34px,2.4vw,54px)]"}`}>
        <AlbumArt
          seed={track.artSeed}
          colors={track.colors}
          imageUrl={track.imageUrl}
          rounded="rounded-xl"
          className="h-full w-full"
          animate={false}
        />
        <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/55" />
        <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <Play className="ml-0.5 h-4 w-4 text-white" fill="currentColor" strokeWidth={0} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-medium text-white/90 ${large ? "text-[14px] 2xl:text-[15px]" : "text-[12px]"}`}>
          {track.title}
        </span>
        <span className={`mt-0.5 block truncate text-white/40 ${large ? "text-[12px] 2xl:text-[12.5px]" : "text-[10.5px]"}`}>
          <ArtistLinks track={track} />
        </span>
      </span>
      {auto && (
        <span
          title="Smart recommendation appended by Autoplay"
          className="shrink-0 rounded-full border border-white/12 bg-white/[0.06] px-2 py-[3px] font-mono text-[7.5px] uppercase tracking-[0.16em] text-[var(--accent-3)]/90"
        >
          autoplay
        </span>
      )}
      <span className={`tnum shrink-0 font-mono text-white/30 ${large ? "text-[11px] 2xl:text-[12px]" : "text-[9.5px]"}`}>
        {index ?? formatTime(track.durationMs)}
      </span>
      <span className="sr-only">{playing ? "currently playing" : "play"}</span>
    </button>
  );
}
