package org.hyperdatalab.wbmodule.workspace;

import com.google.cloud.Timestamp;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.store.DownloadRequestStore;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Member and manager endpoints for paper download requests. */
@RestController
@RequestMapping("/api/w/{wid}/download-requests")
public class DownloadRequestController {
    private final FirestoreStore firestore;
    private final DownloadRequestStore requests;
    private final AccessService access;
    private final AuditService audit;

    public DownloadRequestController(
            FirestoreStore firestore,
            DownloadRequestStore requests,
            AccessService access,
            AuditService audit) {
        this.firestore = firestore;
        this.requests = requests;
        this.access = access;
        this.audit = audit;
    }

    record Body(@NotBlank @Size(max = 500) String paperRef, @Size(max = 1000) String note) {}

    record Decision(@Size(max = 500) String note) {}

    /** Creates a pending request for a workspace member. */
    @PostMapping
    ResponseEntity<Map<String, Object>> create(
            AuthedUser user, @PathVariable String wid, @Valid @RequestBody Body body) {
        access.load(user, wid);
        String id = firestore.firestore().collection("downloadRequests").document().getId();
        DownloadRequestStore.DownloadRequest request =
                new DownloadRequestStore.DownloadRequest(
                        id,
                        wid,
                        user.email(),
                        user.name(),
                        body.paperRef(),
                        body.note(),
                        "pending",
                        Timestamp.now(),
                        null,
                        null,
                        "");
        firestore.transaction(
                transaction -> {
                    requests.create(transaction, request);
                    audit.log(
                            transaction,
                            user.email(),
                            "download_request.create",
                            id,
                            wid,
                            Map.of("paperRef", body.paperRef()));
                    return null;
                });
        return ResponseEntity.status(201).body(Map.of("id", id, "status", "pending"));
    }

    /** Lists all requests for managers; members can list only their own requests. */
    @GetMapping
    List<Map<String, Object>> list(
            AuthedUser user,
            @PathVariable String wid,
            @RequestParam(required = false) String status) {
        access.load(user, wid).requireManager();
        return requests.byWorkspace(wid).stream()
                .filter(request -> status == null || status.equals(request.status()))
                .sorted(Comparator.comparing(request -> "pending".equals(request.status()) ? 0 : 1))
                .map(requests::asMap)
                .toList();
    }

    /** Lists the current member's requests in this workspace. */
    @GetMapping("/mine")
    List<Map<String, Object>> mine(AuthedUser user, @PathVariable String wid) {
        access.load(user, wid);
        return requests.byWorkspace(wid).stream()
                .filter(request -> user.email().equals(request.requester()))
                .map(requests::asMap)
                .toList();
    }

    /** Withdraws one of the current member's pending requests. */
    @DeleteMapping("/{id}")
    ResponseEntity<Void> withdraw(
            AuthedUser user, @PathVariable String wid, @PathVariable String id) {
        access.load(user, wid);
        firestore.transaction(
                transaction -> {
                    DownloadRequestStore.DownloadRequest request =
                            requests.find(transaction, id)
                                    .orElseThrow(
                                            () ->
                                                    ApiException.notFound(
                                                            "Pending request not found."));
                    if (!wid.equals(request.workspaceId())
                            || !user.email().equals(request.requester())
                            || !"pending".equals(request.status())) {
                        throw ApiException.notFound("Pending request not found.");
                    }
                    requests.withdraw(transaction, id);
                    audit.log(
                            transaction,
                            user.email(),
                            "download_request.withdraw",
                            id,
                            wid,
                            Map.of());
                    return null;
                });
        return ResponseEntity.noContent().build();
    }

    /** Approves or rejects a pending request without creating a download link. */
    private Map<String, Object> decide(
            AuthedUser user, String wid, String id, String status, Decision decision) {
        access.load(user, wid).requireManager();
        return firestore.transaction(
                transaction -> {
                    DownloadRequestStore.DownloadRequest request =
                            requests.find(transaction, id)
                                    .orElseThrow(() -> ApiException.notFound("Request not found."));
                    if (!wid.equals(request.workspaceId())) {
                        throw ApiException.notFound("Request not found.");
                    }
                    if (!"pending".equals(request.status())) {
                        throw ApiException.conflict("not_pending", "Request is not pending.");
                    }
                    requests.decide(
                            transaction,
                            id,
                            status,
                            user.email(),
                            Timestamp.now(),
                            decision == null || decision.note() == null ? "" : decision.note());
                    audit.log(
                            transaction,
                            user.email(),
                            "download_request." + status,
                            id,
                            wid,
                            Map.of());
                    return Map.of("id", id, "status", status);
                });
    }

    /** Approves a pending request. */
    @PostMapping("/{id}/approve")
    Map<String, Object> approve(
            AuthedUser user,
            @PathVariable String wid,
            @PathVariable String id,
            @RequestBody(required = false) Decision decision) {
        return decide(user, wid, id, "approved", decision);
    }

    /** Rejects a pending request. */
    @PostMapping("/{id}/reject")
    Map<String, Object> reject(
            AuthedUser user,
            @PathVariable String wid,
            @PathVariable String id,
            @RequestBody(required = false) Decision decision) {
        return decide(user, wid, id, "rejected", decision);
    }
}
