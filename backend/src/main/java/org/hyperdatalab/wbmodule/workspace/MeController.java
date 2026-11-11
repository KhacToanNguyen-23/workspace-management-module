package org.hyperdatalab.wbmodule.workspace;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.sql.Array;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.Permissions;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The caller's profile, the workspaces they can ask to join, and join / withdraw / leave. */
@RestController
@RequestMapping("/api")
public class MeController {
    private final JdbcClient db;
    private final IdentityService identity;
    private final AuditService audit;

    public MeController(JdbcClient db, IdentityService identity, AuditService audit) {
        this.db = db;
        this.identity = identity;
        this.audit = audit;
    }

    static List<String> textArray(Array a) throws SQLException {
        return a == null ? List.of() : Arrays.asList((String[]) a.getArray());
    }

    @GetMapping("/health")
    Map<String, Object> health() {
        return Map.of("ok", true);
    }

    record MembershipRow(UUID id, UUID workspaceId, String workspaceName, String workspaceSlug, String workspaceType,
                         String workspaceStatus, String role, String status, OffsetDateTime requestedAt,
                         OffsetDateTime decidedAt, String decisionNote) {}

    @GetMapping("/me")
    Map<String, Object> me(AuthedUser user) {
        IdentityService.UserRow row = identity.find(user.email()).orElseThrow();
        List<MembershipRow> rows = db.sql("""
                SELECT m.id, m.workspace_id, w.name AS workspace_name, w.slug AS workspace_slug,
                       w.type AS workspace_type, w.status AS workspace_status, m.role, m.status,
                       m.requested_at, m.decided_at, m.decision_note
                  FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
                 WHERE m.user_email = ? ORDER BY w.name
                """).param(user.email()).query(MembershipRow.class).list();

        List<Map<String, Object>> memberships = rows.stream().map(m -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", m.id());
            out.put("workspace", Map.of("id", m.workspaceId(), "name", m.workspaceName(), "slug", m.workspaceSlug(),
                    "type", m.workspaceType(), "status", m.workspaceStatus()));
            out.put("role", m.role());
            out.put("status", m.status());
            out.put("requestedAt", m.requestedAt());
            out.put("decidedAt", m.decidedAt());
            out.put("decisionNote", m.decisionNote());
            out.put("permissions", "approved".equals(m.status())
                    ? Permissions.effective(m.role(), enabled(m.workspaceId()), false)
                    : List.of());
            return out;
        }).toList();

