package org.hyperdatalab.wbmodule.workspace;

import com.google.cloud.Timestamp;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.directory.UserDirectory;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.WorkspaceStore;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
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
import java.util.Set;

/** Membership, people and audit endpoints scoped to a single workspace. */
@RestController
@RequestMapping("/api/w/{wid}")
public class WorkspaceController {
    private final FirestoreStore store;
    private final AccessService access;
    private final AuditService audit;
    private final IdentityService identity;
    private final UserDirectory directory;
    private final MembershipStore memberships;
    private final WorkspaceStore workspaces;

    public WorkspaceController(
            FirestoreStore s,
            AccessService a,
            AuditService au,
            IdentityService i,
            UserDirectory d,
            com.fasterxml.jackson.databind.ObjectMapper j,
            MembershipStore memberships,
            WorkspaceStore workspaces) {
        store = s;
        access = a;
        audit = au;
        identity = i;
        directory = d;
        this.memberships = memberships;
        this.workspaces = workspaces;
    }

    /** Returns workspace details and the caller's workspace role. */
    @GetMapping
    Map<String, Object> info(AuthedUser u, @PathVariable String wid) {
        var a = access.load(u, wid);
        return Map.of(
                "workspace",
                a.workspace(),
                "role",
                a.role() == null ? "" : a.role(),
                "canManage",
                a.canManage());
    }

    /** Lists workspace memberships for managers. */
    @GetMapping("/members")
    List<Map<String, Object>> members(
            AuthedUser u, @PathVariable String wid, @RequestParam(required = false) String status) {
        access.load(u, wid).requireManager();
        return memberships.byWorkspace(wid).stream()
                .map(
                        membership -> {
                            Map<String, Object> d = memberships.asMap(membership);
                            store.get("users", membership.userEmail())
                                    .ifPresent(
                                            x -> {
                                                d.put("name", x.get("name"));
                                                d.put("department", x.get("department"));
                                                d.put("directoryStatus", x.get("directoryStatus"));
                                            });
                            return d;
                        })
                .filter(entry -> status == null || status.equals(entry.get("status")))
                .sorted(
                        Comparator.comparing(
                                entry -> "pending".equals(entry.get("status")) ? 0 : 1))
                .toList();
    }

    /** Lists approved members visible to workspace participants. */
    @GetMapping("/people")
    List<Map<String, Object>> people(AuthedUser u, @PathVariable String wid) {
        access.load(u, wid);
        return memberships.byWorkspace(wid).stream()
                .filter(membership -> "approved".equals(membership.status()))
                .map(
                        membership -> {
                            Map<String, Object> d =
                                    FirestoreStore.jsonData(
                                            store.get("users", membership.userEmail())
                                                    .orElse(new HashMap<>()));
                            d.put("role", membership.role());
                            return d;
                        })
                .toList();
    }

    record Decision(@Size(max = 500) String note) {
        String n() {
            return note == null ? "" : note;
        }
    }

    private MembershipStore.Membership target(AuthedUser u, String wid, String mid) {
        access.load(u, wid).requireManager();
        MembershipStore.Membership membership =
                memberships
                        .find(mid)
                        .orElseThrow(() -> ApiException.notFound("Membership not found."));
        if (!wid.equals(membership.workspaceId()))
            throw ApiException.notFound("Membership not found.");
        if (u.email().equals(membership.userEmail()) && !u.admin())
            throw ApiException.forbidden(
                    "self_change", "Managers cannot change their own membership.");
        return membership;
    }

    /** Approves a pending member request. */
    @PostMapping("/members/{mid}/approve")
    Map<String, Object> approve(
            AuthedUser u,
            @PathVariable String wid,
            @PathVariable String mid,
            @Valid @RequestBody(required = false) Decision b) {
        return membershipDecision(u, wid, mid, "approved", b);
    }

    /** Rejects a pending member request. */
    @PostMapping("/members/{mid}/reject")
    Map<String, Object> reject(
            AuthedUser u,
            @PathVariable String wid,
            @PathVariable String mid,
            @Valid @RequestBody(required = false) Decision b) {
        return membershipDecision(u, wid, mid, "rejected", b);
    }

    private Map<String, Object> membershipDecision(
            AuthedUser u, String wid, String mid, String next, Decision b) {
        MembershipStore.Membership membership = target(u, wid, mid);
        if (!"pending".equals(membership.status()))
            throw ApiException.conflict("not_pending", "Request is not pending.");
        store.transaction(
                tx -> {
                    WorkspaceStore.Workspace workspace =
                            workspaces
                                    .find(tx, wid)
                                    .orElseThrow(
                                            () -> ApiException.notFound("Workspace not found."));
                    memberships.decideJoinRequest(
                            tx, mid, next, u.email(), Timestamp.now(), b == null ? "" : b.n());
                    Long memberCount = "approved".equals(next) ? workspace.memberCount() + 1 : null;
                    workspaces.updateCounts(
                            tx, wid, memberCount, Math.max(0, workspace.pendingCount() - 1));
                    audit.log(
                            tx,
                            u.email(),
                            "membership." + ("approved".equals(next) ? "approve" : "reject"),
                            membership.userEmail(),
                            wid,
                            Map.of("note", b == null ? "" : b.n()));
                    return null;
                });
        return Map.of("id", mid, "status", next);
    }

