package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;

import org.hyperdatalab.wbmodule.common.Roles;
import org.hyperdatalab.wbmodule.directory.HttpUserDirectory;
import org.hyperdatalab.wbmodule.directory.UserDirectory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;

class UnitTests {

    @Nested
    class RoleModel {
        @Test
        void recognizesAdminAndWorkspaceManagers() {
            assertThat(Roles.canManageWorkspaces("admin")).isTrue();
            assertThat(Roles.canManageWorkspaces("workspace_manager")).isTrue();
            assertThat(Roles.canManageWorkspaces("member")).isFalse();
        }
    }

    /** The generic REST directory against a tiny local HTTP server. */
    @Nested
    class HttpDirectory {
        HttpServer server;
        String lastAuth;

        @BeforeEach
        void start() throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext(
                    "/users",
                    ex -> {
                        lastAuth = ex.getRequestHeaders().getFirst("authorization");
                        String path = ex.getRequestURI().getPath();
                        String body;
                        int status = 200;
                        if (path.equals("/users")) {
                            body =
                                    "{\"users\":[{\"email\":\"Alice@HyperDataLab.org\",\"name\":\"Alice\",\"department\":\"R&D\"},"
                                        + "{\"email\":\"old@hyperdatalab.org\",\"name\":\"Old\",\"suspended\":true}]}";
                        } else if (path.equals("/users/alice@hyperdatalab.org")) {
                            body =
                                    "{\"email\":\"alice@hyperdatalab.org\",\"name\":\"Alice\",\"photoUrl\":\"https://x/a.png\"}";
                        } else if (path.equals("/users/boom@hyperdatalab.org")) {
                            status = 500;
                            body = "oops";
                        } else {
                            status = 404;
                            body = "{}";
                        }
                        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                        ex.sendResponseHeaders(status, bytes.length);
                        ex.getResponseBody().write(bytes);
                        ex.close();
                    });
            server.start();
        }

        @AfterEach
        void stop() {
            server.stop(0);
        }

        HttpUserDirectory dir() {
            return new HttpUserDirectory(
                    new ObjectMapper(),
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/",
                    "secret",
                    "hyperdatalab.org");
        }

        @Test
        void findsAUserAndSendsTheToken() {
            UserDirectory.DirectoryUser u = dir().find("alice@hyperdatalab.org").orElseThrow();
            assertThat(u.name()).isEqualTo("Alice");
            assertThat(u.photoUrl()).isEqualTo("https://x/a.png");
            assertThat(u.suspended()).isFalse();
            assertThat(lastAuth).isEqualTo("Bearer secret");
        }

        @Test
        void unknownUserIsEmpty() {
            assertThat(dir().find("ghost@hyperdatalab.org")).isEmpty();
        }

        @Test
        void serverErrorsBecomeDirectoryErrors() {
            assertThatThrownBy(() -> dir().find("boom@hyperdatalab.org"))
                    .isInstanceOf(UserDirectory.DirectoryException.class);
        }

        @Test
        void listsUsersAndLowercasesEmails() {
            List<UserDirectory.DirectoryUser> all = dir().listAll();
            assertThat(all)
                    .extracting(UserDirectory.DirectoryUser::email)
                    .containsExactly("alice@hyperdatalab.org", "old@hyperdatalab.org");
            assertThat(all.get(1).suspended()).isTrue();
            assertThat(all.get(0).department()).isEqualTo("R&D");
        }
    }
}
