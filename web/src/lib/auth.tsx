import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Sign-in. Production uses Firebase Auth with Google restricted to the org domain (the same
 * setup as the Writing Bank app); local development can use "dev" mode, where the token is
 * simply `dev:<email>` and the worker must run with AUTH_MODE=dev.
 */
export const AUTH_MODE = (import.meta.env.VITE_AUTH_MODE ?? "dev") as "dev" | "firebase";
export const ORG_DOMAIN = import.meta.env.VITE_ORG_DOMAIN ?? "hyperdatalab.org";

export function isOrgEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.indexOf("@");
  return at > 0 && at === email.lastIndexOf("@") && email.slice(at + 1).toLowerCase() === ORG_DOMAIN;
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
  signInDev(email: string): void;
  signOut(): Promise<void>;
  getToken(): Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);
const DEV_KEY = "wb-module-dev-email";

async function loadFirebase() {
  const [{ initializeApp, getApps }, authModule] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
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
    let unsub = () => {};
    loadFirebase()
      .then(({ auth, m }) => {
        unsub = m.onAuthStateChanged(auth, (u) => {
          setSession(u && isOrgEmail(u.email) ? { email: u.email!, name: u.displayName ?? "" } : null);
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
      provider.setCustomParameters({ hd: ORG_DOMAIN, prompt: "select_account" });
      const res = await m.signInWithPopup(auth, provider);
      if (!isOrgEmail(res.user.email)) {
        await m.signOut(auth);
        setError(`Tài khoản ${res.user.email ?? ""} không thuộc @${ORG_DOMAIN}.`);
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      setError(`Đăng nhập thất bại: ${String(e)}`);
    }
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
    const { auth, m } = await loadFirebase();
    await m.signOut(auth);
  }, []);

  const getToken = useCallback(async () => {
    if (AUTH_MODE === "dev") return session ? `dev:${session.email}` : null;
    const { auth } = await loadFirebase();
    return (await auth.currentUser?.getIdToken()) ?? null;
  }, [session]);

  const value = useMemo(
    () => ({ session, ready, error, signInGoogle, signInDev, signOut, getToken }),
    [session, ready, error, signInGoogle, signInDev, signOut, getToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
