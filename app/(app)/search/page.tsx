"use client";

import { use } from "react";
import { SearchView } from "@/components/views/SearchView";

/** `/search?q=…` — full results, rendered inside the shared layout. */
export default function SearchRoute({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = use(searchParams);
  return <SearchView initialQuery={q ?? ""} />;
}
