package org.hyperdatalab.wbmodule.directory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Generic REST user directory — the "API from another party" that knows the org's users.
 *
 * <pre>
 * GET {baseUrl}/users/{email}          → 200 {email,name,photoUrl,department,suspended} | 404
 * GET {baseUrl}/users?domain={domain}  → 200 [ ...same objects ] or {"users":[...]}
 * Authorization: Bearer {token}        (when app.directory.http-token is set)
 * </pre>
 */
public class HttpUserDirectory implements UserDirectory {
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String baseUrl;
    private final String token;
    private final String domain;

    public HttpUserDirectory(ObjectMapper json, String baseUrl, String token, String domain) {
        if (baseUrl == null || baseUrl.isBlank()) throw new IllegalStateException("app.directory.http-base-url is required");
        this.json = json;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.token = token;
        this.domain = domain;
    }

    @Override
    public String mode() {
        return "http";
    }

    private HttpResponse<String> get(String url) {
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15)).GET()
                .header("accept", "application/json");
        if (token != null && !token.isBlank()) req.header("authorization", "Bearer " + token);
        try {
            return http.send(req.build(), HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new DirectoryException("User directory is unreachable: " + e.getMessage());
        }
    }

    static DirectoryUser map(JsonNode n) {
        return new DirectoryUser(
                n.path("email").asText().toLowerCase(Locale.ROOT),
                n.path("name").asText(""),
                n.hasNonNull("photoUrl") ? n.get("photoUrl").asText() : null,
                n.hasNonNull("department") ? n.get("department").asText() : null,
                n.path("suspended").asBoolean(false));
    }

    @Override
    public Optional<DirectoryUser> find(String email) {
        HttpResponse<String> res = get(baseUrl + "/users/" + URLEncoder.encode(email, StandardCharsets.UTF_8));
        if (res.statusCode() == 404) return Optional.empty();
        if (res.statusCode() >= 300) throw new DirectoryException("User directory answered HTTP " + res.statusCode() + ".");
        try {
            return Optional.of(map(json.readTree(res.body())));
        } catch (Exception e) {
            throw new DirectoryException("User directory returned invalid JSON.");
        }
    }

    @Override
    public List<DirectoryUser> listAll() {
        HttpResponse<String> res = get(baseUrl + "/users?domain=" + URLEncoder.encode(domain, StandardCharsets.UTF_8));
        if (res.statusCode() >= 300) throw new DirectoryException("User directory answered HTTP " + res.statusCode() + ".");
        try {
            JsonNode root = json.readTree(res.body());
            JsonNode arr = root.isArray() ? root : root.path("users");
            List<DirectoryUser> out = new ArrayList<>();
            arr.forEach(n -> out.add(map(n)));
            return out;
        } catch (Exception e) {
            throw new DirectoryException("User directory returned invalid JSON.");
        }
    }
}
