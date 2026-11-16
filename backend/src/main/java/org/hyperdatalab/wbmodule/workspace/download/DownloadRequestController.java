package org.hyperdatalab.wbmodule.workspace.download;

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
import org.hyperdatalab.wbmodule.store.DownloadRequestStore;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.hyperdatalab.wbmodule.workspace.AccessService;
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

import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Paper download requests of one workspace (a status record only; no file is ever served). */
@RestController
@RequestMapping(Locations.API + "/workspaces/{wid}/download-requests")
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

    record Patch(
            @NotBlank @Pattern(regexp = "approved|rejected") String status,
            @Size(max = 500) String note) {}

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
        return ResponseEntity.created(
                        Locations.of("/workspaces/{wid}/download-requests/{id}", wid, id))
                .body(Map.of("id", id, "status", "pending"));
    }

    /**
     * Lists requests. Managers see all of them by default; {@code requester=me} (or being an
     * ordinary member) narrows the list to the caller's own requests.
     */
    @GetMapping
    ResponseEntity<List<Map<String, Object>>> list(
            AuthedUser user,
            @PathVariable String wid,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String requester,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset) {
        var a = access.load(user, wid);
        if (requester != null && !requester.equals("me"))
            throw ApiException.unprocessable("validation", "requester must be \"me\".");
        boolean own = !a.canManage() || "me".equals(requester);
        return Paging.page(
                requests.byWorkspace(wid).stream()
                        .filter(request -> status == null || status.equals(request.status()))
                        .filter(request -> !own || user.email().equals(request.requester()))
                        .sorted(
                                Comparator.comparing(
                                        request -> "pending".equals(request.status()) ? 0 : 1))
                        .map(requests::asMap)
                        .toList(),
                limit,
                offset);
    }

    /** Returns one request (managers, or its requester). */
    @GetMapping("/{id}")
    Map<String, Object> get(AuthedUser user, @PathVariable String wid, @PathVariable String id) {
        var a = access.load(user, wid);
        DownloadRequestStore.DownloadRequest request =
                requests.byWorkspace(wid).stream()
                        .filter(candidate -> candidate.id().equals(id))
                        .findFirst()
                        .orElseThrow(() -> ApiException.notFound("Request not found."));
        if (!a.canManage() && !user.email().equals(request.requester())) a.requireManager();
        return requests.asMap(request);
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

    /** Approves or rejects a pending request without creating a download link (managers). */
    @PatchMapping("/{id}")
    Map<String, Object> decide(
            AuthedUser user,
            @PathVariable String wid,
            @PathVariable String id,
            @Valid @RequestBody Patch body) {
        access.load(user, wid).requireManager();
        String status = body.status();
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
                            body.note() == null ? "" : body.note());
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
}