    /** Revokes an approved member. */
    @PostMapping("/members/{mid}/revoke")
    Map<String, Object> revoke(
            AuthedUser u,
            @PathVariable String wid,
            @PathVariable String mid,
            @RequestBody(required = false) Decision b) {
        MembershipStore.Membership membership = target(u, wid, mid);
        if (!"approved".equals(membership.status()))
            throw ApiException.conflict("not_approved", "Membership is not approved.");
        if ("manager".equals(membership.role()) && !u.admin())
            throw ApiException.forbidden("admin_only", "Only an admin can remove a manager.");
        store.transaction(
                tx -> {
                    WorkspaceStore.Workspace workspace =
                            workspaces
                                    .find(tx, wid)
                                    .orElseThrow(
                                            () -> ApiException.notFound("Workspace not found."));
                    memberships.revoke(tx, mid, u.email(), Timestamp.now(), b == null ? "" : b.n());
                    workspaces.updateCounts(
                            tx, wid, Math.max(0, workspace.memberCount() - 1), null);
                    if ("manager".equals(membership.role())) {
                        List<String> managers = new ArrayList<>(workspace.managerEmails());
                        managers.remove(membership.userEmail());
                        workspaces.updateManagerEmails(tx, wid, managers);
                    }
                    audit.log(
                            tx,
                            u.email(),
                            "membership.revoke",
                            membership.userEmail(),
                            wid,
                            Map.of());
                    return null;
                });
        return Map.of("id", mid, "status", "revoked");
    }

    record AddBody(@NotBlank @Email String email) {}

    /** Adds a member directly as approved. */
    @PostMapping("/members")
    ResponseEntity<Map<String, Object>> add(
            AuthedUser u, @PathVariable String wid, @Valid @RequestBody AddBody b) {
        access.load(u, wid).requireManager();
        String e = b.email().toLowerCase(Locale.ROOT);
        if (!identity.isOrgEmail(e))
            throw ApiException.unprocessable(
                    "wrong_domain", "Only addresses of the org domain can be added.");
        var user = identity.find(e);
        if (user.isEmpty() && !directory.mode().equals("off") && directory.find(e).isEmpty())
            throw new ApiException(
                    HttpStatus.NOT_FOUND,
                    "not_in_directory",
                    e + " is not registered under the org domain.");
        if (user.map(
                        x ->
                                x.disabled()
                                        || Set.of("missing", "suspended")
                                                .contains(x.directoryStatus()))
                .orElse(false)) throw ApiException.conflict("inactive_user", e + " is inactive.");
        String id = wid + "_" + e;
        return store.transaction(
                tx -> {
                    WorkspaceStore.Workspace workspace =
                            workspaces
                                    .find(tx, wid)
                                    .orElseThrow(
                                            () -> ApiException.notFound("Workspace not found."));
                    MembershipStore.Membership old = memberships.find(tx, id).orElse(null);
                    if (old != null && "approved".equals(old.status()))
                        throw ApiException.conflict("already_member", e + " is already a member.");
                    boolean pending = old != null && "pending".equals(old.status());
                    Timestamp now = Timestamp.now();
                    memberships.save(
                            tx,
                            new MembershipStore.Membership(
                                    id,
                                    wid,
                                    e,
                                    "member",
                                    "approved",
                                    "",
                                    now,
                                    u.email(),
                                    now,
                                    "added by manager"));
                    workspaces.updateCounts(
                            tx,
                            wid,
                            workspace.memberCount() + 1,
                            pending ? Math.max(0, workspace.pendingCount() - 1) : null);
                    audit.log(tx, u.email(), "membership.add", e, wid, Map.of());
                    return ResponseEntity.status(201)
                            .body(Map.of("id", id, "status", "approved", "role", "member"));
                });
    }

    /** Lists recent audit events for this workspace. */
    @GetMapping("/audit")
    List<Map<String, Object>> auditRows(
            AuthedUser u, @PathVariable String wid, @RequestParam(defaultValue = "100") int limit) {
        access.load(u, wid).requireManager();
        return store.equal("auditLog", "workspaceId", wid).stream()
                .sorted(
                        Comparator.comparing(
                                s -> s.getTimestamp("at"),
                                Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(Math.min(500, limit))
                .map(FirestoreStore::data)
                .toList();
    }
}
