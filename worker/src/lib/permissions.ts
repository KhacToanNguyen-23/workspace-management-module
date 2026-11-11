/**
 * Permission model.
 *
 * - Global role: `admin` (admin@hyperdatalab.org and anyone promoted) can do everything everywhere.
 * - Workspace role: viewer < member < manager, granted when a manager approves a join request.
 * - Workspace permissions: the set a manager/admin switches on for the workspace.
 *
 * Effective permissions in a workspace = ROLE_PERMISSIONS[role] ∩ enabled permissions.
 * `members.manage` is never gated by the workspace switch, so a manager can always
 * approve requests and turn permissions back on.
 */
export const PERMISSIONS = [
  "corpus.read",
  "corpus.write",
  "corpus.fetch",
  "corpus.download",
  "extraction.run",
  "members.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions a manager can switch on/off for a workspace. */
export const TOGGLEABLE_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => p !== "members.manage");

export const WORKSPACE_ROLES = ["viewer", "member", "manager"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
  viewer: ["corpus.read"],
  member: ["corpus.read", "corpus.write", "corpus.fetch", "corpus.download", "extraction.run"],
  manager: [...PERMISSIONS],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function effectivePermissions(
  role: WorkspaceRole | null,
  enabled: Iterable<string>,
  isAdmin: boolean,
): Permission[] {
  if (isAdmin) return [...PERMISSIONS];
  if (!role) return [];
  const on = new Set(enabled);
  return ROLE_PERMISSIONS[role].filter((p) => p === "members.manage" || on.has(p));
}
