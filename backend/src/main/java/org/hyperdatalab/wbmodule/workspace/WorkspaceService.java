package org.hyperdatalab.wbmodule.workspace;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Transaction;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.UserStore;
import org.hyperdatalab.wbmodule.store.WorkspaceStore;
import org.springframework.stereotype.Service;

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

    public WorkspaceService(
            FirestoreStore firestore,
            WorkspaceStore workspaces,
            MembershipStore memberships,
            UserStore users,
            AuditService audit) {
        this.firestore = firestore;
        this.workspaces = workspaces;
        this.memberships = memberships;
        this.users = users;
        this.audit = audit;
    }

    public String create(
            AuthedUser actor,
            String name,
            String slug,
            String type,
            String description,
            String managerEmail) {
        return firestore.transaction(
                transaction ->
                        create(transaction, actor, name, slug, type, description, managerEmail));
    }

    public String create(
            Transaction transaction,
            AuthedUser actor,
            String name,
            String slug,
            String type,
            String description,
            String managerEmail) {
        DocumentReference typeRef = firestore.doc("workspaceTypes", type);
        DocumentReference slugRef = firestore.doc("workspaceSlugs", slug);
        DocumentReference userRef = firestore.doc("users", managerEmail);
        if (!FirestoreStore.await(transaction.get(typeRef)).exists()) {
            throw ApiException.unprocessable(
                    "unknown_type", "Unknown workspace type \"" + type + "\".");
        }
        if (FirestoreStore.await(transaction.get(slugRef)).exists()) {
            throw ApiException.conflict("duplicate", "Slug already used.");
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
                        slug,
                        name.trim(),
                        type,
                        description == null ? "" : description,
                        "active",
                        managerEmail,
                        now,
                        List.of(managerEmail),
                        1,
                        0));
        workspaces.createSlug(transaction, slug, id);
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
        audit.log(
                transaction,
                actor.email(),
                "workspace.create",
                id,
                id,
                Map.of("name", name, "slug", slug, "type", type));
        return id;
    }
}
