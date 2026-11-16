package org.hyperdatalab.wbmodule.workspace;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Transaction;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.UserStore;
import org.hyperdatalab.wbmodule.store.WorkspaceStore;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Coordinates workspace creation and its manager membership. */
@Service
public class WorkspaceService {
    private final FirestoreStore firestore;
    private final WorkspaceStore workspaces;
    private final MembershipStore memberships;
    private final UserStore users;
    private final AuditService audit;
    private final IdentityService identity;

    public WorkspaceService(
            FirestoreStore firestore,
            WorkspaceStore workspaces,
            MembershipStore memberships,
            UserStore users,
            AuditService audit,
            IdentityService identity) {
        this.firestore = firestore;
        this.workspaces = workspaces;
        this.memberships = memberships;
        this.users = users;
        this.audit = audit;
        this.identity = identity;
    }

    /**
     * Makes {@code email} a manager of the workspace, promoting a plain member to
     * {@code workspace_manager} when needed.
     *
     * @return whether the global role was promoted
     */
    public boolean addManager(AuthedUser actor, String wid, String email) {
        if (!identity.isOrgEmail(email))
            throw ApiException.unprocessable("wrong_domain", "Only addresses of the org domain.");
        if (users.find(email).isEmpty()) identity.refreshFromDirectory(email);
        return firestore.transaction(
                tx -> {
                    UserStore.User user = users.find(tx, email).orElse(null);
                    if (user != null && user.disabled())
                        throw ApiException.conflict("inactive_user", email + " is disabled.");
                    boolean promoted =
                            user == null || user.role() == null || "member".equals(user.role());
                    WorkspaceStore.Workspace workspace =
                            workspaces
                                    .find(tx, wid)
                                    .orElseThrow(
                                            () -> ApiException.notFound("Workspace not found."));
                    MembershipStore.Membership old =
                            memberships.find(tx, wid + "_" + email).orElse(null);
                    if (promoted) {
                        users.promoteToWorkspaceManager(tx, email);
                        audit.log(
                                tx,
                                actor.email(),
                                "user.role",
                                email,
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
                    if (!managers.contains(email)) managers.add(email);
                    workspaces.updateManagerEmails(tx, wid, managers);
                    Long memberCount =
                            old == null || !"approved".equals(old.status())
                                    ? workspace.memberCount() + 1
                                    : null;
                    Long pendingCount =
                            old != null && "pending".equals(old.status())
                                    ? Math.max(0, workspace.pendingCount() - 1)
                                    : null;
                    if (memberCount != null || pendingCount != null)
                        workspaces.updateCounts(tx, wid, memberCount, pendingCount);
                    memberships.assignManager(tx, wid, email, actor.email(), Timestamp.now());
                    audit.log(
                            tx,
                            actor.email(),
                            "workspace.manager",
                            email,
                            wid,
                            Map.of("promoted", promoted));
                    return promoted;
                });
    }

    public String create(
            AuthedUser actor,
            String name,
            String type,
            String description,
            String managerEmail,
            List<String> members) {
        return firestore.transaction(
                transaction ->
                        create(
                                transaction,
                                actor,
                                name,
                                type,
                                description,
                                managerEmail,
                                members));
    }

    public String create(
            Transaction transaction,
            AuthedUser actor,
            String name,
            String type,
            String description,
            String managerEmail) {
        return create(transaction, actor, name, type, description, managerEmail, List.of());
    }

    /**
     * Creates the workspace with {@code managerEmail} as manager and {@code members} (already
     * checked with {@link IdentityService#requireAddable}, none of them the manager) as approved
     * members.
     */
    public String create(
            Transaction transaction,
            AuthedUser actor,
            String name,
            String type,
            String description,
            String managerEmail,
            List<String> members) {
        DocumentReference typeRef = firestore.doc("workspaceTypes", type);
        DocumentReference userRef = firestore.doc("users", managerEmail);
        if (!FirestoreStore.await(transaction.get(typeRef)).exists()) {
            throw ApiException.unprocessable(
                    "unknown_type", "Unknown workspace type \"" + type + "\".");
        }

        DocumentSnapshot user = FirestoreStore.await(transaction.get(userRef));
        if (user.exists() && Boolean.TRUE.equals(user.getBoolean("disabled"))) {
            throw ApiException.conflict("inactive_user", "Manager is disabled.");
        }
        String role = user.exists() ? user.getString("role") : "member";
        if ("member".equals(role)) {
            users.promoteToWorkspaceManager(transaction, managerEmail);
            audit.log(
                    transaction,
                    actor.email(),
                    "user.role",
                    managerEmail,
                    null,
                    Map.of(
                            "from",
                            "member",
                            "to",
                            "workspace_manager",
                            "reason",
                            "assigned_manager"));
        }

        String id = firestore.firestore().collection("workspaces").document().getId();
        Timestamp now = Timestamp.now();
        workspaces.create(
                transaction,
                new WorkspaceStore.Workspace(
                        id,
                        name.trim(),
                        type,
                        description == null ? "" : description,
                        "active",
                        managerEmail,
                        now,
                        List.of(managerEmail),
                        1 + members.size(),
                        0));
        memberships.save(
                transaction,
                new MembershipStore.Membership(
                        id + "_" + managerEmail,
                        id,
                        managerEmail,
                        "manager",
                        "approved",
                        "",
                        now,
                        actor.email(),
                        now,
                        ""));
        for (String member : members) {
            memberships.save(
                    transaction,
                    new MembershipStore.Membership(
                            id + "_" + member,
                            id,
                            member,
                            "member",
                            "approved",
                            "",
                            now,
                            actor.email(),
                            now,
                            "added at creation"));
            audit.log(transaction, actor.email(), "membership.add", member, id, Map.of());
        }
        audit.log(
                transaction,
                actor.email(),
                "workspace.create",
                id,
                id,
                Map.of("name", name, "type", type));
        return id;
    }
}
