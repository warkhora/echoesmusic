export type ViewId = "home" | "playlists" | "saved" | "activity";

export const VIEW_META: Record<ViewId, { title: string; subtitle: string }> = {
  home: { title: "Home", subtitle: "A calm surface for everything you listen to" },
  playlists: { title: "Playlists", subtitle: "Collections, ordered the way you think" },
  saved: { title: "Saved Tracks", subtitle: "Everything you kept" },
  activity: { title: "Activity", subtitle: "Your listening, measured in minutes" },
};

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still awake";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
