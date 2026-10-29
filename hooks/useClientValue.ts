"use client";

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => undefined;

/**
 * Reads a browser-only value (frame position, current URL, storage…) without a
 * hydration mismatch and without calling setState inside an effect.
 *
 * `getSnapshot` must return a primitive or a stable reference.
 */
export function useClientValue<T>(getSnapshot: () => T, serverValue: T): T {
  return useSyncExternalStore(
    subscribeNoop,
    getSnapshot,
    () => serverValue,
  );
}
