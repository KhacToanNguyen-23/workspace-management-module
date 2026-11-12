package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

class WorkspaceApiTest extends IntegrationTest {
    private String pendingMembership(String workspaceId, String email) throws Exception {
        call("PUT", "/api/v1/workspaces/" + workspaceId + "/members/me", email, Map.of());
        return get("/api/v1/workspaces/" + workspaceId + "/members?status=pending", MANAGER)
                .body()
                .get(0)
                .path("id")
                .asText();
    }

    @Test
    void nonMemberCannotAccessWorkspace() throws Exception {
        String workspaceId = seedWorkspace("research");

        assertThat(get("/api/v1/workspaces/" + workspaceId, ALICE).code()).isEqualTo("not_member");
    }

    @Test
    void memberCanRequestToJoinWorkspace() throws Exception {
        String workspaceId = seedWorkspace("research");

        assertThat(
                        call("PUT",
                                        "/api/v1/workspaces/" + workspaceId + "/members/me",
                                        ALICE,
                                        Map.of("note", "hello"))
                                .status())
                .isEqualTo(201);
    }

    @Test
    void managerCanApproveJoinRequest() throws Exception {
        String workspaceId = seedWorkspace("research");
        String membershipId = pendingMembership(workspaceId, ALICE);

        assertThat(
                        call("PATCH",
                                        "/api/v1/workspaces/"
                                                + workspaceId
                                                + "/members/"
                                                + membershipId,
                                        MANAGER,
                                        Map.of("status", "approved"))
                                .status())
                .isEqualTo(200);
        assertThat(get("/api/v1/workspaces/" + workspaceId, ALICE).status()).isEqualTo(200);
    }

    @Test
    void managerCanRejectJoinRequest() throws Exception {
        String workspaceId = seedWorkspace("research");
        String membershipId = pendingMembership(workspaceId, ALICE);

        assertThat(
                        call("PATCH",
                                        "/api/v1/workspaces/"
                                                + workspaceId
                                                + "/members/"
                                                + membershipId,
                                        MANAGER,
                                        Map.of("status", "rejected", "note", "no"))
                                .status())
                .isEqualTo(200);
        assertThat(get("/api/v1/workspaces/" + workspaceId, ALICE).code()).isEqualTo("not_member");
    }

    @Test
    void memberCanWithdrawPendingJoinRequest() throws Exception {
        String workspaceId = seedWorkspace("research");
        pendingMembership(workspaceId, ALICE);

        assertThat(call("DELETE", "/api/v1/workspaces/" + workspaceId + "/members/me", ALICE, null).status())
                .isEqualTo(204);
    }

    @Test
    void adminAssigningMemberAsManagerPromotesTheMember() throws Exception {
        String workspaceId = seedWorkspace("research");
        var response =
                call(
                        "POST",
                        "/api/v1/workspaces/" + workspaceId + "/managers",
                        ADMIN,
                        Map.of("email", ALICE));

        assertThat(response.body().path("promoted").asBoolean()).isTrue();
        assertThat(get("/api/v1/me", ALICE).body().path("user").path("role").asText())
                .isEqualTo("workspace_manager");
        assertThat(get("/api/v1/audit-events", ADMIN).body().findValuesAsText("action"))
                .contains("user.role");
    }

    @Test
    void managerCannotApproveRequestsInAnotherWorkspace() throws Exception {
        String otherWorkspaceId = seedWorkspace("review");
        String membershipId = pendingMembership(otherWorkspaceId, BOB);

        assertThat(
                        call("PATCH",
                                        "/api/v1/workspaces/"
                                                + otherWorkspaceId
                                                + "/members/"
                                                + membershipId,
                                        ALICE,
                                        Map.of("status", "approved"))
                                .status())
                .isEqualTo(403);
    }
}
