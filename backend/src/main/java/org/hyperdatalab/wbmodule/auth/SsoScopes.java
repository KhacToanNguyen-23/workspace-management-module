package org.hyperdatalab.wbmodule.auth;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Which scopes to ask the SSO for. research_projects:read is wanted, but asking for a scope the
 * client has not been granted makes the SSO refuse the whole sign-in (INVALID_SCOPE). So the
 * backend asks /oauth/authorize first, without following the redirect: a redirect means the scope
 * is allowed, INVALID_SCOPE means it is not. The answer is remembered for a while, so the module
 * starts reading projects by itself once ResearchPulse grants the scope.
 */
public class SsoScopes {
    public static final String BASE = "email profile hyperdatalab_profile";
    public static final String PROJECTS = "research_projects:read";

    private static final Duration KEEP_GRANTED = Duration.ofHours(6);
    private static final Duration KEEP_REFUSED = Duration.ofMinutes(5);

    private record Answer(String scope, Instant until) {}

    private final HttpClient http =
            HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(5))
                    .followRedirects(HttpClient.Redirect.NEVER)
                    .build();
    private final String baseUrl;
    private final String clientId;
    private final Map<String, Answer> answers = new ConcurrentHashMap<>();

    public SsoScopes(String baseUrl, String clientId) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.clientId = clientId;
    }

    /** The scopes to ask for when the SSO returns to {@code redirectUri}. */
    public String forCallback(String redirectUri) {
        Answer a = answers.get(redirectUri);
        if (a != null && Instant.now().isBefore(a.until())) return a.scope();
        boolean granted = allows(redirectUri, BASE + " " + PROJECTS);
        String scope = granted ? BASE + " " + PROJECTS : BASE;
        answers.put(
                redirectUri,
                new Answer(scope, Instant.now().plus(granted ? KEEP_GRANTED : KEEP_REFUSED)));
        return scope;
    }

    private boolean allows(String redirectUri, String scope) {
        Map<String, String> q =
                Map.of(
                        "response_type", "code",
                        "client_id", clientId,
                        "redirect_uri", redirectUri,
                        "scope", scope,
                        "state", "scope-check",
                        // A valid-looking challenge; no code is ever exchanged for it.
                        "code_challenge", "A".repeat(43),
                        "code_challenge_method", "S256");
        String query =
                q.entrySet().stream()
                        .map(e -> e.getKey() + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                        .collect(Collectors.joining("&"));
        try {
            HttpResponse<Void> res =
                    http.send(
                            HttpRequest.newBuilder(URI.create(baseUrl + "/oauth/authorize?" + query))
                                    .timeout(Duration.ofSeconds(8))
                                    .GET()
                                    .build(),
                            HttpResponse.BodyHandlers.discarding());
            return res.statusCode() >= 300 && res.statusCode() < 400;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception e) {
            // Unsure: sign in without the project scope rather than risk a refused sign-in.
            return false;
        }
    }
}
