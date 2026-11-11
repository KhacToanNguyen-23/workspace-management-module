package org.hyperdatalab.wbmodule.workspace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;
import java.util.UUID;
import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.Permissions;
import org.hyperdatalab.wbmodule.directory.UserDirectory;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Members, join-request approval, permissions and audit of one workspace (/api/w/{wid}). */
@RestController
@RequestMapping("/api/w/{wid}")
public class WorkspaceController {
    private static final String ROLE_PATTERN = "viewer|member|manager";

    private final JdbcClient db;
    private final AccessService access;
    private final AuditService audit;
    private final IdentityService identity;
    private final UserDirectory directory;
    private final ObjectMapper json;

    public WorkspaceController(JdbcClient db, AccessService access, AuditService audit, IdentityService identity,
                               UserDirectory directory, ObjectMapper json) {
        this.db = db;
        this.access = access;
        this.audit = audit;
        this.identity = identity;
        this.directory = directory;
        this.json = json;
    }

    @GetMapping
    Map<String, Object> info(AuthedUser user, @PathVariable UUID wid) {
        AccessService.Access a = access.load(user, wid);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("workspace", a.workspace());
        out.put("role", a.role());
        out.put("enabledPermissions", a.enabled());
        out.put("permissions", a.permissions());
        out.put("allPermissions", Permissions.ALL);
        out.put("toggleablePermissions", Permissions.TOGGLEABLE);
        return out;
    }

    public record MemberRow(UUID id, String email, String name, String department, String directoryStatus, String role,
                            String status, String note, OffsetDateTime requestedAt, String decidedBy,
                            OffsetDateTime decidedAt, String decisionNote) {}

    @GetMapping("/members")
    List<MemberRow> members(AuthedUser user, @PathVariable UUID wid, @RequestParam(required = false) String status) {
        AccessService.Access a = access.load(user, wid);
        a.require(Permissions.MEMBERS_MANAGE);
        return db.sql("""
                SELECT m.id, m.user_email AS email, u.name, u.department, u.directory_status, m.role, m.status, m.note,
                       m.requested_at, m.decided_by, m.decided_at, m.decision_note
                  FROM memberships m JOIN users u ON u.email = m.user_email
                 WHERE m.workspace_id = :wid AND (CAST(:status AS TEXT) IS NULL OR m.status = :status)
                 ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, m.requested_at DESC
                """).param("wid", wid).param("status", status).query(MemberRow.class).list();
    }

    public record Person(String email, String name, String department, String photoUrl, String role) {}

    /** Approved members of the workspace; visible to every member (the full queue needs members.manage). */
    @GetMapping("/people")
    List<Person> people(AuthedUser user, @PathVariable UUID wid) {
        access.load(user, wid).require(Permissions.READ);
        return db.sql("""
                SELECT u.email, u.name, u.department, u.photo_url, m.role
                  FROM memberships m JOIN users u ON u.email = m.user_email
                 WHERE m.workspace_id = ? AND m.status = 'approved'
                 ORDER BY CASE m.role WHEN 'manager' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.name, u.email
                """).param(wid).query(Person.class).list();
    }

    record Decision(@Pattern(regexp = ROLE_PATTERN) String role, @Size(max = 500) String note) {
        String noteOrEmpty() {
            return note == null ? "" : note;
        }
    }

    record Target(UUID id, String userEmail, String role, String status) {}

    private record Ctx(AccessService.Access access, Target member) {}

    /** Loads the membership being acted on; managers may not act on themselves. */
    private Ctx target(AuthedUser user, UUID wid, UUID mid) {
        AccessService.Access a = access.load(user, wid);
        a.require(Permissions.MEMBERS_MANAGE);
        Target m = db.sql("SELECT id, user_email, role, status FROM memberships WHERE id = ? AND workspace_id = ?")
                .params(mid, wid).query(Target.class).optional()
                .orElseThrow(() -> ApiException.notFound("Membership not found."));
        if (m.userEmail().equals(user.email()) && !user.admin()) {
            throw ApiException.forbidden("self_change", "Managers cannot change their own membership.");
        }
        return new Ctx(a, m);
    }

