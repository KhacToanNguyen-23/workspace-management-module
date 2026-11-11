package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

class WorkspaceRequestApiTest extends IntegrationTest {
    private Map<String, Object> request(String slug) {
        return Map.of(
                "name", "Alice Lab",
                "slug", slug,
                "type", "research",
                "description", "work",
                "reason", "study");
    }

    private String requestId(String slug) throws Exception {
        return call("POST", "/api/workspace-requests", ALICE, request(slug))
                .body()
                .path("id")
                .asText();
    }

    @Test
    void memberCanCreateWorkspaceRequest() throws Exception {
        var response = call("POST", "/api/workspace-requests", ALICE, request("alice-lab"));

        assertThat(response.status()).isEqualTo(201);
        assertThat(response.body().path("status").asText()).isEqualTo("pending");
    }

    @Test
    void memberCannotCreateTwoPendingRequests() throws Exception {
        requestId("alice-lab");

        assertThat(call("POST", "/api/workspace-requests", ALICE, request("alice-lab-2")).code())
                .isEqualTo("already_pending");
    }

    @Test
    void memberCanWithdrawPendingRequestAndRetry() throws Exception {
        String id = requestId("alice-lab");

        assertThat(call("DELETE", "/api/workspace-requests/" + id, ALICE, null).status())
                .isEqualTo(204);
        assertThat(call("POST", "/api/workspace-requests", ALICE, request("alice-lab-2")).status())
                .isEqualTo(201);
    }

    @Test
    void adminApprovalPromotesRequesterAndCreatesManagedWorkspace() throws Exception {
        String id = requestId("alice-lab");
        var response =
                call("POST", "/api/admin/workspace-requests/" + id + "/approve", ADMIN, Map.of());
        var me = get("/api/me", ALICE).body();

        assertThat(response.status()).isEqualTo(200);
        assertThat(me.path("user").path("role").asText()).isEqualTo("workspace_manager");
        assertThat(me.path("memberships").get(0).path("role").asText()).isEqualTo("manager");
        assertThat(me.path("memberships").get(0).path("workspace").path("slug").asText())
                .isEqualTo("alice-lab");
    }

    @Test
    void adminCanRejectRequestWithoutCreatingWorkspace() throws Exception {
        String id = requestId("alice-lab");
        var response =
                call(
                        "POST",
                        "/api/admin/workspace-requests/" + id + "/reject",
                        ADMIN,
                        Map.of("note", "later"));

        assertThat(response.status()).isEqualTo(200);
        assertThat(get("/api/admin/workspaces", ADMIN).body()).isEmpty();
    }

    @Test
    void twoPendingRequestsCannotUseTheSameSlug() throws Exception {
        requestId("alice-lab");

        assertThat(call("POST", "/api/workspace-requests", BOB, request("alice-lab")).code())
                .isEqualTo("duplicate");
    }

    @Test
    void workspaceManagerCanCreateWorkspaceDirectly() throws Exception {
        String requestId = requestId("alice-lab");
        call("POST", "/api/admin/workspace-requests/" + requestId + "/approve", ADMIN, Map.of());

        assertThat(
                        call(
                                        "POST",
                                        "/api/workspaces",
                                        ALICE,
                                        Map.of(
                                                "name", "Second",
                                                "slug", "alice-second",
                                                "type", "review"))
                                .status())
                .isEqualTo(201);
    }

    @Test
    void memberCannotCreateWorkspaceDirectly() throws Exception {
        assertThat(
                        call(
                                        "POST",
                                        "/api/workspaces",
                                        BOB,
                                        Map.of(
                                                "name", "No",
                                                "slug", "no-workspace",
                                                "type", "research"))
                                .status())
                .isEqualTo(403);
    }
}
