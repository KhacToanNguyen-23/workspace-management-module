import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  completeSsoSignIn,
  endSsoSession,
  loadSsoSession,
  startSsoSignIn,
} from "./sso";

/**
 * Single sign-on.
 *
 * Production ("sso"): the user signs in through the HyperDataLab SSO (see ./sso.ts). The backend
 * exchanges the authorization code and issues a session token that every API call carries as
 * `Authorization: Bearer`. The session lasts some hours; after that the user goes through the
 * SSO again. Signing out ends the session at once.
 *
 * "firebase": Google sign-in brokered by Firebase Auth; the bearer token is the Firebase ID token.
 *
 * Local development ("dev"): the token is simply `dev:<email>`; the backend must run AUTH_MODE=dev.
 */
export const AUTH_MODE = (import.meta.env.VITE_AUTH_MODE ?? "dev") as
  "dev" | "firebase" | "sso";
export const ORG_DOMAIN = import.meta.env.VITE_ORG_DOMAIN ?? "hyperdatalab.org";

export function isOrgEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.indexOf("@");
  return (
    at > 0 &&
    at === email.lastIndexOf("@") &&
    email.slice(at + 1).toLowerCase() === ORG_DOMAIN
  );
}

interface Session {
  email: string;
  name: string;
}

interface AuthState {
  session: Session | null;
  ready: boolean;
  error: string;
  signInGoogle(): Promise<void>;
  /** Leaves for the SSO; `returnTo` is the in-app path to open after signing in. */
  signInSso(returnTo: string): Promise<void>;
  /** Finishes an SSO sign-in on /auth/callback and returns the path to open. */
  completeSso(search: string): Promise<string>;
  signInDev(email: string): void;
  signOut(): Promise<void>;
  /** forceRefresh asks the identity provider for a new ID token (used once after a 401). */
  getToken(forceRefresh?: boolean): Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);
const DEV_KEY = "wb-module-dev-email";

/**
 * Dev mode only: sign in as another address and reload, so every cached query (profile,
 * memberships, queues) is fetched again for the new account.
 */
export function switchDevAccount(email: string) {
  if (AUTH_MODE !== "dev") return;
  try {
    localStorage.setItem(DEV_KEY, email.trim().toLowerCase());
  } catch {
    /* storage blocked: the reload lands on the login screen */
  }
  window.location.assign("/");
}

async function loadFirebase() {
  const [{ initializeApp, getApps }, authModule] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    });
  return { auth: authModule.getAuth(app), m: authModule };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (AUTH_MODE === "dev") {
      try {
        const email = localStorage.getItem(DEV_KEY);
        if (email) setSession({ email, name: email.split("@")[0] });
      } catch {
        /* storage blocked: stay signed out */
      }
      setReady(true);
      return;
    }
    if (AUTH_MODE === "sso") {
      const stored = loadSsoSession();
      if (stored) setSession({ email: stored.email, name: stored.name });
      setReady(true);
      return;
    }
    let unsub = () => {};
    loadFirebase()
      .then(async ({ auth, m }) => {
        // Completes a redirect sign-in (used when the popup is blocked).
        await m
          .getRedirectResult(auth)
          .catch((e) => setError(`Đăng nhập thất bại: ${String(e)}`));
        unsub = m.onAuthStateChanged(auth, async (u) => {
          if (u && !isOrgEmail(u.email)) {
            // The Google account chooser can still return a personal account: end that session at once.
            setError(`Tài khoản ${u.email ?? ""} không thuộc @${ORG_DOMAIN}.`);
            await m.signOut(auth);
            return;
          }
          setSession(u ? { email: u.email!, name: u.displayName ?? "" } : null);
          setReady(true);
        });
      })
      .catch((e) => {
        setError(`Không tải được phần đăng nhập: ${String(e)}`);
        setReady(true);
      });
    return () => unsub();
  }, []);

  const signInGoogle = useCallback(async () => {
    setError("");
    try {
      const { auth, m } = await loadFirebase();
      const provider = new m.GoogleAuthProvider();
      // hd limits the Google account chooser to the organisation; the backend enforces the domain again.
      provider.setCustomParameters({
        hd: ORG_DOMAIN,
        prompt: "select_account",
      });
      try {
        await m.signInWithPopup(auth, provider);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (
          code === "auth/popup-closed-by-user" ||
          code === "auth/cancelled-popup-request"
        )
          return;
        if (
          code === "auth/popup-blocked" ||
          code === "auth/operation-not-supported-in-this-environment"
        ) {
          await m.signInWithRedirect(auth, provider); // full-page SSO redirect instead of a popup
          return;
        }
        throw e;
      }
    } catch (e) {
      setError(`Đăng nhập thất bại: ${String(e)}`);
    }
  }, []);

  const signInSso = useCallback(async (returnTo: string) => {
    setError("");
    try {
      await startSsoSignIn(returnTo);
    } catch (e) {
      setError(`Đăng nhập thất bại: ${String((e as Error).message ?? e)}`);
    }
  }, []);

  const completeSso = useCallback(async (search: string) => {
    const { session: s, returnTo } = await completeSsoSignIn(search);
    setError("");
    setSession({ email: s.email, name: s.name });
    return returnTo;
  }, []);

  const signInDev = useCallback((email: string) => {
    const e = email.trim().toLowerCase();
    if (!isOrgEmail(e)) {
      setError(`Chỉ chấp nhận email @${ORG_DOMAIN}.`);
      return;
    }
    setError("");
    try {
      localStorage.setItem(DEV_KEY, e);
    } catch {
      /* ignore */
    }
    setSession({ email: e, name: e.split("@")[0] });
  }, []);

  const signOut = useCallback(async () => {
    if (AUTH_MODE === "dev") {
      try {
        localStorage.removeItem(DEV_KEY);
      } catch {
        /* ignore */
      }
      setSession(null);
      return;
    }
    if (AUTH_MODE === "sso") {
      await endSsoSession();
      setSession(null);
      return;
    }
    const { auth, m } = await loadFirebase();
    await m.signOut(auth);
  }, []);

  const getToken = useCallback(
    async (forceRefresh = false) => {
      if (AUTH_MODE === "dev") return session ? `dev:${session.email}` : null;
      // No renewal in SSO mode: an expired session yields no token, the API answers 401 and the
      // user is signed out to go through the SSO again.
      if (AUTH_MODE === "sso") return loadSsoSession()?.token ?? null;
      const { auth } = await loadFirebase();
      // getIdToken renews the token by itself when it is about to expire.
      return (await auth.currentUser?.getIdToken(forceRefresh)) ?? null;
    },
    [session],
  );

  const value = useMemo(
    () => ({
      session,
      ready,
      error,
      signInGoogle,
      signInSso,
      completeSso,
      signInDev,
      signOut,
      getToken,
    }),
    [
      session,
      ready,
      error,
      signInGoogle,
      signInSso,
      completeSso,
      signInDev,
      signOut,
      getToken,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
