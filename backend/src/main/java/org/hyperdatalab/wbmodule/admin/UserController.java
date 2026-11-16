package org.hyperdatalab.wbmodule.admin;

import com.google.cloud.firestore.DocumentSnapshot;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.hyperdatalab.wbmodule.common.Locations;
import org.hyperdatalab.wbmodule.common.Paging;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.UserStore;
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
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** User accounts and their link to the organization directory (administrators only). */
@RestController
@RequestMapping(Locations.API)
public class UserController {
    private final FirestoreStore store;
    private final IdentityService identity;
    private final AuditService audit;
    private final AppProperties props;
    private final UserStore users;
    private final WorkspaceStore workspaceStore;
    private final MembershipStore memberships;

    public UserController(
            FirestoreStore s,
            IdentityService i,
            AuditService a,
            AppProperties p,
            UserStore users,
            WorkspaceStore workspaceStore,
            MembershipStore memberships) {
        store = s;
        identity = i;
        audit = a;
        props = p;
        this.users = users;
        this.workspaceStore = workspaceStore;
        this.memberships = memberships;
    }

    private static void admin(AuthedUser u) {
        if (!u.admin()) throw ApiException.forbidden("admin_only", "Administrators only.");
    }

    /** Lists users with optional role, disabled-state and text filters. */
    @GetMapping("/users")
    ResponseEntity<List<Map<String, Object>>> list(
            AuthedUser u,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) Boolean disabled,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset) {
        admin(u);
        String needle = q == null ? "" : q.toLowerCase(Locale.ROOT);
        return Paging.page(
                store.all("users").stream()
                        .map(
                                s -> {
                                    Map<String, Object> x = FirestoreStore.data(s);
                                    x.put("email", s.getId());
                                    x.put(
                                            "protected",
                                            s.getId().equalsIgnoreCase(props.adminEmail()));
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
                        .toList(),
                limit,
                offset);
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

    /** Runs a synchronization of the directory snapshot into the user records. */
    @PostMapping("/directory-syncs")
    IdentityService.SyncResult sync(AuthedUser u) {
        admin(u);
        return identity.syncDirectory(u.email());
    }

    /** Refreshes one user's profile from the organization directory. */
    @PostMapping("/users/{email}/directory-refreshes")
    Map<String, Object> refresh(AuthedUser u, @PathVariable String email) {
        admin(u);
        String e = email.toLowerCase(Locale.ROOT), status = identity.refreshFromDirectory(e);
        audit.log(u.email(), "user.refresh", e, null, Map.of("directoryStatus", status));
        return Map.of("email", e, "directoryStatus", status);
    }
}
