package org.hyperdatalab.wbmodule.workspace.request;

import com.google.cloud.Timestamp;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.UserStore;
import org.hyperdatalab.wbmodule.store.WorkspaceRequestStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Member-facing endpoints for workspace creation requests. */
@RestController
@RequestMapping("/api/workspace-requests")
public class WorkspaceRequestController {
    private final FirestoreStore firestore;
    private final UserStore users;
    private final WorkspaceRequestStore requests;
    private final AuditService audit;

    public WorkspaceRequestController(
            FirestoreStore firestore,
            UserStore users,
            WorkspaceRequestStore requests,
            AuditService audit) {
        this.firestore = firestore;
        this.users = users;
        this.requests = requests;
        this.audit = audit;
    }

    record Body(
            @NotBlank @Size(max = 120) String name,
            @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9-]{1,48}") String slug,
            @NotBlank String type,
            @Size(max = 1000) String description,
            @Size(max = 1000) String reason) {}

    /** Creates a request if its requester and slug have no pending conflicts. */
    @PostMapping
    ResponseEntity<Map<String, Object>> create(AuthedUser user, @Valid @RequestBody Body body) {
        return firestore.transaction(
                transaction -> {
                    UserStore.User requester =
                            users.find(transaction, user.email())
                                    .orElseThrow(() -> ApiException.notFound("User not found."));
                    if (requester.pendingWorkspaceRequestId() != null) {
                        throw ApiException.conflict(
                                "already_pending", "You already have a pending workspace request.");
                    }
                    if (!FirestoreStore.await(
                                    transaction.get(firestore.doc("workspaceTypes", body.type())))
                            .exists()) {
                        throw ApiException.unprocessable("unknown_type", "Unknown workspace type.");
                    }
                    boolean pendingSlug =
                            requests.byStatus("pending").stream()
                                    .anyMatch(request -> request.slug().equals(body.slug()));
                    if (FirestoreStore.await(
                                            transaction.get(
                                                    firestore.doc("workspaceSlugs", body.slug())))
                                    .exists()
                            || pendingSlug) {
                        throw ApiException.conflict(
                                "duplicate", "Slug is already in use or pending.");
                    }

                    String id =
                            firestore
                                    .firestore()
                                    .collection("workspaceRequests")
                                    .document()
                                    .getId();
                    Timestamp now = Timestamp.now();
                    WorkspaceRequestStore.WorkspaceRequest request =
                            new WorkspaceRequestStore.WorkspaceRequest(
                                    id,
                                    user.email(),
                                    body.name().trim(),
                                    body.slug(),
                                    body.type(),
                                    body.description(),
                                    body.reason(),
                                    "pending",
                                    now,
                                    null,
                                    null,
                                    "",
                                    null);
                    requests.create(transaction, request);
                    users.setPendingWorkspaceRequest(transaction, user.email(), id);
                    audit.log(
                            transaction,
                            user.email(),
                            "workspace_request.create",
                            id,
                            null,
                            Map.of("slug", body.slug()));
                    return ResponseEntity.status(201).body(Map.of("id", id, "status", "pending"));
                });
    }

    /** Lists only the current user's requests, newest first. */
    @GetMapping("/mine")
    List<Map<String, Object>> mine(AuthedUser user) {
        return requests.byRequester(user.email()).stream()
                .sorted(
                        Comparator.comparing(
                                WorkspaceRequestStore.WorkspaceRequest::requestedAt,
                                Comparator.nullsLast(Comparator.reverseOrder())))
                .map(requests::asMap)
                .toList();
    }

    /** Withdraws one of the current user's pending requests. */
    @DeleteMapping("/{id}")
    ResponseEntity<Void> withdraw(AuthedUser user, @PathVariable String id) {
        firestore.transaction(
                transaction -> {
                    WorkspaceRequestStore.WorkspaceRequest request =
                            requests.byRequester(user.email()).stream()
                                    .filter(candidate -> candidate.id().equals(id))
                                    .findFirst()
                                    .orElseThrow(
                                            () ->
                                                    ApiException.notFound(
                                                            "Pending request not found."));
                    if (!"pending".equals(request.status())) {
                        throw ApiException.notFound("Pending request not found.");
                    }
                    requests.withdraw(transaction, id);
                    users.clearPendingWorkspaceRequest(transaction, user.email());
                    audit.log(
                            transaction,
                            user.email(),
                            "workspace_request.withdraw",
                            id,
                            null,
                            Map.of());
                    return null;
                });
        return ResponseEntity.noContent().build();
    }
}