    private static void requireAdminFor(AuthedUser user, boolean touchesManager) {
        if (touchesManager && !user.admin()) {
            throw ApiException.forbidden("admin_only", "Only an admin can grant or remove the manager role.");
        }
    }

    private void decide(AuthedUser user, UUID membershipId, String status, String role, String note) {
        db.sql("""
                UPDATE memberships SET status = ?, role = ?, decided_by = ?, decided_at = now(), decision_note = ?
                 WHERE id = ?
                """).params(status, role, user.email(), note, membershipId).update();
    }

    @PostMapping("/members/{mid}/approve")
    @Transactional
    Map<String, Object> approve(AuthedUser user, @PathVariable UUID wid, @PathVariable UUID mid, @Valid @RequestBody(required = false) Decision body) {
        Ctx c = target(user, wid, mid);
        String role = body != null && body.role() != null ? body.role() : c.member().role();
        if (!c.member().status().equals("pending")) throw ApiException.conflict("not_pending", "Request is " + c.member().status() + ", not pending.");
        requireAdminFor(user, role.equals("manager"));
        String note = body == null ? "" : body.noteOrEmpty();
        decide(user, mid, "approved", role, note);
        audit.log(user.email(), "membership.approve", c.member().userEmail(), wid, Map.of("role", role, "note", note));
        return Map.of("id", mid, "status", "approved", "role", role);
    }

    @PostMapping("/members/{mid}/reject")
    @Transactional
    Map<String, Object> reject(AuthedUser user, @PathVariable UUID wid, @PathVariable UUID mid, @Valid @RequestBody(required = false) Decision body) {
        Ctx c = target(user, wid, mid);
        if (!c.member().status().equals("pending")) throw ApiException.conflict("not_pending", "Request is " + c.member().status() + ", not pending.");
        String note = body == null ? "" : body.noteOrEmpty();
        decide(user, mid, "rejected", c.member().role(), note);
        audit.log(user.email(), "membership.reject", c.member().userEmail(), wid, Map.of("note", note));
        return Map.of("id", mid, "status", "rejected");
    }

    @PostMapping("/members/{mid}/revoke")
    @Transactional
    Map<String, Object> revoke(AuthedUser user, @PathVariable UUID wid, @PathVariable UUID mid, @Valid @RequestBody(required = false) Decision body) {
        Ctx c = target(user, wid, mid);
        if (!c.member().status().equals("approved")) throw ApiException.conflict("not_approved", "Membership is " + c.member().status() + ", not approved.");
        requireAdminFor(user, c.member().role().equals("manager"));
        String note = body == null ? "" : body.noteOrEmpty();
        decide(user, mid, "revoked", c.member().role(), note);
        audit.log(user.email(), "membership.revoke", c.member().userEmail(), wid, Map.of("note", note));
        return Map.of("id", mid, "status", "revoked");
    }

    record RoleBody(@NotNull @Pattern(regexp = ROLE_PATTERN) String role) {}

    @PatchMapping("/members/{mid}")
    @Transactional
    Map<String, Object> changeRole(AuthedUser user, @PathVariable UUID wid, @PathVariable UUID mid, @Valid @RequestBody RoleBody body) {
        Ctx c = target(user, wid, mid);
        if (!c.member().status().equals("approved")) throw ApiException.conflict("not_approved", "Only approved members have a role to change.");
        requireAdminFor(user, body.role().equals("manager") || c.member().role().equals("manager"));
        db.sql("UPDATE memberships SET role = ? WHERE id = ?").params(body.role(), mid).update();
        audit.log(user.email(), "membership.role", c.member().userEmail(), wid, Map.of("from", c.member().role(), "to", body.role()));
        return Map.of("id", mid, "role", body.role());
    }

    record AddBody(@NotBlank @Email String email, @Pattern(regexp = ROLE_PATTERN) String role) {}

