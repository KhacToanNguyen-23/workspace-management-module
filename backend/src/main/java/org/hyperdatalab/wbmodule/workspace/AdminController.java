package org.hyperdatalab.wbmodule.workspace;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Global administration (admin@hyperdatalab.org and promoted admins): users, workspaces, managers, audit. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final JdbcClient db;
    private final IdentityService identity;
    private final AuditService audit;
    private final AppProperties props;
    private final ObjectMapper json;

    public AdminController(JdbcClient db, IdentityService identity, AuditService audit, AppProperties props, ObjectMapper json) {
        this.db = db;
        this.identity = identity;
        this.audit = audit;
        this.props = props;
        this.json = json;
    }

    private static void requireAdmin(AuthedUser user) {
        if (!user.admin()) throw ApiException.forbidden("admin_only", "Administrators only.");
    }

    // ---- users ---------------------------------------------------------------------------

    record UserWorkspace(String name, String role, String status) {}

    record AdminUser(String email, String name, String department, String directoryStatus, String globalRole,
                     boolean disabled, OffsetDateTime firstSeen, OffsetDateTime lastSeen, OffsetDateTime syncedAt,
                     List<UserWorkspace> workspaces) {}

    @GetMapping("/users")
    List<AdminUser> users(AuthedUser user, @RequestParam(required = false) String q, @RequestParam(required = false) String status) {
        requireAdmin(user);
        String like = q == null || q.isBlank() ? null : "%" + q.trim().toLowerCase(Locale.ROOT) + "%";
        List<AdminUser> rows = db.sql("""
                SELECT * FROM users
                 WHERE (CAST(:q AS TEXT) IS NULL OR email LIKE :q OR LOWER(name) LIKE :q)
                   AND (CAST(:status AS TEXT) IS NULL OR directory_status = :status)
                 ORDER BY email LIMIT 2000
                """).param("q", like).param("status", status)
                .query((rs, i) -> new AdminUser(rs.getString("email"), rs.getString("name"), rs.getString("department"),
                        rs.getString("directory_status"), rs.getString("global_role"), rs.getBoolean("disabled"),
                        rs.getObject("first_seen", OffsetDateTime.class), rs.getObject("last_seen", OffsetDateTime.class),
                        rs.getObject("synced_at", OffsetDateTime.class), new ArrayList<>()))
                .list();
        Map<String, AdminUser> byEmail = new LinkedHashMap<>();
        rows.forEach(r -> byEmail.put(r.email(), r));
        db.sql("""
                SELECT m.user_email, w.name, m.role, m.status FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
                 ORDER BY w.name
                """).query((rs, i) -> {
                    AdminUser u = byEmail.get(rs.getString("user_email"));
                    if (u != null) u.workspaces().add(new UserWorkspace(rs.getString("name"), rs.getString("role"), rs.getString("status")));
                    return null;
                }).list();
        return rows;
    }

    @PostMapping("/users/sync")
    IdentityService.SyncResult sync(AuthedUser user) {
        requireAdmin(user);
        return identity.syncDirectory(user.email());
    }

    /** Re-reads one user from the user directory right now (ignores the cache). */
    @PostMapping("/users/{email}/refresh")
    @Transactional
    Map<String, Object> refreshUser(AuthedUser user, @PathVariable String email) {
        requireAdmin(user);
        String target = email.toLowerCase(Locale.ROOT);
        String status = identity.refreshFromDirectory(target);
        audit.log(user.email(), "user.refresh", target, null, Map.of("directoryStatus", status));
        return Map.of("email", target, "directoryStatus", status);
    }

    record UserPatch(Boolean disabled, @Pattern(regexp = "user|admin") String globalRole) {}

    @PatchMapping("/users/{email}")
    @Transactional
    Map<String, Object> patchUser(AuthedUser user, @PathVariable String email, @Valid @RequestBody UserPatch patch) {
        requireAdmin(user);
        String target = email.toLowerCase(Locale.ROOT);
        identity.find(target).orElseThrow(() -> ApiException.notFound("User not found."));
        if (target.equalsIgnoreCase(props.adminEmail())) throw ApiException.conflict("protected", "The domain admin account cannot be changed here.");
        if (target.equals(user.email()) && "user".equals(patch.globalRole())) throw ApiException.conflict("self_change", "You cannot remove your own admin role.");
        db.sql("UPDATE users SET disabled = COALESCE(?, disabled), global_role = COALESCE(?, global_role) WHERE email = ?")
                .params(patch.disabled(), patch.globalRole(), target).update();
        Map<String, Object> detail = new LinkedHashMap<>();
        if (patch.disabled() != null) detail.put("disabled", patch.disabled());
        if (patch.globalRole() != null) detail.put("globalRole", patch.globalRole());
        audit.log(user.email(), "user.update", target, null, detail);
        Map<String, Object> out = new LinkedHashMap<>(detail);
        out.put("email", target);
        return out;
    }

    // ---- workspace types -----------------------------------------------------------------

    record TypeBody(@NotBlank @Pattern(regexp = "[a-z][a-z0-9_-]{1,30}") String code, @NotBlank @Size(max = 60) String name,
                    @Size(max = 300) String description, List<@Pattern(regexp = org.hyperdatalab.wbmodule.common.Permissions.TOGGLEABLE_PATTERN) String> defaultPermissions) {}

    @PostMapping("/workspace-types")
    @Transactional
    ResponseEntity<TypeBody> createType(AuthedUser user, @Valid @RequestBody TypeBody t) {
        requireAdmin(user);
        if (db.sql("SELECT 1 FROM workspace_types WHERE code = ?").param(t.code()).query(Integer.class).optional().isPresent()) {
            throw ApiException.conflict("duplicate", "Type code already exists.");
        }
        List<String> perms = t.defaultPermissions() == null ? List.of("workspace.read") : t.defaultPermissions();
        db.sql("INSERT INTO workspace_types (code, name, description, default_permissions) VALUES (?, ?, ?, ?)")
                .params(t.code(), t.name(), t.description() == null ? "" : t.description(), perms.toArray(String[]::new)).update();
        audit.log(user.email(), "workspace_type.create", t.code(), null, Map.of("name", t.name(), "defaultPermissions", perms));
        return ResponseEntity.status(HttpStatus.CREATED).body(new TypeBody(t.code(), t.name(), t.description(), perms));
    }

    // ---- workspaces ----------------------------------------------------------------------

    record AdminWorkspace(UUID id, String slug, String name, String type, String description, String status,
                          String createdBy, OffsetDateTime createdAt, int memberCount, int pendingCount,
                          List<String> managers, List<String> permissions) {}

    @GetMapping("/workspaces")
    List<AdminWorkspace> workspaces(AuthedUser user) {
        requireAdmin(user);
        return db.sql("""
                SELECT w.*,
                  (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id AND m.status = 'approved') AS member_count,
                  (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id AND m.status = 'pending') AS pending_count,
                  ARRAY(SELECT m.user_email FROM memberships m WHERE m.workspace_id = w.id AND m.status = 'approved'
                          AND m.role = 'manager' ORDER BY m.user_email) AS managers,
                  ARRAY(SELECT p.permission FROM workspace_permissions p WHERE p.workspace_id = w.id ORDER BY p.permission) AS permissions
                FROM workspaces w ORDER BY w.status, w.name
                """).query((rs, i) -> new AdminWorkspace(rs.getObject("id", UUID.class), rs.getString("slug"),
                        rs.getString("name"), rs.getString("type"), rs.getString("description"), rs.getString("status"),
                        rs.getString("created_by"), rs.getObject("created_at", OffsetDateTime.class),
                        rs.getInt("member_count"), rs.getInt("pending_count"),
                        MeController.textArray(rs.getArray("managers")), MeController.textArray(rs.getArray("permissions"))))
                .list();
    }

    record WorkspaceCreate(@NotBlank @Size(max = 120) String name, @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9-]{1,48}") String slug,
                           @NotBlank String type, @Size(max = 1000) String description, List<@Email String> managers) {}

    @PostMapping("/workspaces")
    @Transactional
    ResponseEntity<Map<String, Object>> createWorkspace(AuthedUser user, @Valid @RequestBody WorkspaceCreate w) {
        requireAdmin(user);
        List<String> perms = db.sql("SELECT default_permissions FROM workspace_types WHERE code = ?").param(w.type())
                .query((rs, i) -> MeController.textArray(rs.getArray(1))).optional()
                .orElseThrow(() -> ApiException.unprocessable("unknown_type", "Unknown workspace type \"" + w.type() + "\"."));
        if (db.sql("SELECT 1 FROM workspaces WHERE slug = ?").param(w.slug()).query(Integer.class).optional().isPresent()) {
            throw ApiException.conflict("duplicate", "Slug already used.");
        }
        LinkedHashSet<String> managers = new LinkedHashSet<>();
        for (String m : w.managers() == null ? List.<String>of() : w.managers()) {
            String e = m.toLowerCase(Locale.ROOT);
            if (!identity.isOrgEmail(e)) throw ApiException.unprocessable("wrong_domain", e + " is not an address of the org domain.");
            managers.add(e);
        }
        UUID id = db.sql("""
                INSERT INTO workspaces (slug, name, type, description, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id
                """).params(w.slug(), w.name().trim(), w.type(), w.description() == null ? "" : w.description(), user.email())
                .query(UUID.class).single();
        for (String p : perms) {
            db.sql("INSERT INTO workspace_permissions (workspace_id, permission, granted_by) VALUES (?, ?, ?)").params(id, p, user.email()).update();
        }
        for (String m : managers) assignManager(user, id, m);
        audit.log(user.email(), "workspace.create", id.toString(), id,
                Map.of("name", w.name(), "slug", w.slug(), "type", w.type(), "managers", List.copyOf(managers), "permissions", perms));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("name", w.name());
        out.put("slug", w.slug());
        out.put("type", w.type());
        out.put("managers", List.copyOf(managers));
        out.put("permissions", perms);
        return ResponseEntity.status(HttpStatus.CREATED).body(out);
    }

    record WorkspacePatch(@Size(min = 1, max = 120) String name, @Size(max = 1000) String description, String type,
                          @Pattern(regexp = "active|archived") String status) {}

    @PatchMapping("/workspaces/{id}")
    @Transactional
    Map<String, Object> patchWorkspace(AuthedUser user, @PathVariable UUID id, @Valid @RequestBody WorkspacePatch p) {
        requireAdmin(user);
        if (db.sql("SELECT 1 FROM workspaces WHERE id = ?").param(id).query(Integer.class).optional().isEmpty()) {
            throw ApiException.notFound("Workspace not found.");
        }
        if (p.type() != null && db.sql("SELECT 1 FROM workspace_types WHERE code = ?").param(p.type()).query(Integer.class).optional().isEmpty()) {
            throw ApiException.unprocessable("unknown_type", "Unknown type.");
        }
        db.sql("""
                UPDATE workspaces SET name = COALESCE(?, name), description = COALESCE(?, description),
                       type = COALESCE(?, type), status = COALESCE(?, status) WHERE id = ?
                """).params(p.name(), p.description(), p.type(), p.status(), id).update();
        Map<String, Object> detail = json.convertValue(p, Map.class);
        detail.values().removeIf(v -> v == null);
        audit.log(user.email(), "workspace.update", id.toString(), id, detail);
        detail.put("id", id);
        return detail;
    }

    record ManagerBody(@NotNull @Email String email) {}

    /** Make a domain user manager of a workspace (creates or upgrades the membership). */
    @PostMapping("/workspaces/{id}/managers")
    @Transactional
    ResponseEntity<Map<String, Object>> addManager(AuthedUser user, @PathVariable UUID id, @Valid @RequestBody ManagerBody body) {
        requireAdmin(user);
        String email = body.email().toLowerCase(Locale.ROOT);
        if (!identity.isOrgEmail(email)) throw ApiException.unprocessable("wrong_domain", "Only addresses of the org domain.");
        if (db.sql("SELECT 1 FROM workspaces WHERE id = ?").param(id).query(Integer.class).optional().isEmpty()) {
            throw ApiException.notFound("Workspace not found.");
        }
        assignManager(user, id, email);
        audit.log(user.email(), "workspace.manager", email, id);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("workspaceId", id, "email", email, "role", "manager"));
    }

    private void assignManager(AuthedUser user, UUID workspaceId, String email) {
        db.sql("INSERT INTO users (email) VALUES (?) ON CONFLICT (email) DO NOTHING").param(email).update();
        db.sql("""
                INSERT INTO memberships (workspace_id, user_email, role, status, decided_by, decided_at, decision_note)
                VALUES (?, ?, 'manager', 'approved', ?, now(), 'assigned by admin')
                ON CONFLICT (workspace_id, user_email) DO UPDATE SET role = 'manager', status = 'approved',
                  decided_by = EXCLUDED.decided_by, decided_at = now(), decision_note = EXCLUDED.decision_note
                """).params(workspaceId, email, user.email()).update();
    }

    @GetMapping("/audit")
    List<WorkspaceController.AuditRow> audit(AuthedUser user, @RequestParam(defaultValue = "200") int limit) {
        requireAdmin(user);
        return db.sql("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").param(Math.max(1, Math.min(limit, 1000)))
                .query((rs, i) -> WorkspaceController.auditRow(rs, json)).list();
    }
}
