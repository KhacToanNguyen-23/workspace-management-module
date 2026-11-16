package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

class WorkspaceRequestApiTest extends IntegrationTest {
    private Map<String, Object> request(String name) {
        return Map.of(
                "name", name,
                "type", "research",
                "description", "work",
                "reason", "study");
    }

    private String requestId(String name) throws Exception {
        return call("POST", "/api/v1/workspace-requests", ALICE, request(name))
                .body()
                .path("id")
                .asText();
    }

    @Test
    void memberCanCreateWorkspaceRequest() throws Exception {
        var response = call("POST", "/api/v1/workspace-requests", ALICE, request("Alice Lab"));

        assertThat(response.status()).isEqualTo(201);
        assertThat(response.body().path("status").asText()).isEqualTo("pending");
    }

    @Test
    void memberCannotCreateTwoPendingRequests() throws Exception {
        requestId("Alice Lab");

        assertThat(call("POST", "/api/v1/workspace-requests", ALICE, request("Alice Lab 2")).code())
                .isEqualTo("already_pending");
    }

    @Test
    void memberCanWithdrawPendingRequestAndRetry() throws Exception {
        String id = requestId("Alice Lab");

        assertThat(call("DELETE", "/api/v1/workspace-requests/" + id, ALICE, null).status())
                .isEqualTo(204);
        assertThat(call("POST", "/api/v1/workspace-requests", ALICE, request("Alice Lab 2")).status())
                .isEqualTo(201);
    }

    @Test
    void adminApprovalPromotesRequesterAndCreatesManagedWorkspace() throws Exception {
        String id = requestId("Alice Lab");
        var response =
                call("PATCH", "/api/v1/workspace-requests/" + id, ADMIN, Map.of("status", "approved"));
        var me = get("/api/v1/me", ALICE).body();

        assertThat(response.status()).isEqualTo(200);
        assertThat(me.path("user").path("role").asText()).isEqualTo("workspace_manager");
        assertThat(me.path("memberships").get(0).path("role").asText()).isEqualTo("manager");
        assertThat(me.path("memberships").get(0).path("workspace").path("name").asText())
                .isEqualTo("Alice Lab");
    }

    @Test
    void adminCanRejectRequestWithoutCreatingWorkspace() throws Exception {
        String id = requestId("Alice Lab");
        var response =
                call("PATCH",
                        "/api/v1/workspace-requests/" + id,
                        ADMIN,
                        Map.of("status", "rejected", "note", "later"));

        assertThat(response.status()).isEqualTo(200);
        assertThat(get("/api/v1/workspaces?status=all", ADMIN).body()).isEmpty();
    }

    @Test
    void requestWithoutNameIsRejected() throws Exception {
        var response =
                call("POST", "/api/v1/workspace-requests", ALICE, Map.of("type", "research"));

        assertThat(response.status()).isEqualTo(422);
    }

    @Test
    void workspaceManagerCanCreateWorkspaceDirectly() throws Exception {
        String requestId = requestId("Alice Lab");
        call("PATCH", "/api/v1/workspace-requests/" + requestId, ADMIN, Map.of("status", "approved"));

        assertThat(
                        call(
                                        "POST",
                                        "/api/v1/workspaces",
                                        ALICE,
                                        Map.of(
                                                "name", "Second",
                                                "type", "review"))
                                .status())
                .isEqualTo(201);
    }

    @Test
    void memberCannotCreateWorkspaceDirectly() throws Exception {
        assertThat(
                        call(
                                        "POST",
                                        "/api/v1/workspaces",
                                        BOB,
                                        Map.of(
                                                "name", "No",
                                                "type", "research"))
                                .status())
                .isEqualTo(403);
    }
}
