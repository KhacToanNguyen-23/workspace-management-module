package org.hyperdatalab.wbmodule.workspace;

import com.google.cloud.Timestamp;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.Locations;
import org.hyperdatalab.wbmodule.common.Paging;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.store.UserStore;
import org.hyperdatalab.wbmodule.store.WorkspaceRequestStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Requests to create a workspace. Members send and follow their own; administrators see all of
 * them and decide.
 */
@RestController
@RequestMapping(Locations.API + "/workspace-requests")
public class WorkspaceRequestController {
    private final FirestoreStore firestore;
    private final UserStore users;
    private final WorkspaceRequestStore requests;
    private final AuditService audit;
    private final WorkspaceService workspaces;

    public WorkspaceRequestController(
            FirestoreStore firestore,
            UserStore users,
            WorkspaceRequestStore requests,
            AuditService audit,
            WorkspaceService workspaces) {
        this.firestore = firestore;
        this.users = users;
        this.requests = requests;
        this.audit = audit;
        this.workspaces = workspaces;
    }

    record Body(
            @NotBlank @Size(max = 120) String name,
            @NotBlank String type,
            @Size(max = 1000) String description,
            @Size(max = 1000) String reason) {}

    /** Creates a request if its requester has no other pending request. */
    @PostMapping
    ResponseEntity<Map<String, Object>> create(AuthedUser user, @Valid @RequestBody Body body) {
        // Id and Location are made here: the transaction callback runs without the request.
        String id = firestore.firestore().collection("workspaceRequests").document().getId();
        URI location = Locations.of("/workspace-requests/{id}", id);
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

                    Timestamp now = Timestamp.now();
                    WorkspaceRequestStore.WorkspaceRequest request =
                            new WorkspaceRequestStore.WorkspaceRequest(
                                    id,
                                    user.email(),
                                    body.name().trim(),
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
                            Map.of("name", body.name().trim()));
                    return ResponseEntity.created(location)
                            .body(Map.of("id", id, "status", "pending"));
                });
    }

    private Map<String, Object> view(WorkspaceRequestStore.WorkspaceRequest request, boolean admin) {
        Map<String, Object> d = requests.asMap(request);
        if (admin) {
            Map<String, Object> x = firestore.get("users", request.requester()).orElse(Map.of());
            d.put("requesterName", x.get("name"));
            d.put("department", x.get("department"));
            d.put("role", x.get("role"));
        }
        return d;
    }

    /**
     * Lists requests, newest first. Administrators see everyone's (narrow with {@code status}, or
     * {@code requester=me}); everybody else sees only their own.
     */
    @GetMapping
    ResponseEntity<List<Map<String, Object>>> list(
            AuthedUser user,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String requester,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset) {
        if (requester != null && !requester.equals("me"))
            throw ApiException.unprocessable("validation", "requester must be \"me\".");
        boolean own = !user.admin() || "me".equals(requester);
        List<WorkspaceRequestStore.WorkspaceRequest> source =
                own
                        ? requests.byRequester(user.email())
                        : firestore.all("workspaceRequests").stream().map(requests::from).toList();
        return Paging.page(
                source.stream()
                        .filter(request -> status == null || status.equals(request.status()))
                        .sorted(
                                Comparator.comparing(
                                        WorkspaceRequestStore.WorkspaceRequest::requestedAt,
                                        Comparator.nullsLast(Comparator.reverseOrder())))
                        .map(request -> view(request, !own))
                        .toList(),
                limit,
                offset);
    }

    private WorkspaceRequestStore.WorkspaceRequest visible(AuthedUser user, String id) {
        var snapshot = FirestoreStore.await(firestore.doc("workspaceRequests", id).get());
        if (!snapshot.exists()) throw ApiException.notFound("Request not found.");
        WorkspaceRequestStore.WorkspaceRequest request = requests.from(snapshot);
        if (!user.admin() && !user.email().equals(request.requester()))
            throw ApiException.notFound("Request not found.");
        return request;
    }

    /** Returns one request (administrators, or its requester). */
    @GetMapping("/{id}")
    Map<String, Object> get(AuthedUser user, @PathVariable String id) {
        return view(visible(user, id), user.admin());
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

    record Decision(
            @NotBlank @Pattern(regexp = "approved|rejected") String status,
            @Size(max = 500) String note,
            String name,
            String type,
            String description) {}

    /**
     * Approves (creating the workspace in the same transaction, optionally with edited name, type
     * and description) or rejects a pending request. Administrators only.
     */
    @PatchMapping("/{id}")
    Map<String, Object> decide(
            AuthedUser u, @PathVariable String id, @Valid @RequestBody Decision b) {
        if (!u.admin()) throw ApiException.forbidden("admin_only", "Administrators only.");
        String note = b.note() == null ? "" : b.note();
        return firestore.transaction(
                tx -> {
                    WorkspaceRequestStore.WorkspaceRequest request =
                            requests.find(tx, id)
                                    .orElseThrow(() -> ApiException.notFound("Request not found."));
                    if (!"pending".equals(request.status()))
                        throw ApiException.conflict("not_pending", "Request is not pending.");
                    String email = request.requester();
                    if (b.status().equals("rejected")) {
                        requests.decide(tx, id, "rejected", u.email(), Timestamp.now(), note, null);
                        users.clearPendingWorkspaceRequest(tx, email);
                        audit.log(tx, u.email(), "workspace_request.reject", id, null, Map.of());
                        return Map.of("id", id, "status", "rejected");
                    }
                    UserStore.User user = users.find(tx, email).orElse(null);
                    if (user != null && user.disabled())
                        throw ApiException.conflict("inactive_user", "Requester is disabled.");
                    String name = b.name() != null ? b.name() : request.name(),
                            type = b.type() != null ? b.type() : request.type(),
                            desc = b.description() != null ? b.description() : request.description();
                    String wid = workspaces.create(tx, u, name, type, desc, email);
                    requests.decide(tx, id, "approved", u.email(), Timestamp.now(), note, wid);
                    users.clearPendingWorkspaceRequest(tx, email);
                    audit.log(tx, u.email(), "workspace_request.approve", id, wid, Map.of());
                    return Map.of("id", id, "workspaceId", wid, "status", "approved");
                });
    }
}
