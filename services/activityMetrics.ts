export interface HistoryEntry {
  /** Equal to trackId — ONE document per track per user (no per-session dupes). */
  id: string;
  trackId: string;
  title: string;
  artist: string;
  albumArt: string | null;
  genre: string;
  /** Last activity timestamp (feed ordering). */
  timestamp: number;
  firstPlayedAt: number;
  lastPlayedAt: number;
  /** TRUE accumulated listening seconds (seek-safe). */
  durationPlayedSeconds: number;
  totalDurationSeconds: number;
  completionPercentage: number;
  /** +1 for every 30 s of accumulated listening on this track. */
  playCount: number;
  source: string;
  updatedAt: number;
}

/** Seconds of real listening that count as one "play". */
export const PLAY_CREDIT_SECONDS = 30;

/**
 * Pure, Firebase-free analytics helpers. Kept separate from historyService so
 * they can be unit-tested and imported without pulling in the Firestore SDK.
 */

/** Empty/null-safe aggregation over a feed. Never throws. */
export interface HistoryBase {
  playtimeSeconds: number;
  playCount: number;
  firstPlayedAt: number;
}

export interface ActivityMetrics {
  plays: number;
  totalSeconds: number;
  completion: number;
  topTracks: { trackId: string; title: string; artist: string; albumArt: string | null; count: number }[];
}

export function computeMetrics(entries: HistoryEntry[] | null | undefined, cutoffMs: number | null): ActivityMetrics {
  const list = Array.isArray(entries) ? entries : [];
  const now = Date.now();
  const inPeriod = cutoffMs === null ? list : list.filter((e) => now - (e.timestamp ?? now) <= cutoffMs);

  const totalSeconds = inPeriod.reduce((sum, e) => sum + (Number(e.durationPlayedSeconds) || 0), 0);
  const completion = inPeriod.length
    ? Math.round(inPeriod.reduce((sum, e) => sum + (Number(e.completionPercentage) || 0), 0) / inPeriod.length)
    : 0;

  // One document per track, so each entry IS the aggregate; rank by playCount.
  const counts = new Map<string, { entry: HistoryEntry; count: number }>();
  for (const entry of inPeriod) {
    const key = entry.trackId || entry.title;
    const existing = counts.get(key);
    const plays = Math.max(1, entry.playCount ?? 0);
    if (existing) existing.count += plays;
    else counts.set(key, { entry, count: plays });
  }
  const topTracks = [...counts.values()]
    .sort((a, b) => b.count - a.count || (b.entry.timestamp ?? 0) - (a.entry.timestamp ?? 0))
    .slice(0, 8)
    .map(({ entry, count }) => ({
      trackId: entry.trackId,
      title: entry.title,
      artist: entry.artist,
      albumArt: entry.albumArt ?? null,
      count,
    }));

  return { plays: inPeriod.length, totalSeconds, completion, topTracks };
}

/**
 * Collapses consecutive history documents for the same track into the latest
 * one, so the Listening Feed shows one row per play/transition instead of a
 * vertical run of identical tracks produced by progress updates.
 */
export function collapseConsecutive(entries: HistoryEntry[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const entry of entries) {
    const prev = out[out.length - 1];
    if (prev && prev.trackId === entry.trackId) {
      out[out.length - 1] = entry; // keep the most recent state of this play
      continue;
    }
    out.push(entry);
  }
  return out;
}

export function relativeLabel(timestamp: number): string {
  const mins = Math.round((Date.now() - (timestamp || Date.now())) / 60000);
  if (mins < 1) return "Just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatListenDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${seconds}s`;
}

