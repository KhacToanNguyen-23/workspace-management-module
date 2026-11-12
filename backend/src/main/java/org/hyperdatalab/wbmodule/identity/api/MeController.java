package org.hyperdatalab.wbmodule.identity.api;

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
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.WorkspaceRequestStore;
import org.hyperdatalab.wbmodule.store.WorkspaceStore;
import org.hyperdatalab.wbmodule.workspace.WorkspaceService;
import org.hyperdatalab.wbmodule.workspace.WorkspaceViews;
import org.hyperdatalab.wbmodule.workspace.WorkspaceService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** The current user, the workspace catalogue and workspace types. */
@RestController
@RequestMapping(Locations.API)
public class MeController {
    private final FirestoreStore store;
    private final WorkspaceService workspaces;
    private final AuditService audit;
    private final MembershipStore memberships;
    private final WorkspaceStore workspaceStore;
    private final WorkspaceRequestStore workspaceRequests;

    public MeController(
            FirestoreStore s,
            WorkspaceService w,
            AuditService a,
            MembershipStore memberships,
            WorkspaceStore workspaceStore,
            WorkspaceRequestStore workspaceRequests) {
        store = s;
        workspaces = w;
        audit = a;
        this.memberships = memberships;
        this.workspaceStore = workspaceStore;
        this.workspaceRequests = workspaceRequests;
    }

    /** Returns the current user, memberships and latest workspace request. */
    @GetMapping("/me")
    Map<String, Object> me(AuthedUser u) {
        Map<String, Object> user =
                FirestoreStore.jsonData(store.get("users", u.email()).orElse(Map.of()));
        user.put("role", u.role());
        user.put("isAdmin", u.admin());
        List<Map<String, Object>> list = new ArrayList<>();
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
                    .ifPresent(
                            workspace ->
                                    data.put(
                                            "workspace",
                                            WorkspaceViews.of(
                                                    workspaceStore, workspace, null, false)));
            data.put(
                    "canManage",
                    "approved".equals(membership.status())
                            && (u.admin() || "manager".equals(membership.role())));
            list.add(FirestoreStore.jsonData(data));
        }
        list.sort(
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
        out.put("memberships", list);
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

    record TypeBody(
            @NotBlank @Pattern(regexp = "[a-z][a-z0-9_-]{1,30}") String code,
            @NotBlank @Size(max = 60) String name,
            @Size(max = 300) String description) {}

    /** Adds a workspace type (administrators only). */
    @PostMapping("/workspace-types")
    ResponseEntity<TypeBody> createType(AuthedUser u, @Valid @RequestBody TypeBody b) {
        if (!u.admin()) throw ApiException.forbidden("admin_only", "Administrators only.");
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
        return ResponseEntity.created(Locations.of("/workspace-types")).body(b);
    }

    /**
     * Lists workspaces with the caller's membership state. Everyone sees the active ones;
     * administrators can also ask for {@code status=archived} or {@code status=all}.
     */
    @GetMapping("/workspaces")
    ResponseEntity<List<Map<String, Object>>> listWorkspaces(
            AuthedUser u,
            @RequestParam(defaultValue = "active") String status,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset) {
        if (!List.of("active", "archived", "all").contains(status))
            throw ApiException.unprocessable(
                    "validation", "status must be active, archived or all.");
        if (!status.equals("active") && !u.admin())
            throw ApiException.forbidden("admin_only", "Administrators only.");
        Map<String, MembershipStore.Membership> mine =
                memberships.byUser(u.email()).stream()
                        .collect(
                                Collectors.toMap(
                                        MembershipStore.Membership::workspaceId,
                                        Function.identity(),
                                        (a, b) -> a));
        List<Map<String, Object>> out = new ArrayList<>();
        for (WorkspaceStore.Workspace workspace : workspaceStore.all()) {
            if (!status.equals("all") && !status.equals(workspace.status())) continue;
            MembershipStore.Membership m = mine.get(workspace.id());
            boolean managing =
                    m != null && "approved".equals(m.status()) && "manager".equals(m.role());
            out.add(WorkspaceViews.of(workspaceStore, workspace, m, u.admin() || managing));
        }
        out.sort(Comparator.comparing(x -> String.valueOf(x.get("name"))));
        return Paging.page(out, limit, offset);
    }

    record WorkspaceCreate(
            @NotBlank @Size(max = 120) String name,
            @NotBlank String type,
            @Size(max = 1000) String description,
            List<@Email String> managers) {}

    /**
     * Creates a workspace. Workspace managers become its manager; administrators may list the
     * initial managers (they manage it themselves when the list is empty).
     */
    @PostMapping("/workspaces")
    ResponseEntity<Map<String, Object>> createWorkspace(
            AuthedUser u, @Valid @RequestBody WorkspaceCreate b) {
        if (!u.workspaceManager())
            throw ApiException.forbidden("manager_only", "Workspace managers only.");
        boolean listed = b.managers() != null && !b.managers().isEmpty();
        if (listed && !u.admin())
            throw ApiException.forbidden("admin_only", "Only an admin can choose the managers.");
        List<String> managers =
                listed
                        ? b.managers().stream()
                                .map(x -> x.toLowerCase(Locale.ROOT))
                                .distinct()
                                .toList()
                        : List.of(u.email());
        String id = workspaces.create(u, b.name(), b.type(), b.description(), managers.get(0));
        for (int i = 1; i < managers.size(); i++) workspaces.addManager(u, id, managers.get(i));
        return ResponseEntity.created(Locations.of("/workspaces/{id}", id))
                .body(
                        Map.of(
                                "id",
                                id,
                                "name",
                                b.name(),
                                "type",
                                b.type(),
                                "managers",
                                managers));
    }
}
