import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/env";
import type { Db, FileStore, Param } from "../src/lib/db";
import { MockDirectory, type DirectoryUser } from "../src/services/directory";
import type { Downloader } from "../src/services/downloader";

// Loaded through require: Vite strips the "node:" prefix and "sqlite" alone does not resolve.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/** D1-compatible adapter over Node's built-in SQLite, with the real migrations applied. */
export function sqliteDb(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const dir = join(__dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, f), "utf8"));
  }
  const clean = (row: unknown) => (row ? { ...(row as object) } : null);
  return {
    async all<T>(sql: string, ...params: Param[]) {
      return db.prepare(sql).all(...params).map((r) => clean(r) as T);
    },
    async first<T>(sql: string, ...params: Param[]) {
      return clean(db.prepare(sql).get(...params)) as T | null;
    },
    async run(sql: string, ...params: Param[]) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        for (const s of stmts) db.prepare(s.sql).run(...s.params);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

export function memoryFiles(): FileStore & { size(): number } {
  const m = new Map<string, { data: ArrayBuffer; contentType: string }>();
  return {
    async put(key, data, contentType) {
      m.set(key, { data, contentType });
    },
    async get(key) {
      return m.get(key) ?? null;
    },
    async delete(key) {
      m.delete(key);
    },
    size: () => m.size,
  };
}

export const ENV: Env = {
  DB: undefined as unknown as D1Database,
  FILES: undefined as unknown as R2Bucket,
  AUTH_MODE: "dev",
  FIREBASE_PROJECT_ID: "test-project",
  ORG_DOMAIN: "hyperdatalab.org",
  ADMIN_EMAIL: "admin@hyperdatalab.org",
  DIRECTORY_MODE: "mock",
  CORS_ORIGIN: "http://localhost:5174",
};

export const ADMIN = "admin@hyperdatalab.org";
export const MANAGER = "manager@hyperdatalab.org";
export const ALICE = "alice@hyperdatalab.org";
export const BOB = "bob@hyperdatalab.org";

export const DIRECTORY: DirectoryUser[] = [
  { email: ADMIN, name: "Lab Admin", suspended: false, orgUnit: "/" },
  { email: MANAGER, name: "Manager Mai", suspended: false, orgUnit: "/research" },
  { email: ALICE, name: "Alice Nguyen", suspended: false, orgUnit: "/research" },
  { email: BOB, name: "Bob Tran", suspended: false, orgUnit: "/annotation" },
  { email: "gone@hyperdatalab.org", name: "Former", suspended: true },
];

export function setup(opts: { downloader?: Downloader; directory?: DirectoryUser[] } = {}) {
  const db = sqliteDb();
  const files = memoryFiles();
  const deps: AppDeps = {
    db,
    files,
    directory: new MockDirectory(JSON.stringify(opts.directory ?? DIRECTORY), "hyperdatalab.org"),
    downloader: opts.downloader ? () => opts.downloader! : undefined,
  };
  const app = createApp(deps);

  async function call<T = any>(method: string, path: string, as: string | null, payload?: unknown) {
    const headers: Record<string, string> = {};
    if (as) headers.authorization = `Bearer dev:${as}`;
    if (payload !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(
      path,
      { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) },
      ENV,
    );
    const text = await res.text();
    let data: T;
    try {
      data = text ? JSON.parse(text) : (null as T);
    } catch {
      data = text as T;
    }
    return { status: res.status, data };
  }

  return { app, db, files, call };
}

/** Admin creates a "research" workspace managed by MANAGER; returns its id. */
export async function seedWorkspace(call: ReturnType<typeof setup>["call"], type = "research") {
  const res = await call("POST", "/api/admin/workspaces", ADMIN, {
    name: "Writing Lab",
    slug: `writing-lab-${type}`,
    type,
    managers: [MANAGER],
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.data));
  return res.data.id as string;
}

/** ALICE requests to join and MANAGER approves with the given role. */
export async function joinAndApprove(call: ReturnType<typeof setup>["call"], wid: string, who = ALICE, role = "member") {
  await call("POST", `/api/workspaces/${wid}/join`, who, { note: "please" });
  const members = await call("GET", `/api/w/${wid}/members?status=pending`, MANAGER);
  const m = members.data.find((x: { email: string }) => x.email === who);
  const res = await call("POST", `/api/w/${wid}/members/${m.id}/approve`, MANAGER, { role });
  if (res.status !== 200) throw new Error(JSON.stringify(res.data));
  return m.id as string;
}
