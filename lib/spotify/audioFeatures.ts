import { safeJson } from "@/lib/http";
import {
  isRateLimitStatus,
  noteRateLimit,
  noteSuccess,
  rateLimited,
  retryAfterSeconds,
} from "@/lib/spotify/rateLimit";
import { notifyMetadata, subscribeMetadata, metadataVersion } from "@/lib/spotify/detailCache";

/**
 * Batched audio features (BPM, key, energy…).
 *
 * One request per 50 track ids — never one per track. Results live in a global
 * Map mirrored to `localStorage`, so returning to a playlist costs zero network
 * calls even after a full page reload. A 429 halts the session rather than
 * retrying, and an app whose client id is not entitled to `/audio-features`
 * (Spotify removed it for most apps created after November 2024) is detected
 * once and never asked again.
 */

export interface AudioFeatureValue {
  bpm: number | null;
  musicalKey: string | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
}

export const FEATURES_BATCH_SIZE = 50;
const LS_KEY = "echoes.audioFeatures.v1";
const LS_LIMIT = 900; // keep the mirror small enough for a 5 MB quota

const cache = new Map<string, AudioFeatureValue>();
const inflight = new Set<string>();
let unavailable = false;
let hydrated = false;

/* ------------------------------ persistence ------------------------------ */

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, AudioFeatureValue>;
    for (const [id, value] of Object.entries(parsed)) {
      if (value && typeof value === "object") cache.set(id, value);
    }
  } catch {
    /* corrupt mirror — the network path still works */
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    const entries = [...cache.entries()].slice(-LS_LIMIT);
    window.localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* quota or private mode — the in-memory cache still serves this session */
  }
}

/* -------------------------------- reads ---------------------------------- */

/** Cache-only read: rendering a BPM cell must never trigger a request. */
export function getCachedFeatures(trackId: string | null | undefined): AudioFeatureValue | null {
  if (!trackId) return null;
  hydrate();
  return cache.get(trackId) ?? null;
}

export function cachedBpm(trackId: string | null | undefined): number | null {
  return getCachedFeatures(trackId)?.bpm ?? null;
}

/** True when Spotify has told us this app may not read audio features at all. */
export function featuresUnavailable(): boolean {
  return unavailable;
}

export { subscribeMetadata, metadataVersion };

/* ------------------------------- fetching -------------------------------- */

/** Ids we do not already know, in batches of 50, one request per batch. */
export function planBatches(trackIds: string[]): string[][] {
  hydrate();
  const missing = [...new Set(trackIds)].filter((id) => id && !cache.has(id) && !inflight.has(id));
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += FEATURES_BATCH_SIZE) {
    batches.push(missing.slice(i, i + FEATURES_BATCH_SIZE));
  }
  return batches;
}

/**
 * Fetches features for every id we are missing. Safe to call on every list
 * render: cached and in-flight ids are filtered out first, so a repeat call is
 * a no-op with zero requests.
 */
export async function requestFeatures(
  trackIds: string[],
  token: string | null,
): Promise<number> {
  hydrate();
  if (!token || unavailable || rateLimited()) return 0;

  const batches = planBatches(trackIds);
  if (!batches.length) return 0;

  let stored = 0;
  for (const batch of batches) {
    batch.forEach((id) => inflight.add(id));
    try {
      const res = await fetch("/api/spotify/features", {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
        cache: "no-store",
        body: JSON.stringify({ ids: batch }),
      });

      if (isRateLimitStatus(res.status)) {
        noteRateLimit("/audio-features", retryAfterSeconds(res.headers));
        return stored;
      }
      if (res.status === 403 || res.status === 404) {
        // Client id not entitled — stop asking for the life of this session.
        unavailable = true;
        console.info(
          "[echoes] /audio-features is not available to this Spotify app; BPM will show “-”.",
        );
        return stored;
      }
      if (!res.ok) continue;

      const data = await safeJson<{ features?: Record<string, AudioFeatureValue> }>(res);
      const features = data?.features;
      if (!features) continue;

      for (const [id, value] of Object.entries(features)) {
        if (!value) continue;
        cache.set(id, value);
        stored += 1;
      }
      noteSuccess();
    } catch (error) {
      console.info("[echoes] audio features unavailable", error instanceof Error ? error.message : error);
    } finally {
      batch.forEach((id) => inflight.delete(id));
    }
  }

  if (stored > 0) {
    persist();
    notifyMetadata(); // re-render the tables so BPM appears without a refetch
  }
  return stored;
}

/** Seeds the cache from data the server already returned (library/playlist). */
export function seedFeatures(entries: Record<string, Partial<AudioFeatureValue>> | undefined | null): void {
  if (!entries) return;
  hydrate();
  let added = 0;
  for (const [id, value] of Object.entries(entries)) {
    if (!id || !value || value.bpm === undefined) continue;
    if (cache.has(id)) continue;
    cache.set(id, {
      bpm: value.bpm ?? null,
      musicalKey: value.musicalKey ?? null,
      energy: value.energy ?? null,
      danceability: value.danceability ?? null,
      valence: value.valence ?? null,
    });
    added += 1;
  }
  if (added > 0) {
    persist();
    notifyMetadata();
  }
}
