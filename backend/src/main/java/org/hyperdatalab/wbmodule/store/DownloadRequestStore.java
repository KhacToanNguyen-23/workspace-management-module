package org.hyperdatalab.wbmodule.store;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Transaction;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Reads and writes paper download request records. */
@Component
public class DownloadRequestStore {
    public record DownloadRequest(
            String id,
            String workspaceId,
            String requester,
            String requesterName,
            String paperRef,
            String note,
            String status,
            Timestamp requestedAt,
            String decidedBy,
            Timestamp decidedAt,
            String decisionNote) {}

    private final FirestoreStore firestore;

    public DownloadRequestStore(FirestoreStore firestore) {
        this.firestore = firestore;
    }

    public Optional<DownloadRequest> find(Transaction transaction, String id) {
        DocumentSnapshot snapshot =
                FirestoreStore.await(transaction.get(firestore.doc("downloadRequests", id)));
        return snapshot.exists()
                ? Optional.of(request(id, FirestoreStore.raw(snapshot)))
                : Optional.empty();
    }

    public List<DownloadRequest> byWorkspace(String workspaceId) {
        return firestore.equal("downloadRequests", "workspaceId", workspaceId).stream()
                .map(snapshot -> request(snapshot.getId(), FirestoreStore.raw(snapshot)))
                .toList();
    }

    public void create(Transaction transaction, DownloadRequest request) {
        transaction.create(firestore.doc("downloadRequests", request.id()), data(request));
    }

    public void update(Transaction transaction, String id, Map<String, Object> fields) {
        transaction.update(firestore.doc("downloadRequests", id), fields);
    }

    public void withdraw(Transaction transaction, String id) {
        transaction.update(firestore.doc("downloadRequests", id), "status", "withdrawn");
    }

    public void decide(
            Transaction transaction,
            String id,
            String status,
            String actor,
            Timestamp decidedAt,
            String note) {
        transaction.update(
                firestore.doc("downloadRequests", id),
                "status",
                status,
                "decidedBy",
                actor,
                "decidedAt",
                decidedAt,
                "decisionNote",
                note);
    }

    public Map<String, Object> asMap(DownloadRequest request) {
        Map<String, Object> result = data(request);
        result.put("id", request.id());
        return FirestoreStore.jsonData(result);
    }

    private static DownloadRequest request(String id, Map<String, Object> data) {
        return new DownloadRequest(
                id,
                text(data, "workspaceId"),
                text(data, "requester"),
                text(data, "requesterName"),
                text(data, "paperRef"),
                text(data, "note"),
                text(data, "status"),
                timestamp(data, "requestedAt"),
                text(data, "decidedBy"),
                timestamp(data, "decidedAt"),
                text(data, "decisionNote"));
    }

    private static Map<String, Object> data(DownloadRequest request) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("workspaceId", request.workspaceId());
        data.put("requester", request.requester());
        data.put("requesterName", request.requesterName());
        data.put("paperRef", request.paperRef());
        data.put("note", request.note() == null ? "" : request.note());
        data.put("status", request.status());
        data.put("requestedAt", request.requestedAt());
        data.put("decisionNote", request.decisionNote() == null ? "" : request.decisionNote());
        if (request.decidedBy() != null) data.put("decidedBy", request.decidedBy());
        if (request.decidedAt() != null) data.put("decidedAt", request.decidedAt());
        return data;
    }

    private static String text(Map<String, Object> data, String key) {
        Object value = data.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static Timestamp timestamp(Map<String, Object> data, String key) {
        return data.get(key) instanceof Timestamp value ? value : null;
    }
}
