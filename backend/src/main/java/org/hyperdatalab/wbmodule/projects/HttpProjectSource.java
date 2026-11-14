package org.hyperdatalab.wbmodule.projects;

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
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The ResearchPulse project API as documented in EXTERNAL_RESEARCH_PROJECTS_API_VI.md, called
 * with the user's own SSO access token (scope research_projects:read):
 *
 * <pre>
 * GET {base}/api/v1/me/research-projects?limit=100[&cursor=c]
 *     → {success, data:{items:[...], nextCursor}}       (the user's ACTIVE projects only)
 * GET {base}/api/v1/research-projects/{id}
 *     → {success, data:{..., members:[{name, role}]}}   (404 unless the user is a member)
 * errors: 401 INVALID_TOKEN, 403 INSUFFICIENT_SCOPE, 404 PROJECT_NOT_FOUND, 429 RATE_LIMITED
 * </pre>
 *
 * The API is read-only, so member changes are not supported here.
 */
public class HttpProjectSource implements ProjectSource {
    static final List<String> FIELDS =
            List.of(
                    "id",
                    "title",
                    "description",
                    "researchArea",
                    "ownerUid",
                    "myRole",
                    "joinedAt",
                    "createdAt",
                    "updatedAt");
    /** The API maximum. */
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 50;

    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String baseUrl;

    public HttpProjectSource(ObjectMapper json, String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank())
            throw new IllegalStateException(
                    "Reading projects needs SSO_BASE_URL (or PROJECTS_BASE_URL).");
        this.json = json;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
    }

    @Override
    public boolean listsAll() {
        return false;
    }

    private static ApiException unavailable(String detail) {
        return new ApiException(
                HttpStatus.BAD_GATEWAY,
                "projects_unavailable",
                "ResearchPulse " + detail + ".");
    }

    /** The body's {@code data}, or empty on 404. */
    private Optional<JsonNode> fetch(String path, String userToken) {
        HttpResponse<String> res;
        try {
            res =
                    http.send(
                            HttpRequest.newBuilder(URI.create(baseUrl + path))
                                    .timeout(Duration.ofSeconds(15))
                                    .header("authorization", "Bearer " + userToken)
                                    .header("accept", "application/json")
                                    .GET()
                                    .build(),
                            HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable("did not answer");
        } catch (Exception e) {
            throw unavailable("is unreachable");
        }
        int status = res.statusCode();
        if (status == 404) return Optional.empty();
        if (status == 401)
            throw ApiException.conflict(
                    "sso_token_expired",
                    "Quyền xem dự án của lần đăng nhập này đã hết hạn. Đăng nhập lại để xem tiếp.");
        if (status == 403)
            throw ApiException.conflict(
                    "scope_not_granted",
                    "ResearchPulse chưa cho ứng dụng này đọc dự án.");
        if (status == 429)
            throw new ApiException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "rate_limited",
                    "ResearchPulse đang bận, thử lại sau một phút.");
        if (status >= 300) throw unavailable("answered HTTP " + status);
        try {
            JsonNode data = json.readTree(res.body()).path("data");
            if (data.isMissingNode() || data.isNull()) throw new IllegalStateException();
            return Optional.of(data);
        } catch (Exception e) {
            throw unavailable("returned an invalid answer");
        }
    }

    static Map<String, Object> project(JsonNode n) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String f : FIELDS) out.put(f, n.hasNonNull(f) ? n.get(f).asText() : null);
        return out;
    }

    @Override
    public List<Map<String, Object>> list(String userToken) {
        List<Map<String, Object>> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        String cursor = null;
        for (int page = 0; page < MAX_PAGES; page++) {
            String path = "/api/v1/me/research-projects?limit=" + PAGE_SIZE;
            if (cursor != null)
                path += "&cursor=" + URLEncoder.encode(cursor, StandardCharsets.UTF_8);
            JsonNode data =
                    fetch(path, userToken)
                            .orElseThrow(() -> unavailable("has no project list"));
            if (!data.path("items").isArray()) throw unavailable("returned no project list");
            data.path("items").forEach(n -> out.add(project(n)));
            cursor = data.hasNonNull("nextCursor") ? data.get("nextCursor").asText() : null;
            if (cursor == null || cursor.isEmpty()) return out;
            if (!seen.add(cursor)) throw unavailable("repeated a page cursor");
        }
        throw unavailable("returned too many pages");
    }

    @Override
    public Optional<Map<String, Object>> get(String userToken, String projectId) {
        return fetch(
                        "/api/v1/research-projects/"
                                + URLEncoder.encode(projectId, StandardCharsets.UTF_8),
                        userToken)
                .map(
                        n -> {
                            Map<String, Object> p = project(n);
                            List<Map<String, Object>> members = new ArrayList<>();
                            n.path("members")
                                    .forEach(
                                            m -> {
                                                Map<String, Object> x = new LinkedHashMap<>();
                                                x.put("name", m.path("name").asText(""));
                                                x.put("role", m.path("role").asText(""));
                                                members.add(x);
                                            });
                            p.put("members", members);
                            return p;
                        });
    }
}
