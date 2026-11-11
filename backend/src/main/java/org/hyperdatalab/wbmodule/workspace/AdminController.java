package org.hyperdatalab.wbmodule.workspace;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentSnapshot;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.UserStore;
import org.hyperdatalab.wbmodule.store.WorkspaceRequestStore;
import org.hyperdatalab.wbmodule.store.WorkspaceStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Administrative endpoints for users, workspaces, creation requests and audit history. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final FirestoreStore store;
    private final IdentityService identity;
    private final AuditService audit;
    private final AppProperties props;
    private final WorkspaceService workspaces;
    private final UserStore users;
    private final WorkspaceStore workspaceStore;
    private final MembershipStore memberships;
    private final WorkspaceRequestStore workspaceRequests;

    public AdminController(
            FirestoreStore s,
            IdentityService i,
            AuditService a,
            AppProperties p,
            WorkspaceService w,
            UserStore users,
            WorkspaceStore workspaceStore,
            MembershipStore memberships,
            WorkspaceRequestStore workspaceRequests) {
        store = s;
        identity = i;
        audit = a;
        props = p;
        workspaces = w;
        this.users = users;
        this.workspaceStore = workspaceStore;
        this.memberships = memberships;
        this.workspaceRequests = workspaceRequests;
    }

    private static void admin(AuthedUser u) {
        if (!u.admin()) throw ApiException.forbidden("admin_only", "Administrators only.");
    }

    /** Lists users with optional role, disabled-state and text filters. */
    @GetMapping("/users")
    List<Map<String, Object>> users(
            AuthedUser u,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) Boolean disabled) {
        admin(u);
        String needle = q == null ? "" : q.toLowerCase(Locale.ROOT);
        return store.all("users").stream()
                .map(
                        s -> {
                            Map<String, Object> x = FirestoreStore.data(s);
                            x.put("email", s.getId());
                            List<Map<String, Object>> ws = new ArrayList<>();
                            for (DocumentSnapshot m :
                                    store.equal("memberships", "userEmail", s.getId())) {
                                Map<String, Object> w =
                                        store.get("workspaces", m.getString("workspaceId"))
                                                .orElse(Map.of());
                                ws.add(
                                        Map.of(
                                                "name",
                                                w.getOrDefault("name", ""),
                                                "role",
                                                m.getString("role"),
                                                "status",
                                                m.getString("status")));
                            }
                            x.put("workspaces", ws);
                            return x;
                        })
                .filter(
                        x ->
                                needle.isBlank()
                                        || String.valueOf(x.get("email"))
                                                .toLowerCase(Locale.ROOT)
                                                .contains(needle)
                                        || String.valueOf(x.get("name"))
                                                .toLowerCase(Locale.ROOT)
                                                .contains(needle))
                .filter(x -> role == null || role.equals(x.get("role")))
                .filter(x -> disabled == null || disabled.equals(x.get("disabled")))
                .limit(2000)
                .toList();
    }

    /** Synchronizes the directory snapshot into user records. */
    @PostMapping("/users/sync")
    IdentityService.SyncResult sync(AuthedUser u) {
        admin(u);
        return identity.syncDirectory(u.email());
    }

    /** Refreshes one user's profile from the organization directory. */
    @PostMapping("/users/{email}/refresh")
    Map<String, Object> refresh(AuthedUser u, @PathVariable String email) {
        admin(u);
        String e = email.toLowerCase(Locale.ROOT), status = identity.refreshFromDirectory(e);
        audit.log(u.email(), "user.refresh", e, null, Map.of("directoryStatus", status));
        return Map.of("email", e, "directoryStatus", status);
    }

    record UserPatch(
            @Pattern(regexp = "member|workspace_manager|admin") String role, Boolean disabled) {}

    /** Changes a user's global role or sign-in status. */
    @PatchMapping("/users/{email}")
    Map<String, Object> patchUser(
            AuthedUser u, @PathVariable String email, @Valid @RequestBody UserPatch p) {
        admin(u);
        String e = email.toLowerCase(Locale.ROOT);
        Map<String, Object> current =
                store.get("users", e).orElseThrow(() -> ApiException.notFound("User not found."));
        if (e.equalsIgnoreCase(props.adminEmail()))
            throw ApiException.conflict(
                    "protected", "The domain admin account cannot be changed here.");
        if (e.equals(u.email())
                && ((p.disabled() != null && p.disabled())
                        || (p.role() != null && !p.role().equals("admin"))))
            throw ApiException.conflict(
                    "self_change", "You cannot disable or lower your own account.");
        return store.transaction(
                tx -> {
                    if (p.role() != null
                            && p.role().equals("member")
                            && !"member".equals(current.get("role"))) {
                        List<String> blocked = new ArrayList<>();
                        for (WorkspaceStore.Workspace workspace : workspaceStore.managedBy(e)) {
                            if ("active".equals(workspace.status())
                                    && workspace.managerEmails().size() == 1) {
                                blocked.add(workspace.name());
                            }
                        }
                        if (!blocked.isEmpty())
                            throw ApiException.conflict(
                                    "still_managing",
                                    "Still the only manager of: " + String.join(", ", blocked));
                        for (WorkspaceStore.Workspace workspace : workspaceStore.managedBy(e)) {
                            String wid = workspace.id();
                            memberships.demoteToMember(tx, wid + "_" + e);
                            List<String> managers = new ArrayList<>(workspace.managerEmails());
                            managers.remove(e);
                            workspaceStore.updateManagerEmails(tx, wid, managers);
                        }
                    }
                    if (p.role() != null) {
                        users.updateRole(tx, e, p.role());
                        audit.log(
                                tx,
                                u.email(),
                                "user.role",
                                e,
                                null,
                                Map.of("from", current.get("role"), "to", p.role()));
                    }
                    if (p.disabled() != null) {
                        users.setDisabled(tx, e, p.disabled(), u.email());
                        audit.log(
                                tx,
                                u.email(),
                                p.disabled() ? "user.disable" : "user.enable",
                                e,
                                null,
                                Map.of());
                    }
                    Map<String, Object> out = new HashMap<>();
                    out.put("email", e);
                    out.put("role", p.role() == null ? current.get("role") : p.role());
                    out.put(
                            "disabled",
                            p.disabled() == null
                                    ? current.getOrDefault("disabled", false)
                                    : p.disabled());
                    return out;
                });
    }

    record TypeBody(
            @NotBlank @Pattern(regexp = "[a-z][a-z0-9_-]{1,30}") String code,
            @NotBlank @Size(max = 60) String name,
            @Size(max = 300) String description) {}

    /** Adds a workspace type. */
    @PostMapping("/workspace-types")
    ResponseEntity<TypeBody> type(AuthedUser u, @Valid @RequestBody TypeBody b) {
        admin(u);
        store.transaction(
                tx -> {
                    if (workspaceStore.typeExists(tx, b.code()))
                        throw ApiException.conflict("duplicate", "Type already exists.");
                    workspaceStore.createType(
                            tx,
                            new WorkspaceStore.WorkspaceType(b.code(), b.name(), b.description()));
                    audit.log(
                            tx,
                            u.email(),
                            "workspace_type.create",
                            b.code(),
                            null,
                            Map.of("name", b.name()));
                    return null;
                });
        return ResponseEntity.status(201).body(b);
    }

    /** Lists all workspaces for the admin console. */
    @GetMapping("/workspaces")
    List<Map<String, Object>> workspaceList(AuthedUser u) {
        admin(u);
        return workspaceStore.all().stream().map(workspaceStore::asMap).toList();
    }

    record WorkspaceCreate(
            @NotBlank @Size(max = 120) String name,
            @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9-]{1,48}") String slug,
            @NotBlank String type,
            @Size(max = 1000) String description,
            List<@Email String> managers) {}

    /** Creates a workspace and assigns its initial managers. */
    @PostMapping("/workspaces")
    ResponseEntity<Map<String, Object>> create(
            AuthedUser u, @Valid @RequestBody WorkspaceCreate b) {
        admin(u);
        List<String> managers =
                b.managers() == null || b.managers().isEmpty()
                        ? List.of(u.email())
                        : b.managers().stream()
                                .map(x -> x.toLowerCase(Locale.ROOT))
                                .distinct()
                                .toList();
        String wid =
                workspaces.create(
                        u, b.name(), b.slug(), b.type(), b.description(), managers.get(0));
        for (int i = 1; i < managers.size(); i++) addManagerInternal(u, wid, managers.get(i));
        return ResponseEntity.status(201)
                .body(
                        Map.of(
                                "id",
                                wid,
                                "slug",
                                b.slug(),
                                "name",
                                b.name(),
                                "type",
                                b.type(),
                                "managers",
                                managers));
    }

    record WorkspacePatch(
            @Size(min = 1, max = 120) String name,
            @Size(max = 1000) String description,
            String type,
            @Pattern(regexp = "active|archived") String status) {}

    /** Updates workspace metadata or active status. */
    @PatchMapping("/workspaces/{id}")
    Map<String, Object> patchWorkspace(
            AuthedUser u, @PathVariable String id, @RequestBody WorkspacePatch b) {
        admin(u);
        if (workspaceStore.find(id).isEmpty()) throw ApiException.notFound("Workspace not found.");
        Map<String, Object> d = new HashMap<>();
        if (b.name() != null) d.put("name", b.name());
        if (b.description() != null) d.put("description", b.description());
        if (b.type() != null) {
            if (!workspaceStore.types().stream().anyMatch(type -> type.code().equals(b.type())))
                throw ApiException.unprocessable("unknown_type", "Unknown type.");
            d.put("type", b.type());
        }
        if (b.status() != null) d.put("status", b.status());
        if (d.isEmpty()) return Map.of("id", id);
        workspaceStore.updateMetadata(id, b.name(), b.description(), b.type(), b.status());
        audit.log(u.email(), "workspace.update", id, id, d);
        d.put("id", id);
        return d;
    }

    record ManagerBody(@NotBlank @Email String email) {}

    /** Assigns a workspace manager, promoting members when needed. */
    @PostMapping("/workspaces/{id}/managers")
    ResponseEntity<Map<String, Object>> addManager(
            AuthedUser u, @PathVariable String id, @Valid @RequestBody ManagerBody b) {
        admin(u);
        boolean promoted = addManagerInternal(u, id, b.email().toLowerCase(Locale.ROOT));
        return ResponseEntity.status(201)
                .body(
                        Map.of(
                                "workspaceId",
                                id,
                                "email",
                                b.email().toLowerCase(Locale.ROOT),
                                "role",
                                "manager",
                                "promoted",
                                promoted));
    }

    private boolean addManagerInternal(AuthedUser u, String wid, String e) {
        if (!identity.isOrgEmail(e))
            throw ApiException.unprocessable("wrong_domain", "Only addresses of the org domain.");
        if (users.find(e).isEmpty()) identity.refreshFromDirectory(e);
        return store.transaction(
                tx -> {
                    UserStore.User user = users.find(tx, e).orElse(null);
                    if (user != null && user.disabled())
                        throw ApiException.conflict("inactive_user", e + " is disabled.");
                    boolean promoted =
                            user == null || user.role() == null || "member".equals(user.role());
                    WorkspaceStore.Workspace workspace =
                            workspaceStore
                                    .find(tx, wid)
                                    .orElseThrow(
                                            () -> ApiException.notFound("Workspace not found."));
                    MembershipStore.Membership old =
                            memberships.find(tx, wid + "_" + e).orElse(null);
                    if (promoted) {
                        users.promoteToWorkspaceManager(tx, e);
                        audit.log(
                                tx,
                                u.email(),
                                "user.role",
                                e,
                                null,
                                Map.of(
                                        "from",
                                        "member",
                                        "to",
                                        "workspace_manager",
                                        "reason",
                                        "assigned_manager"));
                    }
                    List<String> managers = new ArrayList<>(workspace.managerEmails());
                    if (!managers.contains(e)) managers.add(e);
                    workspaceStore.updateManagerEmails(tx, wid, managers);
                    Long memberCount =
                            old == null || !"approved".equals(old.status())
                                    ? workspace.memberCount() + 1
                                    : null;
                    Long pendingCount =
                            old != null && "pending".equals(old.status())
                                    ? Math.max(0, workspace.pendingCount() - 1)
                                    : null;
                    if (memberCount != null || pendingCount != null)
                        workspaceStore.updateCounts(tx, wid, memberCount, pendingCount);
                    memberships.assignManager(tx, wid, e, u.email(), Timestamp.now());
                    audit.log(
                            tx,
                            u.email(),
                            "workspace.manager",
                            e,
                            wid,
                            Map.of("promoted", promoted));
                    return promoted;
                });
    }

    record RequestDecision(
            @Size(max = 500) String note,
            String name,
            String slug,
            String type,
            String description) {}

    /** Lists workspace creation requests by status. */
    @GetMapping("/workspace-requests")
    List<Map<String, Object>> requests(
            AuthedUser u, @RequestParam(defaultValue = "pending") String status) {
        admin(u);
        return workspaceRequests.byStatus(status).stream()
                .map(
                        request -> {
                            Map<String, Object> d = workspaceRequests.asMap(request);
                            Map<String, Object> x =
                                    store.get("users", request.requester()).orElse(Map.of());
                            d.put("requesterName", x.get("name"));
                            d.put("department", x.get("department"));
                            d.put("role", x.get("role"));
                            return d;
                        })
                .toList();
    }

    /** Approves a request and creates its workspace atomically. */
    @PostMapping("/workspace-requests/{id}/approve")
    Map<String, Object> approve(
            AuthedUser u,
            @PathVariable String id,
            @RequestBody(required = false) RequestDecision b) {
        admin(u);
        return store.transaction(
                tx -> {
                    WorkspaceRequestStore.WorkspaceRequest request =
                            workspaceRequests
                                    .find(tx, id)
                                    .orElseThrow(() -> ApiException.notFound("Request not found."));
                    if (!"pending".equals(request.status()))
                        throw ApiException.conflict("not_pending", "Request is not pending.");
                    String email = request.requester();
                    UserStore.User user = users.find(tx, email).orElse(null);
                    if (user != null && user.disabled())
                        throw ApiException.conflict("inactive_user", "Requester is disabled.");
                    String name = b != null && b.name() != null ? b.name() : request.name(),
                            slug = b != null && b.slug() != null ? b.slug() : request.slug(),
                            type = b != null && b.type() != null ? b.type() : request.type(),
                            desc =
                                    b != null && b.description() != null
                                            ? b.description()
                                            : request.description();
                    String wid = workspaces.create(tx, u, name, slug, type, desc, email);
                    workspaceRequests.decide(
                            tx,
                            id,
                            "approved",
                            u.email(),
                            Timestamp.now(),
                            b == null || b.note() == null ? "" : b.note(),
                            wid);
                    users.clearPendingWorkspaceRequest(tx, email);
                    audit.log(tx, u.email(), "workspace_request.approve", id, wid, Map.of());
                    return Map.of("requestId", id, "workspaceId", wid, "status", "approved");
                });
    }

    /** Rejects a pending workspace creation request. */
    @PostMapping("/workspace-requests/{id}/reject")
    Map<String, Object> reject(
            AuthedUser u,
            @PathVariable String id,
            @RequestBody(required = false) RequestDecision b) {
        admin(u);
        store.transaction(
                tx -> {
                    WorkspaceRequestStore.WorkspaceRequest request =
                            workspaceRequests
                                    .find(tx, id)
                                    .orElseThrow(
                                            () ->
                                                    ApiException.conflict(
                                                            "not_pending",
                                                            "Request is not pending."));
                    if (!"pending".equals(request.status()))
                        throw ApiException.conflict("not_pending", "Request is not pending.");
                    workspaceRequests.decide(
                            tx,
                            id,
                            "rejected",
                            u.email(),
                            Timestamp.now(),
                            b == null || b.note() == null ? "" : b.note(),
                            null);
                    users.clearPendingWorkspaceRequest(tx, request.requester());
                    audit.log(tx, u.email(), "workspace_request.reject", id, null, Map.of());
                    return null;
                });
        return Map.of("requestId", id, "status", "rejected");
    }

    /** Lists recent audit events across the module. */
    @GetMapping("/audit")
    List<Map<String, Object>> auditRows(
            AuthedUser u, @RequestParam(defaultValue = "200") int limit) {
        admin(u);
        return store.all("auditLog").stream()
                .sorted(
                        Comparator.comparing(
                                s -> s.getTimestamp("at"),
                                Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(Math.min(limit, 1000))
                .map(FirestoreStore::data)
                .toList();
    }
}
