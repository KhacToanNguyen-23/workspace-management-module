package org.hyperdatalab.wbmodule.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.hyperdatalab.wbmodule.common.ApiException;
import org.springframework.http.HttpStatus;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * The relying-party half of the HyperDataLab SSO (OAuth 2.0 Authorization Code + PKCE, served by
 * the ResearchPulse Worker). The browser brings back a one-time authorization code; this class
 * exchanges it and reads the profile:
 *
 * <pre>
 * POST {baseUrl}/oauth/token     grant_type=authorization_code, client_id, [client_secret],
 *                                code, redirect_uri, code_verifier → {access_token, ...}
 * GET  {baseUrl}/oauth/userinfo  Authorization: Bearer {access_token}
 *                                → {sub, email, email_verified, name, picture, role, student_id,
 *                                   major}
 * </pre>
 *
 * Exchanging the code here, with this module's client id, is what proves the sign-in was meant
 * for this module: an access token issued to another connected application cannot be replayed.
 * The SSO only answers userinfo for a profile that is approved, active and linked to the
 * Workspace domain.
 */
public class SsoClient {
    /** What /oauth/userinfo says about the signed-in user; optional fields may be null. */
    public record Profile(
            String sub,
            String email,
            boolean emailVerified,
            String name,
            String picture,
            String role,
            String studentId,
            String major) {}

    /** A sign-in: the profile, and the SSO access token with its expiry and granted scopes. */
    public record SignedIn(
            Profile profile, String accessToken, java.time.Instant expiresAt, String scope) {}

    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String baseUrl;
    private final String clientId;
    private final String clientSecret;

    public SsoClient(ObjectMapper json, String baseUrl, String clientId, String clientSecret) {
        if (baseUrl == null || baseUrl.isBlank() || clientId == null || clientId.isBlank())
            throw new IllegalStateException(
                    "app.auth.sso.base-url and app.auth.sso.client-id are required"
                            + " (SSO_BASE_URL, SSO_CLIENT_ID)");
        this.json = json;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.clientId = clientId;
        this.clientSecret = clientSecret == null ? "" : clientSecret;
    }

    private static ApiException unavailable(String detail) {
        return new ApiException(
                HttpStatus.BAD_GATEWAY, "sso_unavailable", "The sign-in service " + detail + ".");
    }

    /** Sends the request; 4xx means the SSO refused it, anything else that it is not working. */
    private JsonNode send(HttpRequest request, String refusedMessage) {
        HttpResponse<String> res;
        try {
            res = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable("did not answer");
        } catch (Exception e) {
            throw unavailable("is unreachable");
        }
        if (res.statusCode() >= 400 && res.statusCode() < 500)
            throw new ApiException(HttpStatus.UNAUTHORIZED, "sso_rejected", refusedMessage);
        if (res.statusCode() >= 300) throw unavailable("answered HTTP " + res.statusCode());
        try {
            return json.readTree(res.body());
        } catch (Exception e) {
            throw unavailable("returned an invalid answer");
        }
    }

    private static String text(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.get(field).asText() : null;
    }

    /** Exchanges a one-time authorization code and returns the profile of who signed in. */
    public SignedIn signIn(String code, String codeVerifier, String redirectUri) {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "authorization_code");
        form.put("client_id", clientId);
        if (!clientSecret.isBlank()) form.put("client_secret", clientSecret);
        form.put("code", code);
        form.put("redirect_uri", redirectUri);
        form.put("code_verifier", codeVerifier);
        String body =
                form.entrySet().stream()
                        .map(
                                e ->
                                        e.getKey()
                                                + "="
                                                + URLEncoder.encode(
                                                        e.getValue(), StandardCharsets.UTF_8))
                        .collect(Collectors.joining("&"));
        JsonNode token =
                send(
                        HttpRequest.newBuilder(URI.create(baseUrl + "/oauth/token"))
                                .timeout(Duration.ofSeconds(15))
                                .header("content-type", "application/x-www-form-urlencoded")
                                .header("accept", "application/json")
                                .POST(HttpRequest.BodyPublishers.ofString(body))
                                .build(),
                        "The sign-in code was refused or has expired; sign in again.");
        String accessToken = text(token, "access_token");
        if (accessToken == null || accessToken.isBlank())
            throw unavailable("returned no access token");

        JsonNode info =
                send(
                        HttpRequest.newBuilder(URI.create(baseUrl + "/oauth/userinfo"))
                                .timeout(Duration.ofSeconds(15))
                                .header("authorization", "Bearer " + accessToken)
                                .header("accept", "application/json")
                                .GET()
                                .build(),
                        "The sign-in service did not release your profile; sign in again.");
        long life = Math.min(Math.max(token.path("expires_in").asLong(3600), 0), 86_400);
        Profile profile =
                new Profile(
                text(info, "sub"),
                text(info, "email"),
                info.path("email_verified").asBoolean(false),
                text(info, "name"),
                text(info, "picture"),
                text(info, "role"),
                text(info, "student_id"),
                text(info, "major"));
        return new SignedIn(
                profile,
                accessToken,
                java.time.Instant.now().plusSeconds(life),
                token.path("scope").asText(""));
    }
}
