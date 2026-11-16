package org.hyperdatalab.wbmodule.workspace;

import com.google.cloud.Timestamp;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.Locations;
import org.hyperdatalab.wbmodule.common.Paging;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.WorkspaceStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** One workspace: its details, its memberships and its managers. */
@RestController
@RequestMapping(Locations.API + "/workspaces/{wid}")
public class WorkspaceController {
    private final FirestoreStore store;
    private final AccessService access;
    private final AuditService audit;
    private final IdentityService identity;
    private final MembershipStore memberships;
    private final WorkspaceStore workspaces;
    private final WorkspaceService workspaceService;

    public WorkspaceController(
            FirestoreStore s,
            AccessService a,
            AuditService au,
            IdentityService i,
            MembershipStore memberships,
            WorkspaceStore workspaces,
            WorkspaceService workspaceService) {
        store = s;
        access = a;
        audit = au;
        identity = i;
        this.memberships = memberships;
        this.workspaces = workspaces;
        this.workspaceService = workspaceService;
    }

    // ---- the workspace -----------------------------------------------------------------------

    /** Returns the workspace together with the caller's role in it. */
    @GetMapping
    Map<String, Object> info(AuthedUser u, @PathVariable String wid) {
        var a = access.load(u, wid);
        WorkspaceStore.Workspace workspace =
                workspaces.find(wid).orElseThrow(() -> ApiException.notFound("Workspace not found."));
        MembershipStore.Membership mine = memberships.find(wid + "_" + u.email()).orElse(null);
        Map<String, Object> view = WorkspaceViews.of(workspaces, workspace, mine, a.canManage());
        view.put("canManage", a.canManage());
        return view;
    }

    record WorkspacePatch(
            @Size(min = 1, max = 120) String name,
            @Size(max = 1000) String description,
            String type,
            @Pattern(regexp = "active|archived") String status) {}

    /** Updates workspace metadata or its active/archived status (administrators only). */
    @PatchMapping
    Map<String, Object> patch(
            AuthedUser u, @PathVariable String wid, @Valid @RequestBody WorkspacePatch b) {
        if (!u.admin()) throw ApiException.forbidden("admin_only", "Administrators only.");
        if (workspaces.find(wid).isEmpty()) throw ApiException.notFound("Workspace not found.");
        Map<String, Object> d = new HashMap<>();
        if (b.name() != null) d.put("name", b.name());
        if (b.description() != null) d.put("description", b.description());
        if (b.type() != null) {
            if (!workspaces.types().stream().anyMatch(type -> type.code().equals(b.type())))
                throw ApiException.unprocessable("unknown_type", "Unknown type.");
            d.put("type", b.type());
        }
        if (b.status() != null) d.put("status", b.status());
        if (d.isEmpty()) return Map.of("id", wid);
        workspaces.updateMetadata(wid, b.name(), b.description(), b.type(), b.status());
        audit.log(u.email(), "workspace.update", wid, wid, d);
        d.put("id", wid);
        return d;
    }

    // ---- members -----------------------------------------------------------------------------

    private Map<String, Object> memberView(MembershipStore.Membership membership) {
        Map<String, Object> d = memberships.asMap(membership);
        store.get("users", membership.userEmail())
                .ifPresent(
                        x -> {
                            d.put("name", x.get("name"));
                            d.put("department", x.get("department"));
                            d.put("directoryStatus", x.get("directoryStatus"));
                        });
        return d;
    }

    /** What an ordinary member may see about a colleague. */
    private Map<String, Object> publicMemberView(MembershipStore.Membership membership) {
        Map<String, Object> user = store.get("users", membership.userEmail()).orElse(Map.of());
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("id", membership.id());
        d.put("email", membership.userEmail());
        d.put("name", user.get("name"));
        d.put("department", user.get("department"));
        d.put("photoUrl", user.get("photoUrl"));
        d.put("role", membership.role());
        d.put("status", membership.status());
        return d;
    }

    /**
     * Lists memberships. Managers see every membership (filter with {@code status}); ordinary
     * members see only the approved ones, with public details.
     */
    @GetMapping("/members")
    ResponseEntity<List<Map<String, Object>>> members(
            AuthedUser u,
            @PathVariable String wid,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset) {
        var a = access.load(u, wid);
        if (!a.canManage()) {
            if (status != null && !status.equals("approved")) a.requireManager();
            return Paging.page(
                    memberships.byWorkspace(wid).stream()
                            .filter(m -> "approved".equals(m.status()))
                            .map(this::publicMemberView)
                            .toList(),
                    limit,
                    offset);
        }
        return Paging.page(
                memberships.byWorkspace(wid).stream()
                        .map(this::memberView)
                        .filter(entry -> status == null || status.equals(entry.get("status")))
                        .sorted(
                                Comparator.comparing(
                                        entry -> "pending".equals(entry.get("status")) ? 0 : 1))
                        .toList(),
                limit,
                offset);
    }

    /** Returns one membership (managers, or the member themselves; {@code me} is an alias). */
    @GetMapping("/members/{mid}")
    Map<String, Object> member(AuthedUser u, @PathVariable String wid, @PathVariable String mid) {
        if (mid.equals("me")) {
            return memberships
                    .find(wid + "_" + u.email())
                    .map(this::memberView)
                    .orElseThrow(() -> ApiException.notFound("Membership not found."));
        }
        var a = access.load(u, wid);
        MembershipStore.Membership membership =
                memberships
                        .find(mid)
                        .filter(m -> wid.equals(m.workspaceId()))
                        .orElseThrow(() -> ApiException.notFound("Membership not found."));
        if (!a.canManage() && !u.email().equals(membership.userEmail())) a.requireManager();
        return memberView(membership);
    }

    record AddBody(@NotBlank @Email String email) {}

