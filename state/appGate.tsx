"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Application gate.
 *
 * Nothing that touches the network (library loads, Spotify session calls,
 * Firestore sync) may fire until a user session actually exists — either a
 * Firebase-authenticated user or an explicit demo entry. Providers below the
 * gate read `entered` and stay idle until then.
 */
interface AppGateValue {
  entered: boolean;
  enter: () => void;
  exit: () => void;
}

const AppGateContext = createContext<AppGateValue | null>(null);

export function AppGateProvider({ children }: { children: ReactNode }) {
  const [entered, setEntered] = useState(false);
  const enter = useCallback(() => setEntered(true), []);
  const exit = useCallback(() => setEntered(false), []);
  const value = useMemo(() => ({ entered, enter, exit }), [entered, enter, exit]);
  return <AppGateContext.Provider value={value}>{children}</AppGateContext.Provider>;
}

export function useAppGate(): AppGateValue {
  const ctx = useContext(AppGateContext);
  if (!ctx) throw new Error("useAppGate must be used inside <AppGateProvider>");
  return ctx;
}
