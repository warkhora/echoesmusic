"use client";

import { doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { firebaseDb } from "@/lib/firebase";

export type LinkState = "none" | "linked";

/**
 * Records which Spotify account is currently connected to a Firebase user.
 *
 * There is NO cross-matching restriction: any Spotify account may be connected
 * or switched at any time. The document field is informational only; a new
 * account simply overwrites `spotifyId`. Entry to the app is governed solely
 * by "Firebase user present AND Spotify connected" (see the app gate).
 */
export function useAccountLink(
  firebaseUid: string | null,
  spotifyUserId: string | null,
): LinkState {
  const [state, setState] = useState<LinkState | null>(null);

  useEffect(() => {
    if (!firebaseUid || !spotifyUserId) return;
    let alive = true;
    void (async () => {
      try {
        const db = await firebaseDb();
        if (!db || !alive) return;
        await setDoc(
          doc(db, "users", firebaseUid),
          { spotifyId: spotifyUserId, linkedAt: Date.now() },
          { merge: true },
        );
        if (alive) setState("linked");
      } catch (error) {
        console.info("[echoes] account link skipped:", (error as { code?: string })?.code ?? error);
        if (alive) setState("linked"); // never block on a link write
      }
    })();
    return () => {
      alive = false;
    };
  }, [firebaseUid, spotifyUserId]);

  return firebaseUid && spotifyUserId ? (state ?? "none") : "none";
}
