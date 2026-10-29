"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

/**
 * Clickable entity names.
 *
 * Artists route to `/artist/[id]`; track titles and album names route to
 * `/album/[id]`. Every link stops propagation so clicking a name inside a track
 * row does not also start playback, and falls back to plain text when the id is
 * unknown (demo catalog, or a simplified object Spotify did not expand).
 */
const LINK_CLASS =
  "transition-colors duration-300 hover:text-white hover:underline decoration-white/30 underline-offset-2";

/**
 * Shared link behaviour: stop the click from also triggering the row's play
 * action, and short-circuit when the target is the route we are already on so a
 * redundant navigation cannot re-mount the page or re-run its fetch.
 */
function useEntityLink(href: string | null) {
  const pathname = usePathname();
  const alreadyHere = Boolean(href) && pathname === href;
  return {
    alreadyHere,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      if (alreadyHere) event.preventDefault();
    },
  };
}

export function ArtistLink({
  id,
  name,
  className = "",
}: {
  id?: string | null;
  name: string;
  className?: string;
}) {
  const href = id ? `/artist/${id}` : null;
  const { alreadyHere, onClick } = useEntityLink(href);
  if (!href || alreadyHere) return <span className={className}>{name}</span>;
  return (
    <Link href={href} onClick={onClick} className={`${LINK_CLASS} ${className}`}>
      {name}
    </Link>
  );
}

export function AlbumLink({
  id,
  name,
  className = "",
}: {
  id?: string | null;
  name: string;
  className?: string;
}) {
  const href = id ? `/album/${id}` : null;
  const { alreadyHere, onClick } = useEntityLink(href);
  if (!href || alreadyHere) return <span className={className}>{name}</span>;
  return (
    <Link href={href} onClick={onClick} className={`${LINK_CLASS} ${className}`}>
      {name}
    </Link>
  );
}

/**
 * Every artist on a track, each individually linked to `/artist/[id]`.
 *
 * Uses the structured credits when Spotify supplied them; otherwise it splits
 * the display string and renders plain text (demo catalog tracks carry no ids).
 */
export function ArtistLinks({
  track,
  className = "",
  separator = ", ",
}: {
  track: import("@/lib/types").EchoTrack;
  className?: string;
  separator?: string;
}) {
  const credits = track.artistList ?? [];
  if (credits.length) {
    return (
      <span className={className}>
        {credits.map((credit, index) => (
          <span key={`${credit.id || credit.name}-${index}`}>
            {index > 0 && <span className="text-white/28">{separator}</span>}
            <ArtistLink id={credit.id || null} name={credit.name} />
          </span>
        ))}
      </span>
    );
  }

  const names = track.artist.split(",").map((name) => name.trim()).filter(Boolean);
  const ids = track.artistIds ?? [];
  return (
    <span className={className}>
      {names.map((name, index) => (
        <span key={`${name}-${index}`}>
          {index > 0 && <span className="text-white/28">{separator}</span>}
          <ArtistLink id={ids[index] ?? null} name={name} />
        </span>
      ))}
    </span>
  );
}

/** Back navigation that works from either entity route. */
export function BackLink({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      className="group flex w-fit items-center gap-2 text-[12px] font-medium text-white/45 transition-colors duration-300 hover:text-white"
    >
      <span className="transition-transform duration-400 group-hover:-translate-x-1">←</span>
      {label}
    </button>
  );
}
