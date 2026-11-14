package org.hyperdatalab.wbmodule.projects;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import org.hyperdatalab.wbmodule.common.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The ResearchPulse project API (EXTERNAL_RESEARCH_PROJECTS_API_VI.md), against a stand-in. */
class HttpProjectSourceTest {
    HttpServer server;
    /** Answer per request URI; missing = 404. */
    Map<String, String> bodies = new HashMap<>();
    int status = 200;
    String lastAuth;

    static void answer(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(status, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/v1",
                ex -> {
                    lastAuth = ex.getRequestHeaders().getFirst("authorization");
                    String body = bodies.get(ex.getRequestURI().toString());
                    answer(
                            ex,
                            body == null ? 404 : status,
                            body == null
                                    ? "{\"success\":false,\"error\":{\"code\":\"PROJECT_NOT_FOUND\"}}"
                                    : body);
                });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    HttpProjectSource source() {
        return new HttpProjectSource(
                new ObjectMapper(), "http://127.0.0.1:" + server.getAddress().getPort() + "/");
    }

    static final String LIST = "/api/v1/me/research-projects?limit=100";

    static String page(String id, String next) {
        return "{\"success\":true,\"data\":{\"items\":[{\"id\":\""
                + id
                + "\",\"title\":\"T "
                + id
                + "\",\"myRole\":\"MEMBER\",\"extra\":\"dropped\"}],\"nextCursor\":"
                + (next == null ? "null" : "\"" + next + "\"")
                + "}}";
    }

    @Test
    void listsEveryPageWithTheUsersToken() {
        bodies.put(LIST, page("p1", "c2"));
        bodies.put(LIST + "&cursor=c2", page("p2", null));

        List<Map<String, Object>> all = source().list("user-token");

        assertThat(all).extracting(p -> p.get("id")).containsExactly("p1", "p2");
        assertThat(all.get(0))
                .containsEntry("title", "T p1")
                .containsEntry("myRole", "MEMBER")
                .containsEntry("description", null)
                .doesNotContainKey("extra");
        assertThat(lastAuth).isEqualTo("Bearer user-token");
        assertThat(source().listsAll()).isFalse();
    }

    @Test
    void repeatedCursorIsAnError() {
        bodies.put(LIST, page("p1", "c2"));
        bodies.put(LIST + "&cursor=c2", page("p2", "c2"));
        assertThatThrownBy(() -> source().list("t"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.code()).isEqualTo("projects_unavailable"));
    }

    @Test
    void errorsTellTheUserWhatToDo() {
        bodies.put(LIST, "{\"success\":false}");
        for (var c :
                Map.of(
                                401, "sso_token_expired",
                                403, "scope_not_granted",
                                429, "rate_limited",
                                500, "projects_unavailable")
                        .entrySet()) {
            status = c.getKey();
            assertThatThrownBy(() -> source().list("t"))
                    .isInstanceOfSatisfying(
                            ApiException.class, e -> assertThat(e.code()).isEqualTo(c.getValue()));
        }
    }

    @Test
    void detailCarriesMembersAndAnUnknownProjectIsEmpty() {
        bodies.put(
                "/api/v1/research-projects/p1",
                "{\"success\":true,\"data\":{\"id\":\"p1\",\"title\":\"One\",\"myRole\":\"OWNER\","
                        + "\"members\":[{\"name\":\"A\",\"role\":\"OWNER\"}]}}");

        Map<String, Object> p = source().get("t", "p1").orElseThrow();

        assertThat(p).containsEntry("title", "One").containsEntry("myRole", "OWNER");
        assertThat(p.get("members")).isEqualTo(List.of(Map.of("name", "A", "role", "OWNER")));
        assertThat(source().get("t", "nope")).isEmpty();
    }

    @Test
    void theApiIsReadOnly() {
        assertThat(source().managesMembers()).isFalse();
        assertThatThrownBy(() -> source().addMember("p1", "a@hyperdatalab.org", "MEMBER", "x"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.status()).isEqualTo(HttpStatus.NOT_IMPLEMENTED));
    }
}
