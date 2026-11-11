import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";
import type { TokenIdentity } from "../services/identity";
import { fail } from "./http";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

/**
 * Verifies the bearer token.
 * - firebase: a Firebase Auth ID token (same project as the Writing Bank app).
 * - dev: `dev:<email>` or `dev:<email>|<name>`; never enable outside local development.
 */
export async function verifyToken(header: string | undefined, env: Env): Promise<TokenIdentity> {
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) fail(401, "Sign in first.", "unauthenticated");

  if (env.AUTH_MODE === "dev") {
    if (!token.startsWith("dev:")) fail(401, "Dev auth expects `Bearer dev:<email>`.", "unauthenticated");
    const [email, name] = token.slice(4).split("|");
    return { uid: `dev-${email}`, email: email.toLowerCase(), name: name ?? "" };
  }

  try {
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!email || payload.email_verified !== true) fail(401, "The account email is not verified.", "unverified");
    return {
      uid: String(payload.sub),
      email: email.toLowerCase(),
      name: typeof payload.name === "string" ? payload.name : "",
      picture: typeof payload.picture === "string" ? payload.picture : null,
    };
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    fail(401, "Session expired or invalid; sign in again.", "invalid_token");
  }
}
