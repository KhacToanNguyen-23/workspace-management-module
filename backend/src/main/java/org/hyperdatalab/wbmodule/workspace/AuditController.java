package org.hyperdatalab.wbmodule.workspace;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.Locations;
import org.hyperdatalab.wbmodule.common.Paging;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;

import com.google.cloud.firestore.DocumentSnapshot;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The audit trail. Administrators read all of it; a workspace manager reads the events of the
 * workspace named by {@code workspaceId}, which is then required.
 *
 * <p>Each event also carries {@code actorName} and {@code targetName}: display names for the
 * stored email or document id, so a reader sees people and workspaces rather than ids.
 */
@RestController
@RequestMapping(Locations.API + "/audit-events")
public class AuditController {
    private final FirestoreStore store;
    private final AccessService access;

    public AuditController(FirestoreStore store, AccessService access) {
        this.store = store;
        this.access = access;
    }

    @GetMapping
    ResponseEntity<List<Map<String, Object>>> list(
            AuthedUser u,
            @RequestParam(required = false) String workspaceId,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset) {
        List<DocumentSnapshot> source;
        if (workspaceId == null) {
            if (!u.admin()) throw ApiException.forbidden("admin_only", "Administrators only.");
            source = store.all("auditLog");
        } else {
            access.load(u, workspaceId).requireManager();
            source = store.equal("auditLog", "workspaceId", workspaceId);
        }
        ResponseEntity<List<Map<String, Object>>> page =
                Paging.page(
                        source.stream()
                                .sorted(
                                        Comparator.comparing(
                                                (DocumentSnapshot s) -> s.getTimestamp("at"),
                                                Comparator.nullsLast(Comparator.reverseOrder())))
                                .map(
                                        s -> {
                                            Map<String, Object> d = FirestoreStore.data(s);
                                            d.put("id", s.getId());
                                            return d;
                                        })
                                .toList(),
                        limit,
                        offset);
        // Names are looked up for the returned page only, once per distinct id.
        Labels labels = new Labels();
        for (Map<String, Object> d : page.getBody()) {
            d.put("actorName", labels.user(text(d, "actor")));
            d.put("targetName", labels.target(text(d, "action"), text(d, "target")));
        }
        return page;
    }

    private static String text(Map<String, Object> d, String key) {
        Object v = d.get(key);
        return v == null ? "" : v.toString();
    }

    private final class Labels {
        private final Map<String, Optional<Map<String, Object>>> cache = new HashMap<>();

        private String field(String collection, String id, String field) {
            if (id == null || id.isBlank()) return null;
            Object v =
                    cache.computeIfAbsent(collection + "/" + id, k -> store.get(collection, id))
                            .map(doc -> doc.get(field))
                            .orElse(null);
            return v == null || v.toString().isBlank() ? null : v.toString();
        }

        String user(String email) {
            return field("users", email, "name");
        }

        /** What the event acted on, by the kind of id its action stores as the target. */
        String target(String action, String target) {
            String kind = action.contains(".") ? action.substring(0, action.indexOf('.')) : action;
            return switch (kind) {
                case "user", "membership" -> user(target);
                case "workspace" ->
                        action.equals("workspace.manager")
                                ? user(target)
                                : field("workspaces", target, "name");
                case "workspace_request" -> field("workspaceRequests", target, "name");
                case "download_request" -> field("downloadRequests", target, "paperRef");
                default -> null;
            };
        }
    }
}
