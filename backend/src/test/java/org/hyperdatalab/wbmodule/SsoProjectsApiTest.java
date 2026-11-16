package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.cloud.Timestamp;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Projects read from ResearchPulse with the user's own SSO token (PROJECTS_MODE=auto with the
 * SSO), against a local stand-in for the ResearchPulse Worker.
 */
@SpringBootTest(
        properties = {
            "app.auth.mode=sso",
            "app.auth.sso.client-id=hd_test",
            "app.auth.sso.token-key=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
        })
class SsoProjectsApiTest extends IntegrationTest {
    static final String CALLBACK = "http://localhost:3000/auth/callback";
    static final String SCOPED = "email profile hyperdatalab_profile research_projects:read";

    static HttpServer sso;
    /** Scope /oauth/token grants. */
    static volatile String grantedScope = SCOPED;
    static volatile String lastProjectAuth;

    @DynamicPropertySource
    static void ssoServer(DynamicPropertyRegistry registry) throws IOException {
        sso = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        sso.createContext(
                "/oauth/authorize",
                ex -> {
                    ex.getResponseHeaders().add("Location", "https://example.org/login");
                    ex.sendResponseHeaders(302, -1);
                    ex.close();
                });
        sso.createContext(
                "/oauth/token",
                ex ->
                        answer(
                                ex,
                                200,
                                "{\"access_token\":\"at-1\",\"expires_in\":3600,\"scope\":\""
                                        + grantedScope
                                        + "\"}"));
        sso.createContext(
                "/oauth/userinfo",
                ex ->
                        answer(
                                ex,
                                200,
                                "{\"sub\":\"uid-1\",\"email\":\"admin@hyperdatalab.org\","
                                        + "\"email_verified\":true,\"name\":\"Admin\"}"));
        sso.createContext(
                "/api/v1",
                ex -> {
                    lastProjectAuth = ex.getRequestHeaders().getFirst("authorization");
                    String path = ex.getRequestURI().getPath();
                    if (!"Bearer at-1".equals(lastProjectAuth))
                        answer(ex, 401, "{\"success\":false}");
                    else if (path.equals("/api/v1/me/research-projects"))
                        answer(
                                ex,
                                200,
                                "{\"success\":true,\"data\":{\"items\":[{\"id\":\"p1\","
                                        + "\"title\":\"WritingBank\",\"myRole\":\"OWNER\"}],"
                                        + "\"nextCursor\":null}}");
                    else if (path.equals("/api/v1/research-projects/p1"))
                        answer(
                                ex,
                                200,
                                "{\"success\":true,\"data\":{\"id\":\"p1\",\"title\":\"WritingBank\","
                                        + "\"members\":[{\"name\":\"Admin\",\"role\":\"OWNER\"}]}}");
                    else answer(ex, 404, "{\"success\":false}");
                });
        sso.start();
        registry.add(
                "app.auth.sso.base-url", () -> "http://127.0.0.1:" + sso.getAddress().getPort());
    }

    static void answer(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(status, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    @AfterAll
    static void stopSso() {
        sso.stop(0);
    }

    @BeforeEach
    void reset() {
        grantedScope = SCOPED;
        lastProjectAuth = null;
    }

    private Res send(String method, String path, String bearer, Object body) throws Exception {
        MockHttpServletRequestBuilder req =
                MockMvcRequestBuilders.request(HttpMethod.valueOf(method), URI.create(path));
        if (bearer != null) req.header("Authorization", "Bearer " + bearer);
        if (body != null)
            req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        MvcResult r = mvc.perform(req).andReturn();
        String text = r.getResponse().getContentAsString();
        Map<String, String> headers = new HashMap<>();
        for (String name : r.getResponse().getHeaderNames())
            headers.put(name.toLowerCase(Locale.ROOT), r.getResponse().getHeader(name));
        return new Res(
                r.getResponse().getStatus(),
                text.isEmpty() ? json.nullNode() : json.readTree(text),
                headers);
    }

    private String signIn() throws Exception {
        Res r =
                send(
                        "POST",
                        "/api/v1/sessions",
                        null,
                        Map.of(
                                "code", "c",
                                "codeVerifier", "v".repeat(43),
                                "redirectUri", CALLBACK));
        assertThat(r.status()).isEqualTo(201);
        return r.body().path("token").asText();
    }

    @Test
    void theWebAppIsToldToAskForTheProjectScopeOnceItIsGranted() throws Exception {
        Res r = send("GET", "/api/v1/sessions/options?redirectUri=" + CALLBACK, null, null);

        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body().path("scope").asText()).contains("research_projects:read");
        assertThat(
                        send(
                                        "GET",
                                        "/api/v1/sessions/options?redirectUri=https://evil.example/cb",
                                        null,
                                        null)
                                .status())
                .isEqualTo(422);
    }

    @Test
    void projectsAreReadWithTheUsersOwnTokenKeptEncrypted() throws Exception {
        String token = signIn();

        Res list = send("GET", "/api/v1/projects", token, null);
        assertThat(list.status()).isEqualTo(200);
        assertThat(list.header("Cache-Control")).contains("no-store").contains("private");
        assertThat(list.body().path("mode").asText()).isEqualTo("http");
        assertThat(list.body().path("listsAll").asBoolean()).isFalse();
        assertThat(list.body().path("items").get(0).path("title").asText())
                .isEqualTo("WritingBank");
        assertThat(lastProjectAuth).isEqualTo("Bearer at-1");

        Res p = send("GET", "/api/v1/projects/p1", token, null);
        assertThat(p.body().path("members").get(0).path("name").asText()).isEqualTo("Admin");

        Object kept = FirestoreStore.raw(store.all("sessions").get(0)).get("ssoToken");
        assertThat(kept).isInstanceOf(String.class);
        assertThat(String.valueOf(kept)).doesNotContain("at-1");
    }

    @Test
    void afterAnHourTheUserIsAskedToSignInAgain() throws Exception {
        String token = signIn();
        FirestoreStore.await(
                store.all("sessions")
                        .get(0)
                        .getReference()
                        .update(
                                "ssoTokenExpiresAt",
                                Timestamp.of(new Date(System.currentTimeMillis() - 1000))));

        Res r = send("GET", "/api/v1/projects", token, null);

        assertThat(r.status()).isEqualTo(409);
        assertThat(r.code()).isEqualTo("sso_token_expired");
        assertThat(send("GET", "/api/v1/me", token, null).status()).isEqualTo(200);
    }

    @Test
    void withoutTheProjectScopeNothingIsKeptOrCalled() throws Exception {
        grantedScope = "email profile hyperdatalab_profile";
        String token = signIn();

        Res r = send("GET", "/api/v1/projects", token, null);

        assertThat(FirestoreStore.raw(store.all("sessions").get(0))).doesNotContainKey("ssoToken");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.code()).isEqualTo("scope_not_granted");
        assertThat(lastProjectAuth).isNull();
    }

    @Test
    void membersCannotBeChangedThroughTheReadOnlyApi() throws Exception {
        String token = signIn(); // admin@ is this module's admin

        Res list = send("GET", "/api/v1/projects", token, null);
        assertThat(list.body().path("canManageMembers").asBoolean()).isFalse();
        Res add =
                send(
                        "POST",
                        "/api/v1/projects/p1/members",
                        token,
                        Map.of("email", "bob@hyperdatalab.org", "role", "MEMBER"));
        assertThat(add.status()).isEqualTo(501);
        assertThat(add.code()).isEqualTo("not_supported");
    }
}
