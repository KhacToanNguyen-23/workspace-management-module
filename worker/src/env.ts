import type { Db, FileStore } from "./lib/db";
import type { Directory } from "./services/directory";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** "firebase" verifies Firebase ID tokens; "dev" accepts `Bearer dev:<email>` (local only). */
  AUTH_MODE: "firebase" | "dev";
  FIREBASE_PROJECT_ID: string;
  ORG_DOMAIN: string;
  ADMIN_EMAIL: string;
  /** "google" calls the Admin SDK Directory API, "mock" reads DIRECTORY_MOCK, "off" skips the check. */
  DIRECTORY_MODE: "google" | "mock" | "off";
  /** Service account JSON with domain-wide delegation (secret). */
  GOOGLE_SA_KEY?: string;
  /** JSON array of DirectoryUser for mock mode. Empty/unset = every domain email is active. */
  DIRECTORY_MOCK?: string;
  CORS_ORIGIN: string;
  /** Optional contact address sent to OpenAlex/Crossref polite pools (set by the deployer). */
  API_CONTACT_EMAIL?: string;
  MAX_DOWNLOAD_BYTES?: string;
}

export interface AuthedUser {
  email: string;
  name: string;
  isAdmin: boolean;
}

export type AppVars = {
  db: Db;
  files: FileStore;
  directory: Directory;
  user: AuthedUser;
};

export type AppEnv = { Bindings: Env; Variables: AppVars };
