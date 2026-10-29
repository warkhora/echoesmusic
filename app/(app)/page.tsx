"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ActivityView } from "@/components/views/ActivityView";
import { HomeView } from "@/components/views/HomeView";
import { PlaylistsView } from "@/components/views/PlaylistsView";
import { SavedView } from "@/components/views/SavedView";
import { EASE } from "@/components/motion";
import { useNav } from "@/state/nav";

/**
 * The browse surface: Home, Playlists, Saved and Activity share one route so
 * they keep their scroll position and playlist drill-down state. Albums and
 * artists are real routes under the same layout, so the player never unmounts.
 */
export default function BrowsePage() {
  const { view, selectedPlaylist, navigate } = useNav();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view + (selectedPlaylist ?? "")}
        initial={reduce ? { opacity: 1 } : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        {view === "home" && <HomeView onNavigate={navigate} />}
        {view === "playlists" && (
          <PlaylistsView selectedId={selectedPlaylist} onSelect={(id) => navigate("playlists", id)} />
        )}
        {view === "saved" && <SavedView />}
        {view === "activity" && <ActivityView />}
      </motion.div>
    </AnimatePresence>
  );
}
