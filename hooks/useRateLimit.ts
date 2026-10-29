"use client";

import { useEffect, useState } from "react";
import { rateLimitInfo } from "@/lib/spotify/rateLimit";

/**
 * Reflects the global 429 breaker in the UI.
 *
 * It polls the breaker's own countdown — never Spotify — so a rate-limited
 * session can explain itself without issuing another request.
 */
export function useRateLimit(): { blocked: boolean; remainingMs: number; hits: number } {
  const [info, setInfo] = useState(() => {
    const state = rateLimitInfo();
    return { blocked: state.blocked, remainingMs: state.remainingMs, hits: state.hits };
  });

  useEffect(() => {
    if (!info.blocked) return;
    const id = window.setInterval(() => {
      const state = rateLimitInfo();
      setInfo({ blocked: state.blocked, remainingMs: state.remainingMs, hits: state.hits });
      if (!state.blocked) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [info.blocked]);

  return info;
}
