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
import java.util.List;
import java.util.Map;

/**
 * The audit trail. Administrators read all of it; a workspace manager reads the events of the
 * workspace named by {@code workspaceId}, which is then required.
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
        return Paging.page(
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
    }
}
