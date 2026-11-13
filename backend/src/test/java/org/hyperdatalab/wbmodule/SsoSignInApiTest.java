package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
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
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/** Signing in through the HyperDataLab SSO, against a local stand-in for the SSO Worker. */
@SpringBootTest(
        properties = {
            "app.auth.mode=sso",
            "app.auth.sso.client-id=hd_test",
            "app.auth.sso.client-secret=hds_secret",
            "app.auth.sso.session-hours=12"
        })
class SsoSignInApiTest extends IntegrationTest {
    static final String CALLBACK = "http://localhost:3000/auth/callback";
    static final String VERIFIER = "v".repeat(43);

    static HttpServer sso;
    /** The form our backend last posted to /oauth/token. */
    static Map<String, String> tokenForm = new HashMap<>();
    /** What /oauth/userinfo answers for the access token "at-1". */
    static String profile;

    @DynamicPropertySource
    static void ssoServer(DynamicPropertyRegistry registry) throws IOException {
        sso = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        sso.createContext(
                "/oauth/token",
                ex -> {
                    Map<String, String> form = new HashMap<>();
                    for (String pair :
                            new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)
                                    .split("&")) {
                        String[] kv = pair.split("=", 2);
                        form.put(kv[0], URLDecoder.decode(kv[1], StandardCharsets.UTF_8));
                    }
                    tokenForm = form;
                    if ("good".equals(form.get("code")))
                        answer(ex, 200, "{\"access_token\":\"at-1\",\"token_type\":\"Bearer\"}");
                    else answer(ex, 400, "{\"error\":\"INVALID_AUTHORIZATION_REQUEST\"}");
                });
        sso.createContext(
                "/oauth/userinfo",
                ex -> {
                    if ("Bearer at-1".equals(ex.getRequestHeaders().getFirst("authorization")))
                        answer(ex, 200, profile);
                    else answer(ex, 401, "{\"error\":\"INVALID_TOKEN\"}");
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
    void defaultProfile() {
        profile =
                "{\"sub\":\"uid-1\",\"email\":\"Alice@hyperdatalab.org\",\"email_verified\":true,"
                        + "\"name\":\"Alice Nguyen\",\"picture\":\"https://x/a.png\","
                        + "\"role\":\"STUDENT\",\"student_id\":\"SE123456\","
                        + "\"major\":\"Software Engineering\"}";
    }

    private Res send(String method, String path, String bearer, Object body) throws Exception {
        MockHttpServletRequestBuilder req =
                MockMvcRequestBuilders.request(HttpMethod.valueOf(method), URI.create(path));
        if (bearer != null) req.header("Authorization", "Bearer " + bearer);
        if (body != null)
            req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        MvcResult r = mvc.perform(req).andReturn();
        String text = r.getResponse().getContentAsString();
        return new Res(
                r.getResponse().getStatus(),
                text.isEmpty() ? json.nullNode() : json.readTree(text),
                Map.of());
    }

    private Res signIn(String code, String redirectUri) throws Exception {
        return send(
                "POST",
                "/api/v1/sessions",
                null,
                Map.of("code", code, "codeVerifier", VERIFIER, "redirectUri", redirectUri));
    }

    @Test
    void signInExchangesTheCodeAndOpensASession() throws Exception {
        Res r = signIn("good", CALLBACK);

        assertThat(r.status()).isEqualTo(201);
        assertThat(r.body().path("user").path("email").asText()).isEqualTo(ALICE);
        assertThat(r.body().path("user").path("name").asText()).isEqualTo("Alice Nguyen");
        assertThat(tokenForm)
                .containsEntry("grant_type", "authorization_code")
                .containsEntry("client_id", "hd_test")
                .containsEntry("client_secret", "hds_secret")
                .containsEntry("code_verifier", VERIFIER)
                .containsEntry("redirect_uri", CALLBACK);

        String token = r.body().path("token").asText();
        Res me = send("GET", "/api/v1/me", token, null);
        assertThat(me.status()).isEqualTo(200);
        assertThat(me.body().toString()).contains(ALICE);

        Map<String, Object> user = store.get("users", ALICE).orElseThrow();
        assertThat(user)
                .containsEntry("authUid", "uid-1")
                .containsEntry("name", "Alice Nguyen")
                .containsEntry("department", "Software Engineering")
                .containsEntry("studentId", "SE123456")
                .containsEntry("ssoRole", "STUDENT")
                .containsEntry("directoryStatus", "active")
                .containsEntry("role", "member");
        // Only the hash of the token is stored.
        assertThat(store.all("sessions")).hasSize(1);
        assertThat(store.all("sessions").get(0).getId()).doesNotContain(token);
    }

    @Test
    void aRefusedCodeOpensNoSession() throws Exception {
        Res r = signIn("used", CALLBACK);

        assertThat(r.status()).isEqualTo(401);
        assertThat(r.code()).isEqualTo("sso_rejected");
        assertThat(store.all("sessions")).isEmpty();
    }

    @Test
    void aCallbackOutsideThisAppIsRefusedBeforeCallingTheSso() throws Exception {
        tokenForm = new HashMap<>();

        Res r = signIn("good", "https://evil.example/auth/callback");

        assertThat(r.status()).isEqualTo(422);
        assertThat(r.code()).isEqualTo("invalid_redirect");
        assertThat(tokenForm).isEmpty();
    }

    @Test
    void anAccountOfAnotherDomainIsRefused() throws Exception {
        profile = "{\"sub\":\"uid-9\",\"email\":\"eve@example.com\",\"email_verified\":true}";

        Res r = signIn("good", CALLBACK);

        assertThat(r.status()).isEqualTo(403);
        assertThat(r.code()).isEqualTo("wrong_domain");
        assertThat(store.all("sessions")).isEmpty();
    }

    @Test
    void anUnverifiedEmailIsRefused() throws Exception {
        profile = "{\"sub\":\"uid-1\",\"email\":\"alice@hyperdatalab.org\"}";

        Res r = signIn("good", CALLBACK);

        assertThat(r.status()).isEqualTo(403);
        assertThat(r.code()).isEqualTo("unverified");
    }

    @Test
    void aUserDisabledHereCannotSignIn() throws Exception {
        FirestoreStore.await(
                store.doc("users", ALICE).set(Map.of("email", ALICE, "disabled", true)));

        Res r = signIn("good", CALLBACK);

        assertThat(r.status()).isEqualTo(403);
        assertThat(r.code()).isEqualTo("disabled");
        assertThat(store.all("sessions")).isEmpty();
    }

    @Test
    void signingOutEndsTheSession() throws Exception {
        String token = signIn("good", CALLBACK).body().path("token").asText();

        assertThat(send("DELETE", "/api/v1/sessions/current", token, null).status())
                .isEqualTo(204);
        assertThat(send("GET", "/api/v1/me", token, null).status()).isEqualTo(401);
    }

    @Test
    void anExpiredSessionIsRefusedAndRemoved() throws Exception {
        String token = signIn("good", CALLBACK).body().path("token").asText();
        var session = store.all("sessions").get(0).getReference();
        FirestoreStore.await(
                session.update(
                        "expiresAt",
                        Timestamp.of(new Date(System.currentTimeMillis() - 1000))));

        Res me = send("GET", "/api/v1/me", token, null);

        assertThat(me.status()).isEqualTo(401);
        assertThat(me.code()).isEqualTo("invalid_token");
        assertThat(store.all("sessions")).isEmpty();
    }

    @Test
    void anUnknownTokenIsRefused() throws Exception {
        JsonNode body = send("GET", "/api/v1/me", "wbs_not-a-session", null).body();

        assertThat(body.path("error").path("code").asText()).isEqualTo("invalid_token");
    }
}
