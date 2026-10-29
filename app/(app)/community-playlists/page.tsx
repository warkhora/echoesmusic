"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Globe } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { AlbumArt } from "@/components/AlbumArt";
import { EASE, Reveal } from "@/components/motion";
import { useEchoesPlaylists } from "@/hooks/useEchoesPlaylists";
import { useFirebase } from "@/hooks/useFirebaseAuth";
import type { EchoesPlaylistMeta } from "@/lib/echoesPlaylists";

/**
 * `/community-playlists` — the dedicated, separate home for playlists that
 * Echoes users have published. Nothing here is mixed into the private library
 * at `/playlists`; this page reads ONLY `/community_playlists` documents whose
 * `isPublicInEchoes == true`.
 */
export default function CommunityPlaylistsRoute() {
  const firebase = useFirebase();
  const echoes = useEchoesPlaylists(firebase.user);
  const reduce = useReducedMotion();

  useEffect(() => {
    void echoes.loadCommunity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE }}
      className="flex flex-col gap-6 pb-6"
    >
      <Link
        href="/playlists"
        className="group flex w-fit items-center gap-2 text-[12px] font-medium text-white/45 transition-colors duration-300 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-400 group-hover:-translate-x-1" strokeWidth={1.7} />
        Back to my playlists
      </Link>

      {/* Font 2 heading + Font 1 gray subtitle */}
      <div>
        <h1 className="font-display text-[clamp(2.2rem,5vw,3.6rem)] leading-[0.95] tracking-tight text-white">
          Community Playlists
        </h1>
        <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-white/45">
          Discover playlists published by the Echoes community. Playlists here are hosted
          exclusively within Echoes regardless of their Spotify visibility. To publish your own,
          click the settings gear on any of your playlists in your library.
        </p>
      </div>

      {echoes.communityLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-[250px] rounded-[24px]" />
          ))}
        </div>
      ) : echoes.community.length === 0 ? (
        <div className="glass-thin rounded-[26px] p-12 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-white/12 bg-white/[0.04]">
            <Globe className="h-5 w-5 text-white/45" strokeWidth={1.5} />
          </span>
          <h2 className="mt-5 font-display text-[26px] tracking-tight text-white">
            No community playlists published yet. Be the first to share one!
          </h2>
          <p className="mx-auto mt-2 max-w-[52ch] text-[12.5px] leading-relaxed text-white/42">
            Open your library, tap the settings gear on a playlist, and switch “Public in Echoes”
            on to publish it here.
          </p>
          <Link
            href="/playlists"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[12px] font-semibold text-[#0b0c10] transition-transform duration-400 hover:scale-[1.03]"
          >
            Go to my playlists
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {echoes.community.map((meta, i) => (
            <CommunityCard key={`${meta.ownerUid}:${meta.playlistId}`} meta={meta} index={i} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

/** A published playlist from another listener. Display-only. */
function CommunityCard({ meta, index }: { meta: EchoesPlaylistMeta; index: number }) {
  return (
    <Reveal delay={index * 0.04}>
      <div className="glass-card group relative block w-full overflow-hidden rounded-[24px] p-3.5">
        <div className="relative overflow-hidden rounded-[17px]">
          <AlbumArt
            seed={meta.playlistId.length * 13 + meta.name.length}
            colors={meta.colors}
            rounded="rounded-[17px]"
            className="h-[clamp(120px,10vw,230px)] w-full"
            animate={false}
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-transparent" />
          <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.18em] text-emerald-100/90">
            <Globe className="h-2.5 w-2.5" strokeWidth={2} />
            public
          </span>
        </div>
        <div className="relative mt-3.5 px-0.5">
          <p className="truncate text-[14px] font-semibold tracking-tight text-white/92">{meta.name}</p>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-white/40">
            {meta.description || "A public Echoes playlist."}
          </p>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-white/28">
            {meta.trackCount} tracks · {meta.ownerName}
          </p>
        </div>
      </div>
    </Reveal>
  );
}
