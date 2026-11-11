import type { AuthedUser, Env } from "../env";
import { type Db, nowIso, stmt } from "../lib/db";
import { fail } from "../lib/http";
import { auditStmt } from "./audit";
import type { Directory, DirectoryUser } from "./directory";

export interface TokenIdentity {
  uid: string;
  email: string;
  name: string;
  picture?: string | null;
}

export interface UserRow {
  email: string;
  firebase_uid: string | null;
  name: string;
  photo_url: string | null;
  org_unit: string | null;
  directory_status: "active" | "suspended" | "missing" | "unknown";
  global_role: "user" | "admin";
  disabled: number;
  first_seen: string | null;
  last_seen: string | null;
  synced_at: string | null;
}

/** Re-check a signed-in user against the directory at most this often. */
const DIRECTORY_TTL_MS = 12 * 60 * 60 * 1000;

export function isOrgEmail(email: string, domain: string): boolean {
  const at = email.indexOf("@");
  return at > 0 && at === email.lastIndexOf("@") && email.slice(at + 1).toLowerCase() === domain.toLowerCase();
}

/**
 * Turns a verified token into an app user:
 * domain check → directory check (cached) → upsert → admin/disabled checks.
 */
export async function resolveUser(
  db: Db,
  env: Pick<Env, "ORG_DOMAIN" | "ADMIN_EMAIL">,
  directory: Directory,
  id: TokenIdentity,
): Promise<AuthedUser> {
  const email = id.email.toLowerCase();
  if (!isOrgEmail(email, env.ORG_DOMAIN)) {
    fail(403, `Only @${env.ORG_DOMAIN} accounts can use this module.`, "wrong_domain");
  }

  const now = nowIso();
  let row = await db.first<UserRow>("SELECT * FROM users WHERE email = ?", email);
  const stale = !row?.synced_at || Date.now() - Date.parse(row.synced_at) > DIRECTORY_TTL_MS;

  let dirUser: DirectoryUser | null | undefined;
  if (directory.mode !== "off" && (stale || row?.directory_status !== "active")) {
    dirUser = await directory.getUser(email);
  }

  const forcedAdmin = email === env.ADMIN_EMAIL.toLowerCase();
  const status =
    dirUser === undefined
      ? (row?.directory_status ?? (directory.mode === "off" ? "unknown" : "active"))
      : dirUser === null
        ? "missing"
        : dirUser.suspended
          ? "suspended"
          : "active";

  const name = dirUser?.name || row?.name || id.name || email.split("@")[0];
  const photo = dirUser?.photoUrl ?? row?.photo_url ?? id.picture ?? null;
  const orgUnit = dirUser?.orgUnit ?? row?.org_unit ?? null;
  const syncedAt = dirUser !== undefined ? now : (row?.synced_at ?? null);

  const stmts = [
    stmt(
      `INSERT INTO users (email, firebase_uid, name, photo_url, org_unit, directory_status, global_role,
                          first_seen, last_seen, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         firebase_uid = excluded.firebase_uid, name = excluded.name, photo_url = excluded.photo_url,
         org_unit = excluded.org_unit, directory_status = excluded.directory_status,
         global_role = CASE WHEN ? = 1 THEN 'admin' ELSE users.global_role END,
         first_seen = COALESCE(users.first_seen, excluded.first_seen),
         last_seen = excluded.last_seen, synced_at = excluded.synced_at`,
      email,
      id.uid,
      name,
      photo,
      orgUnit,
      status,
      forcedAdmin ? "admin" : "user",
      now,
      now,
      syncedAt,
      forcedAdmin ? 1 : 0,
    ),
  ];
  if (!row?.first_seen) {
    stmts.push(auditStmt({ actor: email, action: "user.first_sign_in", target: email }));
  }
  await db.batch(stmts);
  row = await db.first<UserRow>("SELECT * FROM users WHERE email = ?", email);
  if (!row) fail(500, "User row missing after upsert.");

  if (status === "missing") fail(403, `${email} is not in the ${env.ORG_DOMAIN} directory.`, "not_in_directory");
  if (status === "suspended") fail(403, `${email} is suspended in the ${env.ORG_DOMAIN} directory.`, "suspended");
  if (row.disabled && !forcedAdmin) fail(403, "This account was disabled by an administrator.", "disabled");

  return { email, name: row.name, isAdmin: row.global_role === "admin" };
}

/** Pulls every domain user into the users table. Users no longer listed become `missing`. */
export async function syncDirectory(db: Db, directory: Directory, actor: string) {
  const users = await directory.listUsers();
  const now = nowIso();
  const seen = new Set(users.map((u) => u.email.toLowerCase()));
  const stmts = users.map((u) =>
    stmt(
      `INSERT INTO users (email, name, photo_url, org_unit, directory_status, synced_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, photo_url = excluded.photo_url,
         org_unit = excluded.org_unit, directory_status = excluded.directory_status,
         synced_at = excluded.synced_at`,
      u.email.toLowerCase(),
      u.name,
      u.photoUrl ?? null,
      u.orgUnit ?? null,
      u.suspended ? "suspended" : "active",
      now,
    ),
  );
  let missing = 0;
  if (users.length > 0) {
    const known = await db.all<{ email: string }>(
      "SELECT email FROM users WHERE directory_status IN ('active','suspended')",
    );
    for (const { email } of known) {
      if (!seen.has(email)) {
        missing++;
        stmts.push(stmt("UPDATE users SET directory_status = 'missing', synced_at = ? WHERE email = ?", now, email));
      }
    }
  }
  stmts.push(
    auditStmt({ actor, action: "directory.sync", detail: { listed: users.length, missing, mode: directory.mode } }),
  );
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return { listed: users.length, missing, mode: directory.mode };
}
