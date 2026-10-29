"use client";

import { use } from "react";
import { ArtistView } from "@/components/views/ArtistView";

/** `/artist/[id]` — rendered inside the shared layout, so playback never stops. */
export default function ArtistRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ArtistView artistId={id} />;
}
