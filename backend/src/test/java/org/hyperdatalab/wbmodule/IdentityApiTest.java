package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

class IdentityApiTest extends IntegrationTest {

    @Test
    void rejectsRequestsWithoutToken() throws Exception {
        assertThat(get("/api/v1/me", null).status()).isEqualTo(401);
    }

    @Test
    void unauthorizedResponsesFollowRfc6750() throws Exception {
        var res =
                mvc.perform(
                                org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                                        .get("/api/v1/me"))
                        .andReturn()
                        .getResponse();
        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(res.getHeader("WWW-Authenticate")).startsWith("Bearer ");
        assertThat(res.getHeader("Cache-Control")).isEqualTo("no-store");
    }

    @Test
    void healthNeedsNoToken() throws Exception {
        assertThat(get("/api/health", null).status()).isEqualTo(200);
    }

    @Test
    void rejectsAccountsOutsideTheOrgDomain() throws Exception {
        Res r = get("/api/v1/me", "eve@gmail.com");
        assertThat(r.status()).isEqualTo(403);
        assertThat(r.code()).isEqualTo("wrong_domain");
    }

    @Test
    void rejectsDomainAddressesNotInTheDirectory() throws Exception {
        Res r = get("/api/v1/me", "ghost@hyperdatalab.org");
        assertThat(r.code()).isEqualTo("not_in_directory");
        // The attempt is still recorded so an admin can see it.
        assertThat(
                        store.get("users", "ghost@hyperdatalab.org")
                                .orElseThrow()
                                .get("directoryStatus"))
                .isEqualTo("missing");
    }

    @Test
    void rejectsSuspendedDirectoryUsers() throws Exception {
        assertThat(get("/api/v1/me", "gone@hyperdatalab.org").code()).isEqualTo("suspended");
    }

    @Test
    void firstSignInCreatesTheUserFromDirectoryData() throws Exception {
        Res r = get("/api/v1/me", ALICE);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body().path("user").path("name").asText()).isEqualTo("Alice Nguyen");
        assertThat(r.body().path("user").path("department").asText()).isEqualTo("/research");
        assertThat(r.body().path("user").path("isAdmin").asBoolean()).isFalse();
        assertThat(r.body().path("user").path("role").asText()).isEqualTo("member");
        assertThat(r.body().path("memberships")).isEmpty();
    }

    @Test
    void domainAdminIsAlwaysAdmin() throws Exception {
        assertThat(get("/api/v1/me", ADMIN).body().path("user").path("isAdmin").asBoolean()).isTrue();
    }

    @Test
    void nonAdminCannotUseAdminEndpoints() throws Exception {
        assertThat(get("/api/v1/users", ALICE).status()).isEqualTo(403);
    }

    @Test
    void adminSyncsTheDirectoryAndFiltersUsers() throws Exception {
        Res sync = call("POST", "/api/v1/directory-syncs", ADMIN, null);
        assertThat(sync.body().path("listed").asInt()).isEqualTo(5);
        assertThat(sync.body().path("mode").asText()).isEqualTo("mock");
        assertThat(get("/api/v1/users?q=bob", ADMIN).body().get(0).path("email").asText())
                .isEqualTo(BOB);
    }

    @Test
    void adminCanPromoteAnotherAdmin() throws Exception {
        get("/api/v1/me", BOB);
        call("PATCH", "/api/v1/users/" + BOB, ADMIN, Map.of("role", "admin"));
        assertThat(get("/api/v1/users", BOB).status()).isEqualTo(200);
    }

    @Test
    void domainAdminAccountIsProtected() throws Exception {
        get("/api/v1/me", ADMIN);
        assertThat(
                        call("PATCH", "/api/v1/users/" + ADMIN, ADMIN, Map.of("disabled", true))
                                .status())
                .isEqualTo(409);
    }

    @Test
    void adminRefreshesOneUserFromTheDirectory() throws Exception {
        Res r = call("POST", "/api/v1/users/" + BOB + "/directory-refreshes", ADMIN, null);
        assertThat(r.body().path("directoryStatus").asText()).isEqualTo("active");
        assertThat(
                        call("POST", "/api/v1/users/ghost@hyperdatalab.org/directory-refreshes", ADMIN, null)
                                .body()
                                .path("directoryStatus")
                                .asText())
                .isEqualTo("missing");
    }

    @Test
    void auditRecordsFirstSignIn() throws Exception {
        get("/api/v1/me", ALICE);
        Res audit = get("/api/v1/audit-events", ADMIN);
        assertThat(audit.body().findValuesAsText("action")).contains("user.first_sign_in");
    }
}
