import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "../env";

/**
 * Source of truth for who belongs to the @hyperdatalab.org Google Workspace domain.
 * The Google implementation uses the Admin SDK Directory API through a service account
 * with domain-wide delegation, impersonating the domain admin (ADMIN_EMAIL).
 */
export interface DirectoryUser {
  email: string;
  name: string;
  photoUrl?: string | null;
  orgUnit?: string | null;
  suspended: boolean;
}

export interface Directory {
  readonly mode: "google" | "mock" | "off";
  /** null = the address does not exist in the domain. */
  getUser(email: string): Promise<DirectoryUser | null>;
  listUsers(): Promise<DirectoryUser[]>;
}

export class DirectoryError extends Error {}

const SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://admin.googleapis.com/admin/directory/v1";

interface GoogleApiUser {
  primaryEmail: string;
  name?: { fullName?: string };
  thumbnailPhotoUrl?: string;
  orgUnitPath?: string;
  suspended?: boolean;
  archived?: boolean;
}

function mapGoogleUser(u: GoogleApiUser): DirectoryUser {
  return {
    email: u.primaryEmail.toLowerCase(),
    name: u.name?.fullName ?? "",
    photoUrl: u.thumbnailPhotoUrl ?? null,
    orgUnit: u.orgUnitPath ?? null,
    suspended: Boolean(u.suspended || u.archived),
  };
}

export class GoogleDirectory implements Directory {
  readonly mode = "google" as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly serviceAccountJson: string,
    private readonly adminEmail: string,
    private readonly domain: string,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    let sa: { client_email: string; private_key: string };
    try {
      sa = JSON.parse(this.serviceAccountJson);
    } catch {
      throw new DirectoryError("GOOGLE_SA_KEY is not valid JSON.");
    }
    const key = await importPKCS8(sa.private_key, "RS256");
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(sa.client_email)
      .setSubject(this.adminEmail)
      .setAudience(TOKEN_URL)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) throw new DirectoryError(`Google token exchange failed (${res.status}).`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  async getUser(email: string): Promise<DirectoryUser | null> {
    const res = await fetch(`${API}/users/${encodeURIComponent(email)}?projection=basic`, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new DirectoryError(`Directory lookup failed (${res.status}).`);
    return mapGoogleUser((await res.json()) as GoogleApiUser);
  }

  async listUsers(): Promise<DirectoryUser[]> {
    const out: DirectoryUser[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${API}/users`);
      url.searchParams.set("domain", this.domain);
      url.searchParams.set("maxResults", "500");
      url.searchParams.set("projection", "basic");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { headers: { authorization: `Bearer ${await this.accessToken()}` } });
      if (!res.ok) throw new DirectoryError(`Directory list failed (${res.status}).`);
      const data = (await res.json()) as { users?: GoogleApiUser[]; nextPageToken?: string };
      out.push(...(data.users ?? []).map(mapGoogleUser));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }
}

/** For local development and tests. With no list, every address in the domain counts as active. */
export class MockDirectory implements Directory {
  readonly mode = "mock" as const;
  private readonly users: DirectoryUser[] | null;

  constructor(json: string | undefined, private readonly domain: string) {
    const parsed = json?.trim() ? (JSON.parse(json) as DirectoryUser[]) : null;
    this.users = parsed?.map((u) => ({ ...u, email: u.email.toLowerCase() })) ?? null;
  }

  async getUser(email: string) {
    const e = email.toLowerCase();
    if (!this.users) {
      return e.endsWith(`@${this.domain}`) ? { email: e, name: "", suspended: false } : null;
    }
    return this.users.find((u) => u.email === e) ?? null;
  }

  async listUsers() {
    return this.users ?? [];
  }
}

export class NoDirectory implements Directory {
  readonly mode = "off" as const;
  async getUser(email: string) {
    return { email: email.toLowerCase(), name: "", suspended: false };
  }
  async listUsers() {
    return [];
  }
}

let cached: { key: string; dir: Directory } | null = null;

export function directoryFromEnv(env: Env): Directory {
  const key = `${env.DIRECTORY_MODE}|${env.ADMIN_EMAIL}|${env.ORG_DOMAIN}`;
  if (cached?.key === key) return cached.dir;
  let dir: Directory;
  switch (env.DIRECTORY_MODE) {
    case "google":
      if (!env.GOOGLE_SA_KEY) throw new DirectoryError("DIRECTORY_MODE=google needs the GOOGLE_SA_KEY secret.");
      dir = new GoogleDirectory(env.GOOGLE_SA_KEY, env.ADMIN_EMAIL, env.ORG_DOMAIN);
      break;
    case "mock":
      dir = new MockDirectory(env.DIRECTORY_MOCK, env.ORG_DOMAIN);
      break;
    default:
      dir = new NoDirectory();
  }
  cached = { key, dir };
  return dir;
}
