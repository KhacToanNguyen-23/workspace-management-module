package org.hyperdatalab.wbmodule.store;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.FieldValue;
import com.google.cloud.firestore.SetOptions;
import com.google.cloud.firestore.Transaction;

import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Reads and writes user records in the {@code users} collection. */
@Component
public class UserStore {
    public record DirectorySnapshot(
            String email,
            String name,
            String photoUrl,
            String department,
            String directoryStatus) {}

    public record User(
            String email,
            String authUid,
            String name,
            String photoUrl,
            String department,
            String directoryStatus,
            String role,
            boolean disabled,
            Timestamp firstSeen,
            Timestamp lastSeen,
            Timestamp syncedAt,
            Timestamp disabledAt,
            String disabledBy,
            String pendingWorkspaceRequestId) {}

    private final FirestoreStore firestore;

    public UserStore(FirestoreStore firestore) {
        this.firestore = firestore;
    }

    public Optional<User> find(String email) {
        return firestore.get("users", email).map(data -> user(email, data));
    }

    public <T> T transaction(com.google.cloud.firestore.Transaction.Function<T> action) {
        return firestore.transaction(action);
    }

    public Optional<User> find(com.google.cloud.firestore.Transaction transaction, String email) {
        DocumentSnapshot snapshot =
                FirestoreStore.await(transaction.get(firestore.doc("users", email)));
        return snapshot.exists()
                ? Optional.of(user(email, FirestoreStore.raw(snapshot)))
                : Optional.empty();
    }

    public List<User> all() {
        return firestore.all("users").stream()
                .map(snapshot -> user(snapshot.getId(), FirestoreStore.raw(snapshot)))
                .toList();
    }

    public void merge(Transaction transaction, User user) {
        transaction.set(firestore.doc("users", user.email()), data(user), SetOptions.merge());
    }

    public void merge(Transaction transaction, String email, Map<String, Object> fields) {
        transaction.set(firestore.doc("users", email), fields, SetOptions.merge());
    }

    public void promoteToWorkspaceManager(Transaction transaction, String email) {
        transaction.set(
                firestore.doc("users", email),
                Map.of("email", email, "role", "workspace_manager"),
                SetOptions.merge());
    }

    public void setPendingWorkspaceRequest(
            Transaction transaction, String email, String requestId) {
        transaction.set(
                firestore.doc("users", email),
                Map.of("pendingWorkspaceRequestId", requestId),
                SetOptions.merge());
    }

    public void clearPendingWorkspaceRequest(Transaction transaction, String email) {
        transaction.update(
                firestore.doc("users", email),
                "pendingWorkspaceRequestId",
                com.google.cloud.firestore.FieldValue.delete());
    }

    public void merge(String email, Map<String, Object> fields) {
        firestore.doc("users", email).set(fields, SetOptions.merge());
    }

    public void update(Transaction transaction, String email, Map<String, Object> fields) {
        transaction.update(firestore.doc("users", email), fields);
    }

    public void updateRole(Transaction transaction, String email, String role) {
        transaction.update(firestore.doc("users", email), "role", role);
    }

    public void setDisabled(Transaction transaction, String email, boolean disabled, String actor) {
        transaction.update(
                firestore.doc("users", email),
                "disabled",
                disabled,
                "disabledAt",
                disabled ? Timestamp.now() : FieldValue.delete(),
                "disabledBy",
                disabled ? actor : FieldValue.delete());
    }

    public void update(String email, Map<String, Object> fields) {
        firestore.doc("users", email).update(fields);
    }

    public int syncDirectory(List<DirectorySnapshot> directoryUsers) {
        Set<String> seen = new HashSet<>();
        com.google.cloud.firestore.WriteBatch batch = firestore.firestore().batch();
        int writes = 0;
        for (DirectorySnapshot user : directoryUsers) {
            seen.add(user.email());
            Map<String, Object> fields = new LinkedHashMap<>();
            fields.put("email", user.email());
            fields.put("name", user.name());
            fields.put("photoUrl", user.photoUrl() == null ? "" : user.photoUrl());
            fields.put("department", user.department() == null ? "" : user.department());
            fields.put("directoryStatus", user.directoryStatus());
            fields.put("syncedAt", Timestamp.now());
            batch.set(firestore.doc("users", user.email()), fields, SetOptions.merge());
            if (++writes == 450) {
                FirestoreStore.await(batch.commit());
                batch = firestore.firestore().batch();
                writes = 0;
            }
        }
        if (writes > 0) FirestoreStore.await(batch.commit());

        int missing = 0;
        for (User user : all()) {
            if (Set.of("active", "suspended").contains(user.directoryStatus())
                    && !seen.contains(user.email())) {
                update(
                        user.email(),
                        Map.of("directoryStatus", "missing", "syncedAt", Timestamp.now()));
                missing++;
            }
        }
        return missing;
    }

    private static User user(String email, Map<String, Object> data) {
        return new User(
                email,
                text(data, "authUid"),
                text(data, "name"),
                text(data, "photoUrl"),
                text(data, "department"),
                text(data, "directoryStatus"),
                text(data, "role"),
                Boolean.TRUE.equals(data.get("disabled")),
                timestamp(data, "firstSeen"),
                timestamp(data, "lastSeen"),
                timestamp(data, "syncedAt"),
                timestamp(data, "disabledAt"),
                text(data, "disabledBy"),
                text(data, "pendingWorkspaceRequestId"));
    }

    private static Map<String, Object> data(User user) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("email", user.email());
        put(data, "authUid", user.authUid());
        put(data, "name", user.name());
        put(data, "photoUrl", user.photoUrl());
        put(data, "department", user.department());
        put(data, "directoryStatus", user.directoryStatus());
        put(data, "role", user.role());
        data.put("disabled", user.disabled());
        put(data, "firstSeen", user.firstSeen());
        put(data, "lastSeen", user.lastSeen());
        put(data, "syncedAt", user.syncedAt());
        put(data, "disabledAt", user.disabledAt());
        put(data, "disabledBy", user.disabledBy());
        put(data, "pendingWorkspaceRequestId", user.pendingWorkspaceRequestId());
        return data;
    }

    private static String text(Map<String, Object> data, String key) {
        Object value = data.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private static Timestamp timestamp(Map<String, Object> data, String key) {
        return data.get(key) instanceof Timestamp value ? value : null;
    }

    private static void put(Map<String, Object> data, String key, Object value) {
        if (value != null) data.put(key, value);
    }
}
