import { type Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { newId, nowIso, stmt } from "../lib/db";
import { body, fail, intParam } from "../lib/http";
import { PERMISSIONS, TOGGLEABLE_PERMISSIONS, WORKSPACE_ROLES, type WorkspaceRole } from "../lib/permissions";
import { loadAccess, requirePerm } from "../services/access";
import { auditStmt } from "../services/audit";
import { isOrgEmail } from "../services/identity";

/** Routes under /api/w/:wid — members, permissions and audit of one workspace. */
export const workspaceRoutes = new Hono<AppEnv>();

workspaceRoutes.get("/", async (c) => {
  const a = await loadAccess(c.get("db"), c.get("user"), c.req.param("wid")!);
  return c.json({
    workspace: a.workspace,
    role: a.role,
    enabledPermissions: a.enabled,
    permissions: a.permissions,
    allPermissions: PERMISSIONS,
    toggleablePermissions: TOGGLEABLE_PERMISSIONS,
  });
});

workspaceRoutes.get("/members", async (c) => {
  const db = c.get("db");
  const a = await loadAccess(db, c.get("user"), c.req.param("wid")!);
  requirePerm(a, "members.manage");
  const status = c.req.query("status");
  const rows = await db.all(
    `SELECT m.id, m.user_email AS email, u.name, u.photo_url AS photoUrl, u.org_unit AS orgUnit,
            u.directory_status AS directoryStatus, m.role, m.status, m.note, m.requested_at AS requestedAt,
            m.decided_by AS decidedBy, m.decided_at AS decidedAt, m.decision_note AS decisionNote
       FROM memberships m JOIN users u ON u.email = m.user_email
      WHERE m.workspace_id = ? ${status ? "AND m.status = ?" : ""}
      ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, m.requested_at DESC`,
    ...(status ? [a.workspace.id, status] : [a.workspace.id]),
  );
  return c.json(rows);
});

const Decision = z.object({
  role: z.enum(WORKSPACE_ROLES).optional(),
  note: z.string().max(500).default(""),
});

type MemberRow = { id: string; user_email: string; role: WorkspaceRole; status: string };

async function loadMember(c: Context<AppEnv>) {
  const db = c.get("db");
  const user = c.get("user");
  const a = await loadAccess(db, user, c.req.param("wid")!);
  requirePerm(a, "members.manage");
  const m = await db.first<MemberRow>(
    "SELECT id, user_email, role, status FROM memberships WHERE id = ? AND workspace_id = ?",
    c.req.param("mid")!,
    a.workspace.id,
  );
  if (!m) fail(404, "Membership not found.", "not_found");
  if (m.user_email === user.email && !user.isAdmin) fail(403, "Managers cannot change their own membership.", "self_change");
  // Only admins may create, change or remove managers.
  return { db, user, a, m };
}

workspaceRoutes.post("/members/:mid/approve", async (c) => {
  const { db, user, a, m } = await loadMember(c);
  const { role = m.role, note } = await body(c, Decision);
  if (m.status !== "pending") fail(409, `Request is ${m.status}, not pending.`, "not_pending");
  if (role === "manager" && !user.isAdmin) fail(403, "Only an admin can grant the manager role.", "admin_only");
  await db.batch([
    stmt(
      "UPDATE memberships SET status = 'approved', role = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?",
      role,
      user.email,
      nowIso(),
      note,
      m.id,
    ),
    auditStmt({ actor: user.email, action: "membership.approve", target: m.user_email, workspaceId: a.workspace.id, detail: { role, note } }),
  ]);
  return c.json({ id: m.id, status: "approved", role });
});

workspaceRoutes.post("/members/:mid/reject", async (c) => {
  const { db, user, a, m } = await loadMember(c);
  const { note } = await body(c, Decision);
  if (m.status !== "pending") fail(409, `Request is ${m.status}, not pending.`, "not_pending");
  await db.batch([
    stmt(
      "UPDATE memberships SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?",
      user.email,
      nowIso(),
      note,
      m.id,
    ),
    auditStmt({ actor: user.email, action: "membership.reject", target: m.user_email, workspaceId: a.workspace.id, detail: { note } }),
  ]);
  return c.json({ id: m.id, status: "rejected" });
});

workspaceRoutes.post("/members/:mid/revoke", async (c) => {
  const { db, user, a, m } = await loadMember(c);
  const { note } = await body(c, Decision);
  if (m.status !== "approved") fail(409, `Membership is ${m.status}, not approved.`, "not_approved");
  if (m.role === "manager" && !user.isAdmin) fail(403, "Only an admin can remove a manager.", "admin_only");
  await db.batch([
    stmt(
      "UPDATE memberships SET status = 'revoked', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?",
      user.email,
      nowIso(),
      note,
      m.id,
    ),
    auditStmt({ actor: user.email, action: "membership.revoke", target: m.user_email, workspaceId: a.workspace.id, detail: { note } }),
  ]);
  return c.json({ id: m.id, status: "revoked" });
});

const RoleBody = z.object({ role: z.enum(WORKSPACE_ROLES) });

workspaceRoutes.patch("/members/:mid", async (c) => {
  const { db, user, a, m } = await loadMember(c);
  const { role } = await body(c, RoleBody);
  if (m.status !== "approved") fail(409, "Only approved members have a role to change.", "not_approved");
  if ((role === "manager" || m.role === "manager") && !user.isAdmin) {
    fail(403, "Only an admin can grant or remove the manager role.", "admin_only");
  }
  await db.batch([
    stmt("UPDATE memberships SET role = ? WHERE id = ?", role, m.id),
    auditStmt({ actor: user.email, action: "membership.role", target: m.user_email, workspaceId: a.workspace.id, detail: { from: m.role, to: role } }),
  ]);
  return c.json({ id: m.id, role });
});

const AddBody = z.object({
  email: z.string().email(),
  role: z.enum(WORKSPACE_ROLES).default("member"),
});

/** A manager adds a domain user directly (approved), without waiting for a request. */
workspaceRoutes.post("/members", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const a = await loadAccess(db, user, c.req.param("wid")!);
  requirePerm(a, "members.manage");
  const { email: rawEmail, role } = await body(c, AddBody);
  const email = rawEmail.toLowerCase();
  if (!isOrgEmail(email, c.env.ORG_DOMAIN)) fail(422, `Only @${c.env.ORG_DOMAIN} addresses can be added.`, "wrong_domain");
  if (role === "manager" && !user.isAdmin) fail(403, "Only an admin can grant the manager role.", "admin_only");

  const known = await db.first<{ directory_status: string; disabled: number }>(
    "SELECT directory_status, disabled FROM users WHERE email = ?",
    email,
  );
  const dir = c.get("directory");
  if (!known && dir.mode !== "off") {
    const d = await dir.getUser(email);
    if (!d) fail(404, `${email} is not in the ${c.env.ORG_DOMAIN} directory.`, "not_in_directory");
  }
  if (known && (known.directory_status === "missing" || known.directory_status === "suspended")) {
    fail(409, `${email} is ${known.directory_status} in the directory.`, "inactive_user");
  }

  const now = nowIso();
  const existing = await db.first<{ id: string; status: string }>(
    "SELECT id, status FROM memberships WHERE workspace_id = ? AND user_email = ?",
    a.workspace.id,
    email,
  );
  if (existing?.status === "approved") fail(409, `${email} is already a member.`, "already_member");
  const id = existing?.id ?? newId();
  await db.batch([
    stmt("INSERT INTO users (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING", email),
    existing
      ? stmt(
          `UPDATE memberships SET status = 'approved', role = ?, decided_by = ?, decided_at = ?, decision_note = 'added by manager' WHERE id = ?`,
          role,
          user.email,
          now,
          id,
        )
      : stmt(
          `INSERT INTO memberships (id, workspace_id, user_email, role, status, requested_at, decided_by, decided_at, decision_note)
           VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, 'added by manager')`,
          id,
          a.workspace.id,
          email,
          role,
          now,
          user.email,
          now,
        ),
    auditStmt({ actor: user.email, action: "membership.add", target: email, workspaceId: a.workspace.id, detail: { role } }),
  ]);
  return c.json({ id, status: "approved", role }, 201);
});

