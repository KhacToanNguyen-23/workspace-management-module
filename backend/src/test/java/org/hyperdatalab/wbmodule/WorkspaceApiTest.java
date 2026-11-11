package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

class WorkspaceApiTest extends IntegrationTest {
    private String pendingMembership(String workspaceId, String email) throws Exception {
        call("POST", "/api/workspaces/" + workspaceId + "/join", email, Map.of());
        return get("/api/w/" + workspaceId + "/members?status=pending", MANAGER)
                .body()
                .get(0)
                .path("id")
                .asText();
    }

    @Test
    void nonMemberCannotAccessWorkspace() throws Exception {
        String workspaceId = seedWorkspace("research");

        assertThat(get("/api/w/" + workspaceId, ALICE).code()).isEqualTo("not_member");
    }

    @Test
    void memberCanRequestToJoinWorkspace() throws Exception {
        String workspaceId = seedWorkspace("research");

        assertThat(
                        call(
                                        "POST",
                                        "/api/workspaces/" + workspaceId + "/join",
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
                        call(
                                        "POST",
                                        "/api/w/"
                                                + workspaceId
                                                + "/members/"
                                                + membershipId
                                                + "/approve",
                                        MANAGER,
                                        Map.of())
                                .status())
                .isEqualTo(200);
        assertThat(get("/api/w/" + workspaceId, ALICE).status()).isEqualTo(200);
    }

    @Test
    void managerCanRejectJoinRequest() throws Exception {
        String workspaceId = seedWorkspace("research");
        String membershipId = pendingMembership(workspaceId, ALICE);

        assertThat(
                        call(
                                        "POST",
                                        "/api/w/"
                                                + workspaceId
                                                + "/members/"
                                                + membershipId
                                                + "/reject",
                                        MANAGER,
                                        Map.of("note", "no"))
                                .status())
                .isEqualTo(200);
        assertThat(get("/api/w/" + workspaceId, ALICE).code()).isEqualTo("not_member");
    }

    @Test
    void memberCanWithdrawPendingJoinRequest() throws Exception {
        String workspaceId = seedWorkspace("research");
        pendingMembership(workspaceId, ALICE);

        assertThat(call("DELETE", "/api/workspaces/" + workspaceId + "/join", ALICE, null).status())
                .isEqualTo(204);
    }

    @Test
    void adminAssigningMemberAsManagerPromotesTheMember() throws Exception {
        String workspaceId = seedWorkspace("research");
        var response =
                call(
                        "POST",
                        "/api/admin/workspaces/" + workspaceId + "/managers",
                        ADMIN,
                        Map.of("email", ALICE));

        assertThat(response.body().path("promoted").asBoolean()).isTrue();
        assertThat(get("/api/me", ALICE).body().path("user").path("role").asText())
                .isEqualTo("workspace_manager");
        assertThat(get("/api/admin/audit", ADMIN).body().findValuesAsText("action"))
                .contains("user.role");
    }

    @Test
    void managerCannotApproveRequestsInAnotherWorkspace() throws Exception {
        String otherWorkspaceId = seedWorkspace("review");
        String membershipId = pendingMembership(otherWorkspaceId, BOB);

        assertThat(
                        call(
                                        "POST",
                                        "/api/w/"
                                                + otherWorkspaceId
                                                + "/members/"
                                                + membershipId
                                                + "/approve",
                                        ALICE,
                                        Map.of())
                                .status())
                .isEqualTo(403);
    }
}
