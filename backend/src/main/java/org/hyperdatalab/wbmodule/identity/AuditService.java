package org.hyperdatalab.wbmodule.identity;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.Transaction;

import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class AuditService {
    private final FirestoreStore store;

    public AuditService(FirestoreStore store) {
        this.store = store;
    }

    public void log(
            String actor,
            String action,
            String target,
            String workspaceId,
            Map<String, Object> detail) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("at", Timestamp.now());
        d.put("actor", actor);
        d.put("action", action);
        d.put("target", target == null ? "" : target);
        d.put("workspaceId", workspaceId);
        d.put("detail", detail == null ? Map.of() : detail);
        store.firestore().collection("auditLog").add(d);
    }

    public void log(
            Transaction tx,
            String actor,
            String action,
            String target,
            String workspaceId,
            Map<String, Object> detail) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("at", Timestamp.now());
        d.put("actor", actor);
        d.put("action", action);
        d.put("target", target == null ? "" : target);
        d.put("workspaceId", workspaceId);
        d.put("detail", detail == null ? Map.of() : detail);
        tx.create(store.firestore().collection("auditLog").document(), d);
    }
}
