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
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Generic REST user directory — the "API from another party" that knows the org's users.
 *
 * <pre>
 * GET {baseUrl}/users/{email}          → 200 {email,name,photoUrl,department,suspended} | 404
 * GET {baseUrl}/users?domain={domain}  → 200 [ ...same objects ] or {"users":[...]}
 *     paged: {"users":[...], "nextPageToken":"t"} → next page is ...&pageToken=t,
 *     until nextPageToken is missing or empty
 * Authorization: Bearer {token}        (when app.directory.http-token is set)
 * </pre>
 *
 * The contract is a placeholder until the ecosystem API is documented; adjust {@link #map} and
 * the paging parameter names here when it is.
 */
public class HttpUserDirectory implements UserDirectory {
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String baseUrl;
    private final String token;
    private final String domain;

    public HttpUserDirectory(ObjectMapper json, String baseUrl, String token, String domain) {
        if (baseUrl == null || baseUrl.isBlank())
            throw new IllegalStateException("app.directory.http-base-url is required");
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
        HttpRequest.Builder req =
                HttpRequest.newBuilder(URI.create(url))
                        .timeout(Duration.ofSeconds(15))
                        .GET()
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
        HttpResponse<String> res =
                get(baseUrl + "/users/" + URLEncoder.encode(email, StandardCharsets.UTF_8));
        if (res.statusCode() == 404) return Optional.empty();
        if (res.statusCode() >= 300)
            throw new DirectoryException("User directory answered HTTP " + res.statusCode() + ".");
        try {
            return Optional.of(map(json.readTree(res.body())));
        } catch (Exception e) {
            throw new DirectoryException("User directory returned invalid JSON.");
        }
    }

    /** Stops a directory that keeps handing out page tokens from looping forever. */
    private static final int MAX_PAGES = 1000;

    @Override
    public List<DirectoryUser> listAll() {
        String first = baseUrl + "/users?domain=" + URLEncoder.encode(domain, StandardCharsets.UTF_8);
        List<DirectoryUser> out = new ArrayList<>();
        Set<String> tokens = new HashSet<>();
        String url = first;
        for (int page = 0; url != null; page++) {
            if (page == MAX_PAGES)
                throw new DirectoryException("User directory returned too many pages.");
            HttpResponse<String> res = get(url);
            if (res.statusCode() >= 300)
                throw new DirectoryException(
                        "User directory answered HTTP " + res.statusCode() + ".");
            JsonNode root;
            try {
                root = json.readTree(res.body());
            } catch (Exception e) {
                throw new DirectoryException("User directory returned invalid JSON.");
            }
            JsonNode arr = root.isArray() ? root : root.path("users");
            if (!arr.isArray())
                throw new DirectoryException("User directory returned no user list.");
            arr.forEach(n -> out.add(map(n)));
            String next =
                    root.hasNonNull("nextPageToken") ? root.get("nextPageToken").asText() : "";
            if (!next.isEmpty() && !tokens.add(next))
                throw new DirectoryException("User directory repeated a page token.");
            url =
                    next.isEmpty()
                            ? null
                            : first + "&pageToken=" + URLEncoder.encode(next, StandardCharsets.UTF_8);
        }
        return out;
    }
}
