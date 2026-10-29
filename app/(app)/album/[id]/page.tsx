"use client";

import { use } from "react";
import { AlbumView } from "@/components/views/AlbumView";

/** `/album/[id]` — rendered inside the shared layout, so playback never stops. */
export default function AlbumRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AlbumView albumId={id} />;
}
