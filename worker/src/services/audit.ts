import { type Db, type Stmt, nowIso, stmt } from "../lib/db";

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  workspaceId?: string | null;
  detail?: Record<string, unknown>;
}

/** Statement form so the audit row commits in the same batch as the change it records. */
export function auditStmt(e: AuditEntry): Stmt {
  return stmt(
    "INSERT INTO audit_log (at, actor, action, target, workspace_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
    nowIso(),
    e.actor,
    e.action,
    e.target ?? "",
    e.workspaceId ?? null,
    JSON.stringify(e.detail ?? {}),
  );
}

export async function audit(db: Db, e: AuditEntry) {
  const s = auditStmt(e);
  await db.run(s.sql, ...s.params);
}
