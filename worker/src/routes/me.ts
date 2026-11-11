import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { newId, nowIso, stmt } from "../lib/db";
import { body, fail } from "../lib/http";
import { effectivePermissions, type WorkspaceRole } from "../lib/permissions";
import { auditStmt } from "../services/audit";
import type { WorkspaceRow } from "../services/access";
import type { UserRow } from "../services/identity";

export const meRoutes = new Hono<AppEnv>();

/** Current user, every membership (any status) and effective permissions per approved workspace. */
meRoutes.get("/me", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const row = await db.first<UserRow>("SELECT * FROM users WHERE email = ?", user.email);
  const memberships = await db.all<{
    id: string;
    workspace_id: string;
    workspace_name: string;
    workspace_slug: string;
    workspace_type: string;
    workspace_status: string;
    role: WorkspaceRole;
    status: string;
    requested_at: string;
    decided_at: string | null;
    decision_note: string;
  }>(
    `SELECT m.id, m.workspace_id, w.name AS workspace_name, w.slug AS workspace_slug, w.type AS workspace_type,
            w.status AS workspace_status, m.role, m.status, m.requested_at, m.decided_at, m.decision_note
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_email = ? ORDER BY w.name`,
    user.email,
  );
  const enabledRows = await db.all<{ workspace_id: string; permission: string }>(
    `SELECT p.workspace_id, p.permission FROM workspace_permissions p
       JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_email = ?`,
    user.email,
  );
  return c.json({
    user: {
      email: user.email,
      name: row?.name ?? user.name,
      photoUrl: row?.photo_url ?? null,
      orgUnit: row?.org_unit ?? null,
      isAdmin: user.isAdmin,
      directoryStatus: row?.directory_status ?? "unknown",
    },
    memberships: memberships.map((m) => ({
      id: m.id,
      workspace: { id: m.workspace_id, name: m.workspace_name, slug: m.workspace_slug, type: m.workspace_type, status: m.workspace_status },
      role: m.role,
      status: m.status,
      requestedAt: m.requested_at,
      decidedAt: m.decided_at,
      decisionNote: m.decision_note,
      permissions:
        m.status === "approved"
          ? effectivePermissions(
              m.role,
              enabledRows.filter((r) => r.workspace_id === m.workspace_id).map((r) => r.permission),
              false,
            )
          : [],
    })),
  });
});

meRoutes.get("/workspace-types", async (c) => {
  const rows = await c.get("db").all<{ code: string; name: string; description: string; default_permissions: string }>(
    "SELECT * FROM workspace_types ORDER BY name",
  );
  return c.json(rows.map((r) => ({ ...r, default_permissions: JSON.parse(r.default_permissions) })));
});

/** Workspaces a user can ask to join (active ones), with the caller's own status. */
meRoutes.get("/workspaces", async (c) => {
  const db = c.get("db");
  const rows = await db.all<WorkspaceRow & { my_status: string | null; my_role: string | null; member_count: number; managers: string | null }>(
    `SELECT w.*, m.status AS my_status, m.role AS my_role,
            (SELECT COUNT(*) FROM memberships x WHERE x.workspace_id = w.id AND x.status = 'approved') AS member_count,
            (SELECT GROUP_CONCAT(x.user_email) FROM memberships x
               WHERE x.workspace_id = w.id AND x.status = 'approved' AND x.role = 'manager') AS managers
       FROM workspaces w
       LEFT JOIN memberships m ON m.workspace_id = w.id AND m.user_email = ?
      WHERE w.status = 'active'
      ORDER BY w.name`,
    c.get("user").email,
  );
  return c.json(
    rows.map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      type: w.type,
      description: w.description,
      memberCount: w.member_count,
      managers: w.managers ? w.managers.split(",") : [],
      myStatus: w.my_status,
      myRole: w.my_role,
    })),
  );
});

const JoinBody = z.object({ note: z.string().max(500).default("") });

meRoutes.post("/workspaces/:id/join", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const wid = c.req.param("id");
  const { note } = await body(c, JoinBody);
  const ws = await db.first<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", wid);
  if (!ws || ws.status !== "active") fail(404, "Workspace not found.", "not_found");

  const existing = await db.first<{ id: string; status: string }>(
    "SELECT id, status FROM memberships WHERE workspace_id = ? AND user_email = ?",
    wid,
    user.email,
  );
  if (existing?.status === "approved") fail(409, "You are already a member.", "already_member");
  if (existing?.status === "pending") fail(409, "Your request is already waiting for a manager.", "already_pending");

  const now = nowIso();
  const id = existing?.id ?? newId();
  await db.batch([
    existing
      ? stmt(
          `UPDATE memberships SET status = 'pending', role = 'member', note = ?, requested_at = ?,
                  decided_by = NULL, decided_at = NULL, decision_note = '' WHERE id = ?`,
          note,
          now,
          id,
        )
      : stmt(
          `INSERT INTO memberships (id, workspace_id, user_email, role, status, note, requested_at)
           VALUES (?, ?, ?, 'member', 'pending', ?, ?)`,
          id,
          wid,
          user.email,
          note,
          now,
        ),
    auditStmt({ actor: user.email, action: "membership.request", target: user.email, workspaceId: wid, detail: { note } }),
  ]);
  return c.json({ id, status: "pending" }, 201);
});

/** Withdraw a pending request or leave a workspace. */
meRoutes.delete("/workspaces/:id/join", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const wid = c.req.param("id");
  const m = await db.first<{ id: string; status: string; role: string }>(
    "SELECT id, status, role FROM memberships WHERE workspace_id = ? AND user_email = ?",
    wid,
    user.email,
  );
  if (!m || (m.status !== "pending" && m.status !== "approved")) fail(404, "Nothing to withdraw.", "not_found");
  if (m.status === "approved" && m.role === "manager") {
    const others = await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'manager' AND status = 'approved' AND user_email <> ?`,
      wid,
      user.email,
    );
    if (!others?.n) fail(409, "You are the last manager; ask an admin to assign another one first.", "last_manager");
  }
  await db.batch([
    stmt("DELETE FROM memberships WHERE id = ?", m.id),
    auditStmt({
      actor: user.email,
      action: m.status === "pending" ? "membership.withdraw" : "membership.leave",
      target: user.email,
      workspaceId: wid,
    }),
  ]);
  return c.body(null, 204);
});
