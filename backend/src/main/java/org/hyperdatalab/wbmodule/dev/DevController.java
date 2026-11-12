package org.hyperdatalab.wbmodule.dev;

import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Local-development helpers for the login screen: the demo accounts with their current role, and
 * a reset of the demo data. Not registered unless {@code app.auth.mode=dev}; these routes need no
 * token because dev mode already lets anyone sign in as any address.
 */
@RestController
@RequestMapping("/api/dev")
@ConditionalOnProperty(name = "app.auth.mode", havingValue = "dev")
public class DevController {
    private final DevData data;
    private final FirestoreStore store;

    public DevController(DevData data, FirestoreStore store) {
        this.data = data;
        this.store = store;
    }

    /** Lists the demo accounts with the role and disabled flag they have right now. */
    @GetMapping("/accounts")
    List<Map<String, Object>> accounts() {
        return DevData.ACCOUNTS.stream()
                .map(
                        account -> {
                            Map<String, Object> current =
                                    store.get("users", account.email()).orElse(Map.of());
                            Map<String, Object> out = new LinkedHashMap<>();
                            out.put("email", account.email());
                            out.put("name", account.name());
                            out.put("role", current.getOrDefault("role", account.role()));
                            out.put(
                                    "disabled",
                                    current.getOrDefault("disabled", account.disabled()));
                            out.put("note", account.note());
                            out.put("seeded", !current.isEmpty());
                            return out;
                        })
                .toList();
    }

    /** Wipes users, workspaces, memberships, requests and the audit log, then seeds again. */
    @PostMapping("/reset")
    Map<String, Object> reset() {
        data.reset();
        return Map.of("ok", true, "accounts", DevData.ACCOUNTS.size());
    }
}
