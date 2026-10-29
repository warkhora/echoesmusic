"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { firebaseAuth, firebaseErrorMessage, isFirebaseConfigured } from "@/lib/firebase";

export interface FirebaseSession {
  user: User | null;
  /** Firebase is configured, reachable, and the session state has resolved. */
  ready: boolean;
  configured: boolean;
  busy: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<boolean>;
  signInWithEmail: (email: string, password: string) => Promise<boolean>;
  signUpWithEmail: (email: string, password: string, name?: string) => Promise<boolean>;
  signOutFirebase: () => Promise<void>;
  clearError: () => void;
}

const FirebaseContext = createContext<FirebaseSession | null>(null);

/**
 * Firebase Authentication with Google and Email/Password providers.
 *
 * When Firebase is not configured (no env vars) or unreachable, `ready` still
 * becomes true with `user: null`, so the onboarding flow can offer the local
 * demo path instead of hanging on a spinner.
 */
/** localStorage key mirroring the active Firebase uid. */
export const ACTIVE_UID_KEY = "echoes.activeUid";

export function activeUid(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_UID_KEY);
  } catch {
    return null;
  }
}

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const configured = useMemo(() => isFirebaseConfigured(), []);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!configured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      const auth = await firebaseAuth();
      if (!alive) return;
      if (!auth) {
        setReady(true);
        return;
      }
      unsubscribe = onAuthStateChanged(
        auth,
        (next) => {
          if (!alive) return;
          // Persist the active uid so every database operation knows who the
          // active user is, even across reloads before onAuthStateChanged fires.
          try {
            if (next?.uid) window.localStorage.setItem(ACTIVE_UID_KEY, next.uid);
            else window.localStorage.removeItem(ACTIVE_UID_KEY);
          } catch {
            /* private mode */
          }
          setUser(next);
          setReady(true);
        },
        (authError) => {
          if (!alive) return;
          console.warn("[echoes] firebase session error:", (authError as { code?: string }).code ?? authError.message);
          setUser(null);
          setReady(true);
        },
      );
    })();

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  /** Returns success so callers can advance without racing state updates. */
  const run = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      return true;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "auth/unknown";
      setError(firebaseErrorMessage(code));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<boolean> => {
    return run(async () => {
      const auth = await firebaseAuth();
      if (!auth) throw { code: "auth/network-request-failed" };
      await signInWithPopup(auth, new GoogleAuthProvider());
    });
  }, [run]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      return run(async () => {
        const auth = await firebaseAuth();
        if (!auth) throw { code: "auth/network-request-failed" };
        await signInWithEmailAndPassword(auth, email.trim(), password);
      });
    },
    [run],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, name?: string): Promise<boolean> => {
      return run(async () => {
        const auth = await firebaseAuth();
        if (!auth) throw { code: "auth/network-request-failed" };
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name?.trim()) await updateProfile(credential.user, { displayName: name.trim() });
      });
    },
    [run],
  );

  const signOutFirebase = useCallback(async () => {
    await run(async () => {
      const auth = await firebaseAuth();
      if (auth) await signOut(auth);
    });
  }, [run]);

  const value = useMemo<FirebaseSession>(
    () => ({
      user,
      ready,
      configured,
      busy,
      error,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOutFirebase,
      clearError: () => setError(null),
    }),
    [user, ready, configured, busy, error, signInWithGoogle, signInWithEmail, signUpWithEmail, signOutFirebase],
  );

  return <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>;
}

export function useFirebase(): FirebaseSession {
  const ctx = useContext(FirebaseContext);
  if (!ctx) throw new Error("useFirebase must be used inside <FirebaseProvider>");
  return ctx;
}
