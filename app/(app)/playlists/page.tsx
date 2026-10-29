"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PlaylistsView } from "@/components/views/PlaylistsView";
import { useNav } from "@/state/nav";

/**
 * `/playlists` — a real, linkable route for the Playlists screen (including the
 * Community Playlists toggle). It shares the route-group layout, so the player,
 * providers and shell stay mounted exactly as on `/`.
 */
export default function PlaylistsRoute() {
  const nav = useNav();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep the sidebar highlight in step with this route on mount…
  useEffect(() => {
    nav.navigate("playlists", selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // …and hand control back to the browse route if the sidebar navigates away,
  // so the URL and the visible screen never disagree.
  useEffect(() => {
    if (nav.view !== "playlists") router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.view]);

  return <PlaylistsView selectedId={selectedId} onSelect={setSelectedId} />;
}
