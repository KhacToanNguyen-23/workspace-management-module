package org.hyperdatalab.wbmodule.store;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Transaction;

import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Reads and writes workspace records and their denormalized manager list. */
@Component
public class WorkspaceStore {
    public record WorkspaceType(String code, String name, String description) {}

    public record Workspace(
            String id,
            String name,
            String type,
            String description,
            String status,
            String createdBy,
            Timestamp createdAt,
            List<String> managerEmails,
            long memberCount,
            long pendingCount) {}

    private final FirestoreStore firestore;

    public WorkspaceStore(FirestoreStore firestore) {
        this.firestore = firestore;
    }

    public Optional<Workspace> find(String id) {
        return firestore.get("workspaces", id).map(data -> workspace(id, data));
    }

    public Optional<Workspace> find(Transaction transaction, String id) {
        DocumentSnapshot snapshot =
                FirestoreStore.await(transaction.get(firestore.doc("workspaces", id)));
        return snapshot.exists()
                ? Optional.of(workspace(id, FirestoreStore.raw(snapshot)))
                : Optional.empty();
    }

    public List<Workspace> all() {
        return firestore.all("workspaces").stream()
                .map(snapshot -> workspace(snapshot.getId(), FirestoreStore.raw(snapshot)))
                .toList();
    }

    public List<Workspace> managedBy(String email) {
        return firestore.arrayContains("workspaces", "managerEmails", email).stream()
                .map(snapshot -> workspace(snapshot.getId(), FirestoreStore.raw(snapshot)))
                .toList();
    }

    public List<WorkspaceType> types() {
        return firestore.all("workspaceTypes").stream()
                .map(
                        snapshot ->
                                new WorkspaceType(
                                        snapshot.getId(),
                                        snapshot.getString("name"),
                                        snapshot.getString("description")))
                .toList();
    }

    public boolean typeExists(Transaction transaction, String code) {
        return FirestoreStore.await(transaction.get(firestore.doc("workspaceTypes", code)))
                .exists();
    }

    public void createType(Transaction transaction, WorkspaceType type) {
        transaction.create(
                firestore.doc("workspaceTypes", type.code()),
                Map.of(
                        "code", type.code(),
                        "name", type.name(),
                        "description", type.description() == null ? "" : type.description()));
    }

    public void create(Transaction transaction, Workspace workspace) {
        transaction.create(firestore.doc("workspaces", workspace.id()), data(workspace));
    }

    public void update(Transaction transaction, String id, Map<String, Object> fields) {
        transaction.update(firestore.doc("workspaces", id), fields);
    }

    public void update(String id, Map<String, Object> fields) {
        firestore.doc("workspaces", id).update(fields);
    }

    public void updateManagerEmails(Transaction transaction, String id, List<String> emails) {
        transaction.update(firestore.doc("workspaces", id), "managerEmails", emails);
    }

    public void updateCounts(
            Transaction transaction, String id, Long memberCount, Long pendingCount) {
        Map<String, Object> fields = new HashMap<>();
        if (memberCount != null) fields.put("memberCount", memberCount);
        if (pendingCount != null) fields.put("pendingCount", pendingCount);
        transaction.update(firestore.doc("workspaces", id), fields);
    }

    public void updateMetadata(
            String id, String name, String description, String type, String status) {
        Map<String, Object> fields = new HashMap<>();
        if (name != null) fields.put("name", name);
        if (description != null) fields.put("description", description);
        if (type != null) fields.put("type", type);
        if (status != null) fields.put("status", status);
        if (!fields.isEmpty()) firestore.doc("workspaces", id).update(fields);
    }

    public Map<String, Object> asMap(Workspace workspace) {
        Map<String, Object> result = new java.util.LinkedHashMap<>(data(workspace));
        result.put("id", workspace.id());
        return FirestoreStore.jsonData(result);
    }

    private static Workspace workspace(String id, Map<String, Object> data) {
        Object managers = data.get("managerEmails");
        return new Workspace(
                id,
                text(data, "name"),
                text(data, "type"),
                text(data, "description"),
                text(data, "status"),
                text(data, "createdBy"),
                data.get("createdAt") instanceof Timestamp timestamp ? timestamp : null,
                managers instanceof List<?> list
                        ? list.stream().map(String::valueOf).toList()
                        : List.of(),
                number(data, "memberCount"),
                number(data, "pendingCount"));
    }

    private static Map<String, Object> data(Workspace workspace) {
        // A LinkedHashMap, not Map.of: records read from older documents may lack a field.
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("name", workspace.name());
        data.put("type", workspace.type());
        data.put("description", workspace.description() == null ? "" : workspace.description());
        data.put("status", workspace.status());
        data.put("createdBy", workspace.createdBy());
        data.put("createdAt", workspace.createdAt());
        data.put("managerEmails", workspace.managerEmails());
        data.put("memberCount", workspace.memberCount());
        data.put("pendingCount", workspace.pendingCount());
        return data;
    }

    private static String text(Map<String, Object> data, String key) {
        Object value = data.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static long number(Map<String, Object> data, String key) {
        return data.get(key) instanceof Number value ? value.longValue() : 0;
    }
}