    /** Adds a member directly as approved (managers). */
    @PostMapping("/members")
    ResponseEntity<Map<String, Object>> add(
            AuthedUser u, @PathVariable String wid, @Valid @RequestBody AddBody b) {
        access.load(u, wid).requireManager();
        String e = b.email().toLowerCase(Locale.ROOT);
        identity.requireAddable(e);
        String id = wid + "_" + e;
        // Built here: the transaction callback runs on another thread, without the request.
        URI location = Locations.of("/workspaces/{wid}/members/{mid}", wid, id);
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
                    return ResponseEntity.created(location)
                            .body(Map.of("id", id, "status", "approved", "role", "member"));
                });
    }

    record MemberPatch(
            @NotBlank @Pattern(regexp = "approved|rejected|revoked") String status,
            @Size(max = 500) String note) {
        String n() {
            return note == null ? "" : note;
        }
    }

    /**
     * Moves a membership to a new state: {@code approved} or {@code rejected} for a pending join
     * request, {@code revoked} for an approved member.
     */
    @PatchMapping("/members/{mid}")
    Map<String, Object> patchMember(
            AuthedUser u,
            @PathVariable String wid,
            @PathVariable String mid,
            @Valid @RequestBody MemberPatch b) {
        return b.status().equals("revoked")
                ? revoke(u, wid, mid, b.n())
                : membershipDecision(u, wid, mid, b.status(), b.n());
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

    private Map<String, Object> membershipDecision(
            AuthedUser u, String wid, String mid, String next, String note) {
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
                    memberships.decideJoinRequest(tx, mid, next, u.email(), Timestamp.now(), note);
                    Long memberCount = "approved".equals(next) ? workspace.memberCount() + 1 : null;
                    workspaces.updateCounts(
                            tx, wid, memberCount, Math.max(0, workspace.pendingCount() - 1));
                    audit.log(
                            tx,
                            u.email(),
                            "membership." + ("approved".equals(next) ? "approve" : "reject"),
                            membership.userEmail(),
                            wid,
                            Map.of("note", note));
                    return null;
                });
        return Map.of("id", mid, "status", next);
    }

    private Map<String, Object> revoke(AuthedUser u, String wid, String mid, String note) {
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
                    memberships.revoke(tx, mid, u.email(), Timestamp.now(), note);
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

    // ---- the caller's own membership ({@code members/me}) ---------------------------------

    record JoinBody(@Size(max = 500) String note) {}

    /** Asks to join an active workspace; a manager of it approves or rejects. */
    @PutMapping("/members/me")
    ResponseEntity<Map<String, Object>> join(
            AuthedUser u,
            @PathVariable String wid,
            @Valid @RequestBody(required = false) JoinBody b) {
        String membershipId = wid + "_" + u.email();
        URI location = Locations.of("/workspaces/{wid}/members/{mid}", wid, membershipId);
        return store.transaction(
                tx -> {
                    WorkspaceStore.Workspace workspace =
                            workspaces
                                    .find(tx, wid)
                                    .orElseThrow(
                                            () -> ApiException.notFound("Workspace not found."));
                    if (!"active".equals(workspace.status()))
                        throw ApiException.notFound("Workspace not found.");
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
                                    wid,
                                    u.email(),
                                    "member",
                                    "pending",
                                    note,
                                    now,
                                    null,
                                    null,
                                    ""));
                    workspaces.updateCounts(tx, wid, null, workspace.pendingCount() + 1);
                    audit.log(
                            tx,
                            u.email(),
                            "membership.request",
                            u.email(),
                            wid,
                            Map.of("note", note));
                    return ResponseEntity.created(location)
                            .body(Map.of("id", membershipId, "status", "pending"));
                });
    }

    /** Withdraws a pending join request or leaves an approved workspace. */
    @DeleteMapping("/members/me")
    ResponseEntity<Void> leave(AuthedUser u, @PathVariable String wid) {
        return store.transaction(
                tx -> {
                    String membershipId = wid + "_" + u.email();
                    MembershipStore.Membership membership =
                            memberships.find(tx, membershipId).orElse(null);
                    WorkspaceStore.Workspace workspace =
                            workspaces
                                    .find(tx, wid)
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
                        workspaces.updateCounts(
                                tx, wid, null, Math.max(0, workspace.pendingCount() - 1));
                        audit.log(tx, u.email(), "membership.withdraw", u.email(), wid, Map.of());
                    } else {
                        workspaces.updateCounts(
                                tx, wid, Math.max(0, workspace.memberCount() - 1), null);
                        if (manager) {
                            managerEmails.remove(u.email());
                            workspaces.updateManagerEmails(tx, wid, managerEmails);
                        }
                        audit.log(tx, u.email(), "membership.leave", u.email(), wid, Map.of());
                    }
                    return ResponseEntity.noContent().build();
                });
    }

    // ---- managers ----------------------------------------------------------------------------

    record ManagerBody(@NotBlank @Email String email) {}

    /** Assigns a manager, promoting a plain member to workspace manager (administrators only). */
    @PostMapping("/managers")
    ResponseEntity<Map<String, Object>> addManager(
            AuthedUser u, @PathVariable String wid, @Valid @RequestBody ManagerBody b) {
        if (!u.admin()) throw ApiException.forbidden("admin_only", "Administrators only.");
        String email = b.email().toLowerCase(Locale.ROOT);
        boolean promoted = workspaceService.addManager(u, wid, email);
        return ResponseEntity.created(
                        Locations.of("/workspaces/{wid}/members/{mid}", wid, wid + "_" + email))
                .body(
                        Map.of(
                                "workspaceId",
                                wid,
                                "email",
                                email,
                                "role",
                                "manager",
                                "promoted",
                                promoted));
    }
}
