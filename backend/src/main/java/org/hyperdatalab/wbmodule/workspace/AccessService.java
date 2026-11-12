package org.hyperdatalab.wbmodule.workspace;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Optional;

@Service
public class AccessService {
    public record WorkspaceRow(
            String id,
            String name,
            String type,
            String description,
            String status,
            String createdBy,
            Object createdAt) {}

    public record Access(WorkspaceRow workspace, String role, boolean canManage) {
        public void requireManager() {
            if (!canManage)
                throw ApiException.forbidden(
                        "forbidden", "Only the workspace manager can do this.");
        }
    }

    private final FirestoreStore store;

    public AccessService(FirestoreStore store) {
        this.store = store;
    }

    public Optional<WorkspaceRow> findWorkspace(String id) {
        return store.get("workspaces", id)
                .map(
                        d ->
                                new WorkspaceRow(
                                        id,
                                        (String) d.get("name"),
                                        (String) d.get("type"),
                                        (String) d.getOrDefault("description", ""),
                                        (String) d.get("status"),
                                        (String) d.get("createdBy"),
                                        d.get("createdAt")));
    }

    public Access load(AuthedUser user, String id) {
        WorkspaceRow w =
                findWorkspace(id).orElseThrow(() -> ApiException.notFound("Workspace not found."));
        Optional<Map<String, Object>> m = store.get("memberships", id + "_" + user.email());
        boolean approved = m.map(x -> "approved".equals(x.get("status"))).orElse(false);
        if (!approved && !user.admin()) {
            boolean pending = m.map(x -> "pending".equals(x.get("status"))).orElse(false);
            throw pending
                    ? ApiException.forbidden(
                            "pending_approval", "Your join request is waiting for a manager.")
                    : ApiException.forbidden(
                            "not_member", "You are not a member of this workspace.");
        }
        if (!"active".equals(w.status()) && !user.admin())
            throw ApiException.forbidden("archived", "This workspace is archived.");
        String role = approved ? (String) m.get().get("role") : null;
        return new Access(w, role, user.admin() || "manager".equals(role));
    }
}
