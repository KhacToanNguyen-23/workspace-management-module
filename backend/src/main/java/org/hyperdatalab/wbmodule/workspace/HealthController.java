package org.hyperdatalab.wbmodule.workspace;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Readiness probe. Deliberately unversioned and unauthenticated. */
@RestController
@RequestMapping("/api")
public class HealthController {
    @GetMapping("/health")
    Map<String, Object> health() {
        return Map.of("ok", true);
    }
}
