import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { type Param, newId, nowIso, stmt } from "../lib/db";
import { body, fail, intParam } from "../lib/http";
import { TOGGLEABLE_PERMISSIONS } from "../lib/permissions";
import { auditStmt } from "../services/audit";
import { isOrgEmail, syncDirectory, type UserRow } from "../services/identity";

/** Routes under /api/admin — only global admins (admin@hyperdatalab.org and promoted users). */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c: Context<AppEnv>, next: Next) => {
  if (!c.get("user").isAdmin) fail(403, "Administrators only.", "admin_only");
  await next();
});

// ---- users -------------------------------------------------------------------------------
adminRoutes.get("/users", async (c) => {
  const q = c.req.query("q")?.trim().toLowerCase();
  const status = c.req.query("status");
  const where: string[] = [];
  const params: Param[] = [];
  if (q) {
    where.push("(u.email LIKE ? OR LOWER(u.name) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push("u.directory_status = ?");
    params.push(status);
  }
  const rows = await c.get("db").all<UserRow & { workspaces: string | null }>(
    `SELECT u.*, (SELECT GROUP_CONCAT(w.name || ':' || m.role || ':' || m.status, '|')
                    FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
                   WHERE m.user_email = u.email) AS workspaces
       FROM users u ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY u.email LIMIT ?`,
    ...params,
    intParam(c.req.query("limit"), 500, 1, 2000),
  );
  return c.json(
    rows.map((u) => ({
      email: u.email,
      name: u.name,
      photoUrl: u.photo_url,
      orgUnit: u.org_unit,
      directoryStatus: u.directory_status,
      globalRole: u.global_role,
      disabled: Boolean(u.disabled),
      firstSeen: u.first_seen,
      lastSeen: u.last_seen,
      syncedAt: u.synced_at,
      workspaces: (u.workspaces ?? "")
        .split("|")
        .filter(Boolean)
        .map((s) => {
          const [name, role, st] = s.split(":");
          return { name, role, status: st };
        }),
    })),
  );
});

adminRoutes.post("/users/sync", async (c) => {
  const result = await syncDirectory(c.get("db"), c.get("directory"), c.get("user").email);
  return c.json(result);
});

const UserPatch = z.object({
  disabled: z.boolean().optional(),
  globalRole: z.enum(["user", "admin"]).optional(),
});

adminRoutes.patch("/users/:email", async (c) => {
  const db = c.get("db");
  const actor = c.get("user");
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  const patch = await body(c, UserPatch);
  const row = await db.first<UserRow>("SELECT * FROM users WHERE email = ?", email);
  if (!row) fail(404, "User not found.", "not_found");
  if (email === c.env.ADMIN_EMAIL.toLowerCase()) fail(409, "The domain admin account cannot be changed here.", "protected");
  if (email === actor.email && patch.globalRole === "user") fail(409, "You cannot remove your own admin role.", "self_change");
  await db.batch([
    stmt(
      "UPDATE users SET disabled = COALESCE(?, disabled), global_role = COALESCE(?, global_role) WHERE email = ?",
      patch.disabled === undefined ? null : patch.disabled ? 1 : 0,
      patch.globalRole ?? null,
      email,
    ),
    auditStmt({ actor: actor.email, action: "user.update", target: email, detail: patch }),
  ]);
  return c.json({ email, ...patch });
});

// ---- workspace types ---------------------------------------------------------------------
const TypeBody = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/),
  name: z.string().min(1).max(60),
  description: z.string().max(300).default(""),
  defaultPermissions: z.array(z.enum(TOGGLEABLE_PERMISSIONS as [string, ...string[]])).default(["corpus.read"]),
});

adminRoutes.post("/workspace-types", async (c) => {
  const t = await body(c, TypeBody);
  const db = c.get("db");
  if (await db.first("SELECT 1 FROM workspace_types WHERE code = ?", t.code)) fail(409, "Type code already exists.", "duplicate");
  await db.batch([
    stmt(
      "INSERT INTO workspace_types (code, name, description, default_permissions) VALUES (?, ?, ?, ?)",
      t.code,
      t.name,
      t.description,
      JSON.stringify(t.defaultPermissions),
    ),
    auditStmt({ actor: c.get("user").email, action: "workspace_type.create", target: t.code, detail: t }),
  ]);
  return c.json(t, 201);
});

// ---- workspaces --------------------------------------------------------------------------
adminRoutes.get("/workspaces", async (c) => {
  const rows = await c.get("db").all(
    `SELECT w.*,
            (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id AND m.status = 'approved') AS memberCount,
            (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id AND m.status = 'pending') AS pendingCount,
            (SELECT GROUP_CONCAT(m.user_email) FROM memberships m
              WHERE m.workspace_id = w.id AND m.status = 'approved' AND m.role = 'manager') AS managers,
            (SELECT GROUP_CONCAT(p.permission) FROM workspace_permissions p WHERE p.workspace_id = w.id) AS permissions
       FROM workspaces w ORDER BY w.status, w.name`,
  );
  return c.json(
    rows.map((w) => ({
      ...w,
      managers: w.managers ? String(w.managers).split(",") : [],
      permissions: w.permissions ? String(w.permissions).split(",") : [],
    })),
  );
});

const WorkspaceCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/),
  type: z.string(),
  description: z.string().max(1000).default(""),
  managers: z.array(z.string().email()).default([]),
});

adminRoutes.post("/workspaces", async (c) => {
  const db = c.get("db");
  const actor = c.get("user");
  const w = await body(c, WorkspaceCreate);
  const type = await db.first<{ default_permissions: string }>("SELECT default_permissions FROM workspace_types WHERE code = ?", w.type);
  if (!type) fail(422, `Unknown workspace type "${w.type}".`, "unknown_type");
  if (await db.first("SELECT 1 FROM workspaces WHERE slug = ?", w.slug)) fail(409, "Slug already used.", "duplicate");
  const managers = [...new Set(w.managers.map((e) => e.toLowerCase()))];
  for (const m of managers) if (!isOrgEmail(m, c.env.ORG_DOMAIN)) fail(422, `${m} is not a @${c.env.ORG_DOMAIN} address.`, "wrong_domain");

  const id = newId();
  const now = nowIso();
  const perms = JSON.parse(type.default_permissions) as string[];
  await db.batch([
    stmt(
      "INSERT INTO workspaces (id, slug, name, type, description, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      id,
      w.slug,
      w.name,
      w.type,
      w.description,
      actor.email,
      now,
    ),
    ...perms.map((p) =>
      stmt("INSERT INTO workspace_permissions (workspace_id, permission, granted_by, granted_at) VALUES (?, ?, ?, ?)", id, p, actor.email, now),
    ),
    ...managers.flatMap((m) => [
      stmt("INSERT INTO users (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING", m),
      stmt(
        `INSERT INTO memberships (id, workspace_id, user_email, role, status, requested_at, decided_by, decided_at, decision_note)
         VALUES (?, ?, ?, 'manager', 'approved', ?, ?, ?, 'assigned by admin')`,
        newId(),
        id,
        m,
        now,
        actor.email,
        now,
      ),
    ]),
    auditStmt({ actor: actor.email, action: "workspace.create", target: id, workspaceId: id, detail: { ...w, permissions: perms } }),
  ]);
  return c.json({ id, ...w, permissions: perms }, 201);
});

const WorkspacePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  type: z.string().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

adminRoutes.patch("/workspaces/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const p = await body(c, WorkspacePatch);
  if (!(await db.first("SELECT 1 FROM workspaces WHERE id = ?", id))) fail(404, "Workspace not found.", "not_found");
  if (p.type && !(await db.first("SELECT 1 FROM workspace_types WHERE code = ?", p.type))) fail(422, "Unknown type.", "unknown_type");
  await db.batch([
    stmt(
      `UPDATE workspaces SET name = COALESCE(?, name), description = COALESCE(?, description),
              type = COALESCE(?, type), status = COALESCE(?, status) WHERE id = ?`,
      p.name ?? null,
      p.description ?? null,
      p.type ?? null,
      p.status ?? null,
      id,
    ),
    auditStmt({ actor: c.get("user").email, action: "workspace.update", target: id, workspaceId: id, detail: p }),
  ]);
  return c.json({ id, ...p });
});

const ManagerBody = z.object({ email: z.string().email() });

/** Make a domain user manager of a workspace (creates or upgrades the membership). */
adminRoutes.post("/workspaces/:id/managers", async (c) => {
  const db = c.get("db");
  const actor = c.get("user");
  const id = c.req.param("id");
  const email = (await body(c, ManagerBody)).email.toLowerCase();
  if (!isOrgEmail(email, c.env.ORG_DOMAIN)) fail(422, `Only @${c.env.ORG_DOMAIN} addresses.`, "wrong_domain");
  if (!(await db.first("SELECT 1 FROM workspaces WHERE id = ?", id))) fail(404, "Workspace not found.", "not_found");
  const now = nowIso();
  await db.batch([
    stmt("INSERT INTO users (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING", email),
    stmt(
      `INSERT INTO memberships (id, workspace_id, user_email, role, status, requested_at, decided_by, decided_at, decision_note)
       VALUES (?, ?, ?, 'manager', 'approved', ?, ?, ?, 'assigned by admin')
       ON CONFLICT(workspace_id, user_email) DO UPDATE SET role = 'manager', status = 'approved',
         decided_by = excluded.decided_by, decided_at = excluded.decided_at, decision_note = excluded.decision_note`,
      newId(),
      id,
      email,
      now,
      actor.email,
      now,
    ),
    auditStmt({ actor: actor.email, action: "workspace.manager", target: email, workspaceId: id }),
  ]);
  return c.json({ workspaceId: id, email, role: "manager" }, 201);
});

adminRoutes.get("/audit", async (c) => {
  const rows = await c.get("db").all<{ detail: string }>(
    "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?",
    intParam(c.req.query("limit"), 200, 1, 1000),
  );
  return c.json(rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) })));
});
