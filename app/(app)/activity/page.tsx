"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ActivityView } from "@/components/views/ActivityView";
import { useNav } from "@/state/nav";

/**
 * `/activity` — the dedicated Activity route (live Firestore feed + analytics).
 * Shares the route-group layout, so playback and providers stay mounted.
 */
export default function ActivityRoute() {
  const nav = useNav();
  const router = useRouter();

  useEffect(() => {
    nav.navigate("activity");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (nav.view !== "activity") router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.view]);

  return <ActivityView />;
}
