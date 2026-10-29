import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    /**
     * Echoes ships no `@vercel/analytics`, `@vercel/speed-insights` or
     * `@vercel/toolbar` package — verified in package.json and across src/.
     * The preview toolbar (and its "Missing param(s) [teamSlug]" route warning)
     * is injected by the hosting platform, so it is turned off with Vercel's
     * documented flag rather than by patching the document.
     */
    VERCEL_TOOLBAR_DISABLE: "1",
  },
};

export default nextConfig;