    /** A manager adds a registered domain user directly (approved), without waiting for a request. */
    @PostMapping("/members")
    @Transactional
    ResponseEntity<Map<String, Object>> add(AuthedUser user, @PathVariable UUID wid, @Valid @RequestBody AddBody body) {
        AccessService.Access a = access.load(user, wid);
        a.require(Permissions.MEMBERS_MANAGE);
        String email = body.email().toLowerCase(Locale.ROOT);
        String role = body.role() == null ? "member" : body.role();
        if (!identity.isOrgEmail(email)) throw ApiException.unprocessable("wrong_domain", "Only addresses of the org domain can be added.");
        requireAdminFor(user, role.equals("manager"));

        Optional<IdentityService.UserRow> known = identity.find(email);
        if (known.isEmpty() && !directory.mode().equals("off") && directory.find(email).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "not_in_directory", email + " is not registered under the org domain.");
        }
        if (known.map(u -> u.directoryStatus().equals("missing") || u.directoryStatus().equals("suspended")).orElse(false)) {
            throw ApiException.conflict("inactive_user", email + " is " + known.get().directoryStatus() + " in the directory.");
        }
        Optional<String> existing = db.sql("SELECT status FROM memberships WHERE workspace_id = ? AND user_email = ?")
                .params(wid, email).query(String.class).optional();
        if (existing.map("approved"::equals).orElse(false)) throw ApiException.conflict("already_member", email + " is already a member.");

        db.sql("INSERT INTO users (email) VALUES (?) ON CONFLICT (email) DO NOTHING").param(email).update();
        UUID id = db.sql("""
                INSERT INTO memberships (workspace_id, user_email, role, status, decided_by, decided_at, decision_note)
                VALUES (?, ?, ?, 'approved', ?, now(), 'added by manager')
                ON CONFLICT (workspace_id, user_email) DO UPDATE SET role = EXCLUDED.role, status = 'approved',
                  decided_by = EXCLUDED.decided_by, decided_at = now(), decision_note = EXCLUDED.decision_note
                RETURNING id
                """).params(wid, email, role, user.email()).query(UUID.class).single();
        audit.log(user.email(), "membership.add", email, wid, Map.of("role", role));
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id, "status", "approved", "role", role));
    }

    record PermissionsBody(@NotNull List<@Pattern(regexp = Permissions.TOGGLEABLE_PATTERN) String> permissions) {}

    /** Manager or admin switches workspace permissions on/off. */
    @PutMapping("/permissions")
    @Transactional
    Map<String, Object> setPermissions(AuthedUser user, @PathVariable UUID wid, @Valid @RequestBody PermissionsBody body) {
        AccessService.Access a = access.load(user, wid);
        a.require(Permissions.MEMBERS_MANAGE);
        List<String> next = List.copyOf(new TreeSet<>(body.permissions()));
        db.sql("DELETE FROM workspace_permissions WHERE workspace_id = ?").param(wid).update();
        for (String p : next) {
            db.sql("INSERT INTO workspace_permissions (workspace_id, permission, granted_by) VALUES (?, ?, ?)")
                    .params(wid, p, user.email()).update();
        }
        audit.log(user.email(), "workspace.permissions", wid.toString(), wid, Map.of("from", a.enabled(), "to", next));
        return Map.of("enabledPermissions", next);
    }

    public record AuditRow(long id, OffsetDateTime at, String actor, String action, String target, UUID workspaceId, JsonNode detail) {}

    static AuditRow auditRow(java.sql.ResultSet rs, ObjectMapper json) throws java.sql.SQLException {
        JsonNode detail;
        try {
            detail = json.readTree(rs.getString("detail"));
        } catch (Exception e) {
            detail = json.createObjectNode();
        }
        return new AuditRow(rs.getLong("id"), rs.getObject("at", OffsetDateTime.class), rs.getString("actor"),
                rs.getString("action"), rs.getString("target"), rs.getObject("workspace_id", UUID.class), detail);
    }

    @GetMapping("/audit")
    List<AuditRow> audit(AuthedUser user, @PathVariable UUID wid, @RequestParam(defaultValue = "100") int limit) {
        access.load(user, wid).require(Permissions.MEMBERS_MANAGE);
        return db.sql("SELECT * FROM audit_log WHERE workspace_id = ? ORDER BY id DESC LIMIT ?")
                .params(wid, Math.max(1, Math.min(limit, 500)))
                .query((rs, i) -> auditRow(rs, json)).list();
    }
}
