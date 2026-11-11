import type { AuthedUser } from "../env";
import type { Db } from "../lib/db";
import { fail } from "../lib/http";
import { type Permission, type WorkspaceRole, effectivePermissions } from "../lib/permissions";

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  description: string;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
}

export interface WorkspaceAccess {
  workspace: WorkspaceRow;
  role: WorkspaceRole | null; // null = admin without membership
  enabled: string[];
  permissions: Permission[];
}

export async function enabledPermissions(db: Db, workspaceId: string): Promise<string[]> {
  const rows = await db.all<{ permission: string }>(
    "SELECT permission FROM workspace_permissions WHERE workspace_id = ? ORDER BY permission",
    workspaceId,
  );
  return rows.map((r) => r.permission);
}

/**
 * The gate every workspace-scoped route goes through: the user must hold an *approved*
 * membership (or be a global admin), and the workspace must be active.
 */
export async function loadAccess(db: Db, user: AuthedUser, workspaceId: string): Promise<WorkspaceAccess> {
  const workspace = await db.first<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", workspaceId);
  if (!workspace) fail(404, "Workspace not found.", "not_found");

  const m = await db.first<{ role: WorkspaceRole; status: string }>(
    "SELECT role, status FROM memberships WHERE workspace_id = ? AND user_email = ?",
    workspaceId,
    user.email,
  );
  const approved = m?.status === "approved";
  if (!approved && !user.isAdmin) {
    const why = m?.status === "pending" ? "Your join request is waiting for a manager." : "You are not a member of this workspace.";
    fail(403, why, m?.status === "pending" ? "pending_approval" : "not_member");
  }
  if (workspace.status !== "active" && !user.isAdmin) fail(403, "This workspace is archived.", "archived");

  const enabled = await enabledPermissions(db, workspaceId);
  const role = approved ? m!.role : null;
  return { workspace, role, enabled, permissions: effectivePermissions(role, enabled, user.isAdmin) };
}

export function requirePerm(access: WorkspaceAccess, perm: Permission) {
  if (!access.permissions.includes(perm)) {
    fail(403, `Missing permission "${perm}" in workspace "${access.workspace.name}".`, "forbidden");
  }
}
