package org.hyperdatalab.wbmodule.identity;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Append-only audit trail. Call it inside the same transaction as the change it records. */
@Service
public class AuditService {
    private final JdbcClient db;
    private final ObjectMapper json;

    public AuditService(JdbcClient db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    public void log(String actor, String action, String target, UUID workspaceId, Map<String, ?> detail) {
        String detailJson;
        try {
            detailJson = json.writeValueAsString(detail == null ? Map.of() : detail);
        } catch (JsonProcessingException e) {
            detailJson = "{}";
        }
        db.sql("INSERT INTO audit_log (actor, action, target, workspace_id, detail) VALUES (?, ?, ?, ?, ?::jsonb)")
                .params(actor, action, target == null ? "" : target, workspaceId, detailJson)
                .update();
    }

    public void log(String actor, String action, String target, UUID workspaceId) {
        log(actor, action, target, workspaceId, Map.of());
    }
}
