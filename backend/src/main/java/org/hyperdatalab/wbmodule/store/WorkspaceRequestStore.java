package org.hyperdatalab.wbmodule.store;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Transaction;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Reads and writes workspace creation request records. */
@Component
public class WorkspaceRequestStore {
    public record WorkspaceRequest(
            String id,
            String requester,
            String name,
            String slug,
            String type,
            String description,
            String reason,
            String status,
            Timestamp requestedAt,
            String decidedBy,
            Timestamp decidedAt,
            String decisionNote,
            String workspaceId) {}

    private final FirestoreStore firestore;

    public WorkspaceRequestStore(FirestoreStore firestore) {
        this.firestore = firestore;
    }

    public List<WorkspaceRequest> byRequester(String email) {
        return firestore.equal("workspaceRequests", "requester", email).stream()
                .map(snapshot -> request(snapshot.getId(), FirestoreStore.data(snapshot)))
                .toList();
    }

    public List<WorkspaceRequest> byStatus(String status) {
        return firestore.equal("workspaceRequests", "status", status).stream()
                .map(snapshot -> request(snapshot.getId(), FirestoreStore.data(snapshot)))
                .toList();
    }

    public Optional<WorkspaceRequest> find(Transaction transaction, String id) {
        DocumentSnapshot snapshot =
                FirestoreStore.await(transaction.get(firestore.doc("workspaceRequests", id)));
        return snapshot.exists()
                ? Optional.of(request(id, FirestoreStore.data(snapshot)))
                : Optional.empty();
    }

    public WorkspaceRequest from(DocumentSnapshot snapshot) {
        return request(snapshot.getId(), FirestoreStore.data(snapshot));
    }

    public void create(Transaction transaction, WorkspaceRequest request) {
        transaction.create(firestore.doc("workspaceRequests", request.id()), data(request));
    }

    public void update(Transaction transaction, String id, Map<String, Object> fields) {
        transaction.update(firestore.doc("workspaceRequests", id), fields);
    }

    public void update(String id, Map<String, Object> fields) {
        firestore.doc("workspaceRequests", id).update(fields);
    }

    public void withdraw(Transaction transaction, String id) {
        transaction.update(firestore.doc("workspaceRequests", id), "status", "withdrawn");
    }

    public void decide(
            Transaction transaction,
            String id,
            String status,
            String actor,
            Timestamp decidedAt,
            String note,
            String workspaceId) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("status", status);
        fields.put("decidedBy", actor);
        fields.put("decidedAt", decidedAt);
        fields.put("decisionNote", note);
        if (workspaceId != null) fields.put("workspaceId", workspaceId);
        transaction.update(firestore.doc("workspaceRequests", id), fields);
    }

    public Map<String, Object> asMap(WorkspaceRequest request) {
        Map<String, Object> result = data(request);
        result.put("id", request.id());
        return FirestoreStore.jsonData(result);
    }

    private static WorkspaceRequest request(String id, Map<String, Object> data) {
        return new WorkspaceRequest(
                id,
                text(data, "requester"),
                text(data, "name"),
                text(data, "slug"),
                text(data, "type"),
                text(data, "description"),
                text(data, "reason"),
                text(data, "status"),
                timestamp(data, "requestedAt"),
                text(data, "decidedBy"),
                timestamp(data, "decidedAt"),
                text(data, "decisionNote"),
                text(data, "workspaceId"));
    }

    private static Map<String, Object> data(WorkspaceRequest request) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("requester", request.requester());
        data.put("name", request.name());
        data.put("slug", request.slug());
        data.put("type", request.type());
        data.put("description", request.description() == null ? "" : request.description());
        data.put("reason", request.reason() == null ? "" : request.reason());
        data.put("status", request.status());
        data.put("requestedAt", request.requestedAt());
        data.put("decisionNote", request.decisionNote() == null ? "" : request.decisionNote());
        if (request.decidedBy() != null) data.put("decidedBy", request.decidedBy());
        if (request.decidedAt() != null) data.put("decidedAt", request.decidedAt());
        if (request.workspaceId() != null) data.put("workspaceId", request.workspaceId());
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
