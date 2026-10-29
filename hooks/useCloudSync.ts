"use client";

import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { useEffect, useRef } from "react";
import { firebaseDb } from "@/lib/firebase";
import { listPalettes, replacePalettes, type CustomPalette } from "@/lib/design";
import type { Preferences } from "@/lib/types";

/**
 * Firestore mirror of the listener's state: `users/{userId}`.
 *
 *   { prefs, palettes, rev, updatedAt }
 *
 * Listening history is NOT stored here: it lives as individual documents under
 * `/users/{uid}/history/{historyId}` (see services/historyService) so the main
 * document never carries a large array or trips the rules' list limits.
 *
 * localStorage remains the instant, offline-capable cache; Firestore is the
 * durable, cross-device source of truth once the listener signs in. On sign-in
 * the remote document wins when it exists (and is newer); when it is empty the
 * local state is uploaded, which is the migration path.
 *
 * Writes are debounced and carry a monotonically increasing `rev`; snapshots
 * with a `rev` we already wrote are ignored, so our own write never bounces
 * back as a remote update.
 */

interface CloudDoc {
  prefs?: Partial<Preferences>;
  palettes?: CustomPalette[];
  rev?: number;
  updatedAt?: number;
}


export function useCloudSync(options: {
  user: User | null;
  prefs: Preferences;
  /** Incremented by user-driven preference commits only. */
  dirtyTick: number;
  palettesVersion: number;
  applyCloudPrefs: (prefs: Partial<Preferences>) => void;
}): void {
  const { user, prefs, dirtyTick, palettesVersion, applyCloudPrefs } = options;
  const uid = user?.uid ?? null;

  const appliedRev = useRef(0);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  // First sign-in: if the cloud document doesn't exist yet, seed it with the
  // local preferences/palettes so user data is never lost and writes never
  // fail against an uninitialized document.
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void (async () => {
      try {
        const db = await firebaseDb();
        if (!db || !alive) return;
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        if (!alive || snap.exists()) return;
        await setDoc(
          ref,
          { prefs: prefsRef.current, palettes: listPalettes(), rev: 1, updatedAt: Date.now() },
          { merge: true },
        );
      } catch (error) {
        console.info("[echoes] initial cloud seed skipped:", (error as { code?: string })?.code ?? error);
      }
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  /* ------------------------- load + subscribe on sign-in ------------------------- */
  useEffect(() => {
    if (!uid) {
      appliedRev.current = 0;
      return;
    }
    let alive = true;
    let unsubscribe: (() => void) | null = null;

    const applyDoc = (data: CloudDoc, rev: number) => {
      appliedRev.current = rev;
      if (data.prefs) applyCloudPrefs(data.prefs);
      if (Array.isArray(data.palettes)) replacePalettes(data.palettes);
    };

    void (async () => {
      const db = await firebaseDb();
      if (!db || !alive) return;
      const ref = doc(db, "users", uid);

      try {
        const snapshot = await getDoc(ref);
        if (!alive) return;
        if (snapshot.exists()) {
          const data = snapshot.data() as CloudDoc;
          applyDoc(data, data.rev ?? 0);
        } else {
          // Empty remote document: migrate the local state up.
          const rev = 1;
          appliedRev.current = rev;
          await setDoc(ref, {
            prefs: prefsRef.current,
            palettes: listPalettes(),
            rev,
            updatedAt: Date.now(),
          });
        }

        unsubscribe = onSnapshot(
          ref,
          (change) => {
            if (!alive || !change.exists()) return;
            const data = change.data() as CloudDoc;
            const rev = data.rev ?? 0;
            if (rev <= appliedRev.current) return; // our own write, or stale
            applyDoc(data, rev);
          },
          (error) => {
            // Permission or network problems must never break the local app.
            console.warn("[echoes] firestore sync unavailable:", error.code);
          },
        );
      } catch (error) {
        console.warn("[echoes] firestore load unavailable:", error instanceof Error ? error.message : error);
      }
    })();

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [uid, applyCloudPrefs]);

  /* ------------------------------ debounced push ------------------------------ */
  useEffect(() => {
    if (!uid || !dirtyTick) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const db = await firebaseDb();
        if (!db) return;
        const rev = appliedRev.current + 1;
        appliedRev.current = rev;
        try {
          await setDoc(
            doc(db, "users", uid),
            {
              prefs: prefsRef.current,
              palettes: listPalettes(),
              rev,
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        } catch (error) {
          // Offline or denied: localStorage still holds everything.
          console.warn("[echoes] firestore write skipped:", (error as { code?: string }).code ?? error);
          appliedRev.current = rev - 1; // retry on the next change
        }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [uid, dirtyTick, palettesVersion]);
}