        Map<String, Object> u = new LinkedHashMap<>();
        u.put("email", user.email());
        u.put("name", row.name());
        u.put("photoUrl", row.photoUrl());
        u.put("department", row.department());
        u.put("isAdmin", user.admin());
        u.put("directoryStatus", row.directoryStatus());
        return Map.of("user", u, "memberships", memberships);
    }

    private List<String> enabled(UUID workspaceId) {
        return db.sql("SELECT permission FROM workspace_permissions WHERE workspace_id = ?")
                .param(workspaceId).query(String.class).list();
    }

    record WorkspaceType(String code, String name, String description, List<String> defaultPermissions) {}

    @GetMapping("/workspace-types")
    List<WorkspaceType> types() {
        return db.sql("SELECT * FROM workspace_types ORDER BY name")
                .query((rs, i) -> new WorkspaceType(rs.getString("code"), rs.getString("name"),
                        rs.getString("description"), textArray(rs.getArray("default_permissions"))))
                .list();
    }

    record WorkspaceSummary(UUID id, String slug, String name, String type, String description, int memberCount,
                            List<String> managers, String myStatus, String myRole) {}

    /** Active workspaces with the caller's own status, for the "join a workspace" screen. */
    @GetMapping("/workspaces")
    List<WorkspaceSummary> workspaces(AuthedUser user) {
        return db.sql("""
                SELECT w.*, m.status AS my_status, m.role AS my_role,
                       (SELECT COUNT(*) FROM memberships x WHERE x.workspace_id = w.id AND x.status = 'approved') AS member_count,
                       ARRAY(SELECT x.user_email FROM memberships x
                              WHERE x.workspace_id = w.id AND x.status = 'approved' AND x.role = 'manager'
                              ORDER BY x.user_email) AS managers
                  FROM workspaces w
                  LEFT JOIN memberships m ON m.workspace_id = w.id AND m.user_email = ?
                 WHERE w.status = 'active'
                 ORDER BY w.name
                """).param(user.email())
                .query((rs, i) -> new WorkspaceSummary(rs.getObject("id", UUID.class), rs.getString("slug"),
                        rs.getString("name"), rs.getString("type"), rs.getString("description"), rs.getInt("member_count"),
                        textArray(rs.getArray("managers")), rs.getString("my_status"), rs.getString("my_role")))
                .list();
    }

    record JoinBody(@Size(max = 500) String note) {}

    record MemberState(UUID id, String status, String role) {}

    @PostMapping("/workspaces/{id}/join")
    @Transactional
    ResponseEntity<Map<String, Object>> join(AuthedUser user, @PathVariable UUID id, @Valid @RequestBody(required = false) JoinBody body) {
        String note = body == null || body.note() == null ? "" : body.note();
        db.sql("SELECT 1 FROM workspaces WHERE id = ? AND status = 'active'").param(id).query(Integer.class).optional()
                .orElseThrow(() -> ApiException.notFound("Workspace not found."));
        Optional<MemberState> existing = state(id, user.email());
        if (existing.map(m -> m.status().equals("approved")).orElse(false)) {
            throw ApiException.conflict("already_member", "You are already a member.");
        }
        if (existing.map(m -> m.status().equals("pending")).orElse(false)) {
            throw ApiException.conflict("already_pending", "Your request is already waiting for a manager.");
        }
        UUID membershipId;
        if (existing.isPresent()) {
            membershipId = existing.get().id();
            db.sql("""
                    UPDATE memberships SET status = 'pending', role = 'member', note = ?, requested_at = now(),
                           decided_by = NULL, decided_at = NULL, decision_note = '' WHERE id = ?
                    """).params(note, membershipId).update();
        } else {
            membershipId = db.sql("""
                    INSERT INTO memberships (workspace_id, user_email, role, status, note)
                    VALUES (?, ?, 'member', 'pending', ?) RETURNING id
                    """).params(id, user.email(), note).query(UUID.class).single();
        }
        audit.log(user.email(), "membership.request", user.email(), id, Map.of("note", note));
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", membershipId, "status", "pending"));
    }

    /** Withdraw a pending request, or leave a workspace. */
    @DeleteMapping("/workspaces/{id}/join")
    @Transactional
    ResponseEntity<Void> leave(AuthedUser user, @PathVariable UUID id) {
        MemberState m = state(id, user.email())
                .filter(x -> x.status().equals("pending") || x.status().equals("approved"))
                .orElseThrow(() -> ApiException.notFound("Nothing to withdraw."));
        if (m.status().equals("approved") && m.role().equals("manager")) {
            int others = db.sql("""
                    SELECT COUNT(*) FROM memberships
                     WHERE workspace_id = ? AND role = 'manager' AND status = 'approved' AND user_email <> ?
                    """).params(id, user.email()).query(Integer.class).single();
            if (others == 0) {
                throw ApiException.conflict("last_manager", "You are the last manager; ask an admin to assign another one first.");
            }
        }
        db.sql("DELETE FROM memberships WHERE id = ?").param(m.id()).update();
        audit.log(user.email(), m.status().equals("pending") ? "membership.withdraw" : "membership.leave", user.email(), id);
        return ResponseEntity.noContent().build();
    }

    private Optional<MemberState> state(UUID workspaceId, String email) {
        return db.sql("SELECT id, status, role FROM memberships WHERE workspace_id = ? AND user_email = ?")
                .params(workspaceId, email).query(MemberState.class).optional();
    }
}
