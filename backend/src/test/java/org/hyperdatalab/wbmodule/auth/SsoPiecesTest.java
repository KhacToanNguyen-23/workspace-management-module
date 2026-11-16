package org.hyperdatalab.wbmodule.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

class SsoPiecesTest {

    @Nested
    class Cipher {
        String key() {
            byte[] b = new byte[32];
            new SecureRandom().nextBytes(b);
            return Base64.getEncoder().encodeToString(b);
        }

        @Test
        void roundTripsAndHidesTheToken() {
            TokenCipher c = new TokenCipher(key(), false);
            String sealed = c.encrypt("at-secret");
            assertThat(sealed).doesNotContain("at-secret");
            assertThat(c.encrypt("at-secret")).isNotEqualTo(sealed);
            assertThat(c.decrypt(sealed)).isEqualTo("at-secret");
        }

        @Test
        void anotherKeyOrGarbageGivesNothing() {
            String sealed = new TokenCipher(key(), false).encrypt("at-secret");
            assertThat(new TokenCipher(key(), false).decrypt(sealed)).isNull();
            assertThat(new TokenCipher(key(), false).decrypt("not base64!")).isNull();
        }

        @Test
        void aKeyOfTheWrongSizeIsRefused() {
            assertThatThrownBy(
                            () ->
                                    new TokenCipher(
                                            Base64.getEncoder().encodeToString(new byte[16]),
                                            false))
                    .isInstanceOf(IllegalStateException.class);
        }
    }

    /** The project scope is asked for only once the SSO accepts it for this client. */
    @Nested
    class Scopes {
        HttpServer server;
        volatile boolean granted;
        volatile int checks;

        @BeforeEach
        void start() throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext(
                    "/oauth/authorize",
                    ex -> {
                        checks++;
                        String q = URLDecoder.decode(ex.getRequestURI().getRawQuery(), StandardCharsets.UTF_8);
                        boolean ok = granted || !q.contains("research_projects:read");
                        if (ok) {
                            ex.getResponseHeaders().add("Location", "https://example.org/login");
                            ex.sendResponseHeaders(302, -1);
                        } else {
                            byte[] b =
                                    "{\"success\":false,\"error\":{\"code\":\"INVALID_SCOPE\"}}"
                                            .getBytes(StandardCharsets.UTF_8);
                            ex.sendResponseHeaders(400, b.length);
                            ex.getResponseBody().write(b);
                        }
                        ex.close();
                    });
            server.start();
        }

        @AfterEach
        void stop() {
            if (server != null) server.stop(0);
        }

        SsoScopes scopes() {
            return new SsoScopes("http://127.0.0.1:" + server.getAddress().getPort(), "hd_x");
        }

        @Test
        void withoutTheGrantOnlyTheBaseScopesAreAsked() {
            granted = false;
            assertThat(scopes().forCallback("http://localhost:3000")).isEqualTo(SsoScopes.BASE);
        }

        @Test
        void onceGrantedTheProjectScopeIsAskedAndRemembered() {
            granted = true;
            SsoScopes s = scopes();

            assertThat(s.forCallback("http://localhost:3000"))
                    .isEqualTo(SsoScopes.BASE + " " + SsoScopes.PROJECTS);
            s.forCallback("http://localhost:3000");

            assertThat(checks).isEqualTo(1);
        }

        @Test
        void anUnreachableSsoMeansTheBaseScopes() {
            SsoScopes s = scopes();
            server.stop(0);
            server = null;
            assertThat(s.forCallback("http://localhost:3000")).isEqualTo(SsoScopes.BASE);
        }
    }
}
