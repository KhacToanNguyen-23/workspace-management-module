package org.hyperdatalab.wbmodule.workspace;

import com.google.cloud.Timestamp;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.WorkspaceRequestStore;
import org.hyperdatalab.wbmodule.store.WorkspaceStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Authenticated self-service endpoints and workspace catalogue routes. */
@RestController
@RequestMapping("/api")
public class MeController {
    private final FirestoreStore store;
    private final IdentityService identity;
    private final WorkspaceService workspaces;
    private final AuditService audit;
    private final MembershipStore memberships;
    private final WorkspaceStore workspaceStore;
    private final WorkspaceRequestStore workspaceRequests;

    public MeController(
            FirestoreStore s,
            IdentityService i,
            WorkspaceService w,
            AuditService a,
            MembershipStore memberships,
            WorkspaceStore workspaceStore,
            WorkspaceRequestStore workspaceRequests) {
        store = s;
        identity = i;
        workspaces = w;
        audit = a;
        this.memberships = memberships;
        this.workspaceStore = workspaceStore;
        this.workspaceRequests = workspaceRequests;
    }

    /** Exposes a readiness endpoint without authentication. */
    @GetMapping("/health")
    Map<String, Object> health() {
        return Map.of("ok", true);
    }

    /** Returns the current user, memberships and latest workspace request. */
    @GetMapping("/me")
    Map<String, Object> me(AuthedUser u) {
        Map<String, Object> user =
                FirestoreStore.jsonData(store.get("users", u.email()).orElse(Map.of()));
        user.put("role", u.role());
        user.put("isAdmin", u.admin());
        List<Map<String, Object>> memberships = new ArrayList<>();
        for (MembershipStore.Membership membership : this.memberships.byUser(u.email())) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("id", membership.id());
            data.put("workspaceId", membership.workspaceId());
            data.put("userEmail", membership.userEmail());
            data.put("role", membership.role());
            data.put("status", membership.status());
            data.put("note", membership.note());
            data.put("requestedAt", membership.requestedAt());
            data.put("decidedBy", membership.decidedBy());
            data.put("decidedAt", membership.decidedAt());
            data.put("decisionNote", membership.decisionNote());
            workspaceStore
                    .find(membership.workspaceId())
                    .ifPresent(workspace -> data.put("workspace", workspaceStore.asMap(workspace)));
            data.put(
                    "canManage",
                    "approved".equals(membership.status())
                            && (u.admin() || "manager".equals(membership.role())));
            memberships.add(FirestoreStore.jsonData(data));
        }
        memberships.sort(
                Comparator.comparing(
                        m ->
                                String.valueOf(
                                        ((Map<?, ?>) m.getOrDefault("workspace", Map.of()))
                                                .get("name"))));
        List<WorkspaceRequestStore.WorkspaceRequest> reqs =
                new ArrayList<>(workspaceRequests.byRequester(u.email()));
        reqs.sort(
                Comparator.comparing(
                        WorkspaceRequestStore.WorkspaceRequest::requestedAt,
                        Comparator.nullsLast(Comparator.reverseOrder())));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", user);
        out.put("memberships", memberships);
        out.put("workspaceRequest", reqs.isEmpty() ? null : workspaceRequests.asMap(reqs.get(0)));
        return out;
    }

    record WorkspaceType(String code, String name, String description) {}

    /** Lists workspace types for creation forms. */
    @GetMapping("/workspace-types")
    List<WorkspaceType> types() {
        return workspaceStore.types().stream()
                .map(type -> new WorkspaceType(type.code(), type.name(), type.description()))
                .sorted(Comparator.comparing(WorkspaceType::name))
                .toList();
    }

    /** Lists active workspaces and the current user's membership state. */
    @GetMapping("/workspaces")
    List<Map<String, Object>> listWorkspaces(AuthedUser u) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (WorkspaceStore.Workspace workspace : workspaceStore.all()) {
            if (!"active".equals(workspace.status())) continue;
            Map<String, Object> w = workspaceStore.asMap(workspace);
            List<MembershipStore.Membership> mm = memberships.byWorkspace(workspace.id());
            List<String> managers =
                    mm.stream()
                            .filter(
                                    x ->
                                            "approved".equals(x.status())
                                                    && "manager".equals(x.role()))
                            .map(MembershipStore.Membership::userEmail)
                            .toList();
            w.put("managers", managers);
            for (MembershipStore.Membership membership : mm) {
                if (u.email().equals(membership.userEmail())) {
                    w.put("myStatus", membership.status());
                    w.put("myRole", membership.role());
                }
            }
            out.add(w);
        }
        out.sort(Comparator.comparing(x -> String.valueOf(x.get("name"))));
        return out;
    }

    record JoinBody(@Size(max = 500) String note) {}

    /** Requests membership in an active workspace. */
    @PostMapping("/workspaces/{id}/join")
    ResponseEntity<Map<String, Object>> join(
            AuthedUser u,
            @PathVariable String id,
            @Valid @RequestBody(required = false) JoinBody b) {
        return store.transaction(
                tx -> {
                    WorkspaceStore.Workspace workspace =
                            workspaceStore
                                    .find(tx, id)
                                    .orElseThrow(
                                            () -> ApiException.notFound("Workspace not found."));
                    if (!"active".equals(workspace.status()))
                        throw ApiException.notFound("Workspace not found.");
                    String membershipId = id + "_" + u.email();
                    MembershipStore.Membership previous =
                            memberships.find(tx, membershipId).orElse(null);
                    if (previous != null && "approved".equals(previous.status()))
                        throw ApiException.conflict("already_member", "You are already a member.");
                    if (previous != null && "pending".equals(previous.status()))
                        throw ApiException.conflict(
                                "already_pending",
                                "Your request is already waiting for a manager.");
                    Timestamp now = Timestamp.now();
                    String note = b == null || b.note() == null ? "" : b.note();
                    memberships.save(
                            tx,
                            new MembershipStore.Membership(
                                    membershipId,
                                    id,
                                    u.email(),
                                    "member",
                                    "pending",
                                    note,
                                    now,
                                    null,
                                    null,
                                    ""));
                    workspaceStore.updateCounts(tx, id, null, workspace.pendingCount() + 1);
                    audit.log(
                            tx,
                            u.email(),
                            "membership.request",
                            u.email(),
                            id,
                            Map.of("note", note));
                    return ResponseEntity.status(201)
                            .body(Map.of("id", membershipId, "status", "pending"));
                });
    }

    /** Withdraws a pending join request or leaves an approved workspace. */
    @DeleteMapping("/workspaces/{id}/join")
    ResponseEntity<Void> leave(AuthedUser u, @PathVariable String id) {
        return store.transaction(
                tx -> {
                    String membershipId = id + "_" + u.email();
                    MembershipStore.Membership membership =
                            memberships.find(tx, membershipId).orElse(null);
                    WorkspaceStore.Workspace workspace =
                            workspaceStore
                                    .find(tx, id)
                                    .orElseThrow(
                                            () -> ApiException.notFound("Nothing to withdraw."));
                    if (membership == null
                            || !List.of("pending", "approved").contains(membership.status()))
                        throw ApiException.notFound("Nothing to withdraw.");
                    boolean manager =
                            "manager".equals(membership.role())
                                    && "approved".equals(membership.status());
                    List<String> managerEmails = new ArrayList<>(workspace.managerEmails());
                    if (manager && managerEmails.size() == 1)
                        throw ApiException.conflict(
                                "last_manager",
                                "You are the last manager; ask an admin to assign another one"
                                        + " first.");
                    memberships.delete(tx, membershipId);
                    if ("pending".equals(membership.status())) {
                        workspaceStore.updateCounts(
                                tx, id, null, Math.max(0, workspace.pendingCount() - 1));
                        audit.log(tx, u.email(), "membership.withdraw", u.email(), id, Map.of());
                    } else {
                        workspaceStore.updateCounts(
                                tx, id, Math.max(0, workspace.memberCount() - 1), null);
                        if (manager) {
                            managerEmails.remove(u.email());
                            workspaceStore.updateManagerEmails(tx, id, managerEmails);
                        }
                        audit.log(tx, u.email(), "membership.leave", u.email(), id, Map.of());
                    }
                    return ResponseEntity.noContent().build();
                });
    }

    record DirectWorkspaceBody(
            @NotBlank @Size(max = 120) String name,
            @NotBlank String type,
            @Size(max = 1000) String description) {}

    /** Creates a workspace for the current workspace manager. */
    @PostMapping("/workspaces")
    ResponseEntity<Map<String, Object>> create(
            AuthedUser u, @Valid @RequestBody DirectWorkspaceBody b) {
        if (!u.workspaceManager())
            throw ApiException.forbidden("manager_only", "Workspace managers only.");
        String id = workspaces.create(u, b.name(), b.type(), b.description(), u.email());
        return ResponseEntity.status(201)
                .body(Map.of("id", id, "name", b.name(), "type", b.type()));
    }
}