const PermBody = z.object({ permissions: z.array(z.enum(TOGGLEABLE_PERMISSIONS as [string, ...string[]])) });

/** Manager/admin switches workspace permissions on/off. */
workspaceRoutes.put("/permissions", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const a = await loadAccess(db, user, c.req.param("wid")!);
  requirePerm(a, "members.manage");
  const { permissions } = await body(c, PermBody);
  const next = [...new Set(permissions)].sort();
  const now = nowIso();
  await db.batch([
    stmt("DELETE FROM workspace_permissions WHERE workspace_id = ?", a.workspace.id),
    ...next.map((p) =>
      stmt(
        "INSERT INTO workspace_permissions (workspace_id, permission, granted_by, granted_at) VALUES (?, ?, ?, ?)",
        a.workspace.id,
        p,
        user.email,
        now,
      ),
    ),
    auditStmt({ actor: user.email, action: "workspace.permissions", target: a.workspace.id, workspaceId: a.workspace.id, detail: { from: a.enabled, to: next } }),
  ]);
  return c.json({ enabledPermissions: next });
});

workspaceRoutes.get("/audit", async (c) => {
  const db = c.get("db");
  const a = await loadAccess(db, c.get("user"), c.req.param("wid")!);
  requirePerm(a, "members.manage");
  const limit = intParam(c.req.query("limit"), 100, 1, 500);
  const rows = await db.all<{ detail: string }>(
    "SELECT * FROM audit_log WHERE workspace_id = ? ORDER BY id DESC LIMIT ?",
    a.workspace.id,
    limit,
  );
  return c.json(rows.map((r) => ({ ...r, detail: JSON.parse(r.detail) })));
});
