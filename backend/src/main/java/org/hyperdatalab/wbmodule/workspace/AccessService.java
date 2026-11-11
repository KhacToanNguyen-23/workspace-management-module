package org.hyperdatalab.wbmodule.workspace;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.Permissions;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * The gate every workspace-scoped route goes through: the caller needs an <b>approved</b>
 * membership (or the global admin role) and the workspace must be active.
 */
@Service
public class AccessService {
    public record WorkspaceRow(UUID id, String slug, String name, String type, String description, String status,
                               String createdBy, OffsetDateTime createdAt) {}

    public record Access(WorkspaceRow workspace, String role, List<String> enabled, List<String> permissions) {
        public void require(String permission) {
            if (!permissions.contains(permission)) {
                throw ApiException.forbidden("forbidden",
                        "Missing permission \"" + permission + "\" in workspace \"" + workspace.name() + "\".");
            }
        }
    }

    private record MemberState(String role, String status) {}

    private final JdbcClient db;

    public AccessService(JdbcClient db) {
        this.db = db;
    }

    public Optional<WorkspaceRow> findWorkspace(UUID id) {
        return db.sql("SELECT * FROM workspaces WHERE id = ?").param(id).query(WorkspaceRow.class).optional();
    }

    public List<String> enabledPermissions(UUID workspaceId) {
        return db.sql("SELECT permission FROM workspace_permissions WHERE workspace_id = ? ORDER BY permission")
                .param(workspaceId).query(String.class).list();
    }

    public Access load(AuthedUser user, UUID workspaceId) {
        WorkspaceRow ws = findWorkspace(workspaceId).orElseThrow(() -> ApiException.notFound("Workspace not found."));
        Optional<MemberState> m = db.sql("SELECT role, status FROM memberships WHERE workspace_id = ? AND user_email = ?")
                .params(workspaceId, user.email()).query(MemberState.class).optional();
        boolean approved = m.map(x -> "approved".equals(x.status())).orElse(false);
        if (!approved && !user.admin()) {
            boolean pending = m.map(x -> "pending".equals(x.status())).orElse(false);
            throw pending
                    ? ApiException.forbidden("pending_approval", "Your join request is waiting for a manager.")
                    : ApiException.forbidden("not_member", "You are not a member of this workspace.");
        }
        if (!"active".equals(ws.status()) && !user.admin()) {
            throw ApiException.forbidden("archived", "This workspace is archived.");
        }
        List<String> enabled = enabledPermissions(workspaceId);
        String role = approved ? m.get().role() : null;
        return new Access(ws, role, enabled, Permissions.effective(role, enabled, user.admin()));
    }
}
