package org.hyperdatalab.wbmodule.store;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.SetOptions;
import com.google.cloud.firestore.Transaction;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Reads and writes workspace membership records. */
@Component
public class MembershipStore {
    public record Membership(
            String id,
            String workspaceId,
            String userEmail,
            String role,
            String status,
            String note,
            Timestamp requestedAt,
            String decidedBy,
            Timestamp decidedAt,
            String decisionNote) {}

    private final FirestoreStore firestore;

    public MembershipStore(FirestoreStore firestore) {
        this.firestore = firestore;
    }

    public Optional<Membership> find(String id) {
        return firestore.get("memberships", id).map(data -> membership(id, data));
    }

    public Optional<Membership> find(Transaction transaction, String id) {
        DocumentSnapshot snapshot =
                FirestoreStore.await(transaction.get(firestore.doc("memberships", id)));
        return snapshot.exists()
                ? Optional.of(membership(id, FirestoreStore.raw(snapshot)))
                : Optional.empty();
    }

    public List<Membership> byWorkspace(String workspaceId) {
        return firestore.equal("memberships", "workspaceId", workspaceId).stream()
                .map(snapshot -> membership(snapshot.getId(), FirestoreStore.raw(snapshot)))
                .toList();
    }

    public List<Membership> byUser(String email) {
        return firestore.equal("memberships", "userEmail", email).stream()
                .map(snapshot -> membership(snapshot.getId(), FirestoreStore.raw(snapshot)))
                .toList();
    }

    public void save(Transaction transaction, Membership membership) {
        transaction.set(firestore.doc("memberships", membership.id()), data(membership));
    }

    public void merge(Transaction transaction, Membership membership) {
        transaction.set(
                firestore.doc("memberships", membership.id()),
                data(membership),
                com.google.cloud.firestore.SetOptions.merge());
    }

    public void assignManager(
            Transaction transaction,
            String workspaceId,
            String email,
            String actor,
            Timestamp requestedAt) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("workspaceId", workspaceId);
        fields.put("userEmail", email);
        fields.put("role", "manager");
        fields.put("status", "approved");
        fields.put("requestedAt", requestedAt);
        fields.put("decidedBy", actor);
        transaction.set(
                firestore.doc("memberships", workspaceId + "_" + email),
                fields,
                SetOptions.merge());
    }

    public void demoteToMember(Transaction transaction, String id) {
        transaction.update(firestore.doc("memberships", id), "role", "member");
    }

    public void decideJoinRequest(
            Transaction transaction,
            String id,
            String status,
            String actor,
            Timestamp decidedAt,
            String note) {
        transaction.update(
                firestore.doc("memberships", id),
                "status",
                status,
                "role",
                "member",
                "decidedBy",
                actor,
                "decidedAt",
                decidedAt,
                "decisionNote",
                note);
    }

    public void revoke(
            Transaction transaction, String id, String actor, Timestamp decidedAt, String note) {
        transaction.update(
                firestore.doc("memberships", id),
                "status",
                "revoked",
                "decidedBy",
                actor,
                "decidedAt",
                decidedAt,
                "decisionNote",
                note);
    }

    public void update(Transaction transaction, String id, Map<String, Object> fields) {
        transaction.update(firestore.doc("memberships", id), fields);
    }

    public void delete(Transaction transaction, String id) {
        transaction.delete(firestore.doc("memberships", id));
    }

    public Map<String, Object> asMap(Membership membership) {
        Map<String, Object> result = data(membership);
        result.put("id", membership.id());
        result.put("email", membership.userEmail());
        return FirestoreStore.jsonData(result);
    }

    private static Membership membership(String id, Map<String, Object> data) {
        return new Membership(
                id,
                text(data, "workspaceId"),
                text(data, "userEmail"),
                text(data, "role"),
                text(data, "status"),
                text(data, "note"),
                timestamp(data, "requestedAt"),
                text(data, "decidedBy"),
                timestamp(data, "decidedAt"),
                text(data, "decisionNote"));
    }

    private static Map<String, Object> data(Membership membership) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("workspaceId", membership.workspaceId());
        data.put("userEmail", membership.userEmail());
        data.put("role", membership.role());
        data.put("status", membership.status());
        data.put("note", membership.note() == null ? "" : membership.note());
        data.put("requestedAt", membership.requestedAt());
        data.put("decidedBy", membership.decidedBy());
        data.put("decidedAt", membership.decidedAt());
        data.put(
                "decisionNote", membership.decisionNote() == null ? "" : membership.decisionNote());
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
