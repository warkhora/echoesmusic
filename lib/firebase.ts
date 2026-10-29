import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

/**
 * Firebase bootstrap.
 *
 * Initialized exactly once, at module scope, with the project's public client
 * config (public by design — it identifies the project, it is not a secret).
 * Values come from NEXT_PUBLIC_FIREBASE_* when present and fall back to the
 * shipped webify-ff374 config, so initialization can never fail because an env
 * var is missing.
 *
 * `auth` and `db` are explicit singletons so components can sign in and write
 * to Firestore directly. Analytics is client-only and wrapped in a
 * `typeof window` guard with caught rejections, so SSR never touches it and no
 * unhandled promise rejection can escape from this module.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

const FALLBACK_CONFIG: FirebaseConfig = {
  apiKey: "AIzaSyBf-o4abbvm2UVJgz-0dCbJUxUyo0IN84k",
  authDomain: "webify-ff374.firebaseapp.com",
  projectId: "webify-ff374",
  storageBucket: "webify-ff374.firebasestorage.app",
  messagingSenderId: "574170989580",
  appId: "1:574170989580:web:201b85734702d22d8d9a29",
  measurementId: "G-R0B5YGRNR5",
};

function envConfig(): FirebaseConfig | null {
  const env = process.env;
  const config: FirebaseConfig = {
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    measurementId: env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };
  const ok =
    config.apiKey.length > 10 &&
    config.projectId.length > 2 &&
    config.appId.includes(":");
  return ok ? config : null;
}

export const firebaseConfig: FirebaseConfig = envConfig() ?? FALLBACK_CONFIG;

export const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

/** Firebase Authentication singleton — components sign in through this. */
export const auth: Auth = getAuth(app);

/** Cloud Firestore singleton — all user data writes go through this. */
export const db: Firestore = getFirestore(app);

/**
 * Analytics, client-only. `getAnalytics` is invoked only inside a
 * `typeof window !== 'undefined'` guard, via dynamic import, with every promise
 * caught — so SSR never evaluates it and a rejection can never be unhandled.
 */
export type FirebaseAnalytics = unknown;
export let analytics: FirebaseAnalytics | null = null;

if (typeof window !== "undefined") {
  void import("firebase/analytics")
    .then(({ getAnalytics, isSupported }) =>
      isSupported()
        .then((supported) => {
          if (supported && firebaseConfig.measurementId) analytics = getAnalytics(app);
        })
        .catch(() => {
          analytics = null; // unsupported browser: silent, non-fatal
        }),
    )
    .catch(() => {
      analytics = null;
    });
}

/* --------------------------- compat helpers ------------------------------- */

/** Always resolves; never rejects, never blocks. */
export function firebaseApp(): Promise<FirebaseApp> {
  return Promise.resolve(app);
}

export function firebaseAuth(): Promise<Auth> {
  return Promise.resolve(auth);
}

export function firebaseDb(): Promise<Firestore> {
  return Promise.resolve(db);
}

export function isFirebaseConfigured(): boolean {
  return firebaseConfig.apiKey.length > 0 && firebaseConfig.projectId.length > 0;
}

/** Human-readable mapping for Firebase auth error codes. */
export function firebaseErrorMessage(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Those credentials don't match an Echoes account.";
    case "auth/email-already-in-use":
      return "That email already has an account — sign in instead.";
    case "auth/weak-password":
      return "Passwords need at least six characters.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts — wait a moment and try again.";
    case "auth/popup-blocked":
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "The Google sign-in window was closed before finishing.";
    case "auth/operation-not-allowed":
      return "This sign-in method is not enabled for the Firebase project.";
    case "auth/network-request-failed":
      return "Could not reach Firebase — check your connection.";
    default:
      return `Sign-in failed (${code}).`;
  }
}
