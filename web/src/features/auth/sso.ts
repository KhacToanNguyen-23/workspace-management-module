/**
 * HyperDataLab SSO from the browser's side (OAuth 2.0 Authorization Code + PKCE).
 *
 * 1. startSsoSignIn: make a random `state` and PKCE verifier, keep them for this tab, and send
 *    the user to the SSO's /oauth/authorize.
 * 2. The SSO returns to the registered callback URL with ?code=...&state=...
 * 3. completeSsoSignIn: check `state`, then hand the code and verifier to our backend, which
 *    exchanges them with the SSO and answers with a session token for this module.
 *
 * The browser never sees an SSO access token or a client secret.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const SSO_BASE = String(import.meta.env.VITE_SSO_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);
const CLIENT_ID = String(import.meta.env.VITE_SSO_CLIENT_ID ?? "");
const SCOPE = "email profile hyperdatalab_profile";

const ATTEMPT_KEY = "wb-module-sso-attempt";
const SESSION_KEY = "wb-module-sso-session";

export interface SsoSession {
  token: string;
  /** ISO time after which the backend refuses the token. */
  expiresAt: string;
  email: string;
  name: string;
}

interface Attempt {
  state: string;
  verifier: string;
  returnTo: string;
}

/**
 * The exact URL registered for this app in ResearchPulse → Connected applications. The SSO
 * compares it character by character, so VITE_SSO_CALLBACK_URL must repeat the registration
 * (it may be the bare origin, e.g. http://localhost:3000).
 */
const callbackUrl = () =>
  String(import.meta.env.VITE_SSO_CALLBACK_URL ?? "") ||
  `${window.location.origin}/auth/callback`;

/**
 * Whether the page was just opened by the SSO returning from a sign-in this tab started. The
 * callback may be any registered URL of the app, so this looks at the query, not the path.
 */
export function isSsoReturn(search: string): boolean {
  const params = new URLSearchParams(search);
  try {
    return (
      params.has("state") &&
      (params.has("code") || params.has("error")) &&
      sessionStorage.getItem(ATTEMPT_KEY) !== null
    );
  } catch {
    return false;
  }
}

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** Leaves the page for the SSO sign-in; `returnTo` is the in-app path to land on afterwards. */
export async function startSsoSignIn(returnTo: string): Promise<void> {
  if (!SSO_BASE || !CLIENT_ID)
    throw new Error(
      "Chưa cấu hình SSO (VITE_SSO_BASE_URL, VITE_SSO_CLIENT_ID).",
    );
  const state = random();
  const verifier = random();
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const attempt: Attempt = { state, verifier, returnTo };
  sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  const url = new URL(`${SSO_BASE}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: callbackUrl(),
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  window.location.assign(url.toString());
}

async function complete(
  search: string,
): Promise<{ session: SsoSession; returnTo: string }> {
  const params = new URLSearchParams(search);
  const raw = sessionStorage.getItem(ATTEMPT_KEY);
  sessionStorage.removeItem(ATTEMPT_KEY); // one use, even when the exchange fails
  const attempt = raw ? (JSON.parse(raw) as Attempt) : null;
  const code = params.get("code");
  if (!attempt || !code || params.get("state") !== attempt.state) {
    throw new Error(
      params.get("error_description") ??
        params.get("error") ??
        "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.",
    );
  }
  const res = await fetch(`${API_BASE}/api/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      codeVerifier: attempt.verifier,
      redirectUri: callbackUrl(),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.token) {
    throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  }
  const session: SsoSession = {
    token: data.token,
    expiresAt: data.expiresAt,
    email: data.user.email,
    name: data.user.name,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  const to = attempt.returnTo;
  return {
    session,
    returnTo: to.startsWith("/") && !to.startsWith("//") ? to : "/",
  };
}

let pending: { search: string; result: ReturnType<typeof complete> } | null =
  null;

/**
 * Finishes the sign-in on /auth/callback. The authorization code works once, so a second call
 * for the same URL (React StrictMode runs effects twice in development) gets the first result.
 */
export function completeSsoSignIn(search: string) {
  if (pending?.search !== search) pending = { search, result: complete(search) };
  return pending.result;
}

/** The stored session, or null when there is none or it has expired. */
export function loadSsoSession(): SsoSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as SsoSession;
    if (!session.token || Date.parse(session.expiresAt) <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null; // storage blocked or corrupt: signed out
  }
}

/** Ends the session on the backend (best effort) and forgets it here. */
export async function endSsoSession(): Promise<void> {
  const session = loadSsoSession();
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  if (!session) return;
  await fetch(`${API_BASE}/api/v1/sessions/current`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${session.token}` },
  }).catch(() => undefined);
}
