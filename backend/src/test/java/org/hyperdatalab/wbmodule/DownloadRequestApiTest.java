package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

class DownloadRequestApiTest extends IntegrationTest {
    private String workspaceWithApprovedMember() throws Exception {
        String workspaceId = seedWorkspace("research");
        joinAndApprove(workspaceId, ALICE, "member");
        return workspaceId;
    }

    private String createRequest(String workspaceId) throws Exception {
        return call(
                        "POST",
                        "/api/w/" + workspaceId + "/download-requests",
                        ALICE,
                        Map.of("paperRef", "10.1/example"))
                .body()
                .path("id")
                .asText();
    }

    @Test
    void nonMemberCannotCreateDownloadRequest() throws Exception {
        String workspaceId = seedWorkspace("research");

        assertThat(createResponse(workspaceId).status()).isEqualTo(403);
    }

    private Res createResponse(String workspaceId) throws Exception {
        return call(
                "POST",
                "/api/w/" + workspaceId + "/download-requests",
                ALICE,
                Map.of("paperRef", "10.1/example"));
    }

    @Test
    void pendingMemberCannotCreateDownloadRequest() throws Exception {
        String workspaceId = seedWorkspace("research");
        call("POST", "/api/workspaces/" + workspaceId + "/join", ALICE, Map.of());

        assertThat(createResponse(workspaceId).code()).isEqualTo("pending_approval");
    }

    @Test
    void approvedMemberCanCreateDownloadRequest() throws Exception {
        String workspaceId = workspaceWithApprovedMember();

        assertThat(createResponse(workspaceId).status()).isEqualTo(201);
    }

    @Test
    void memberCanSeeOwnDownloadRequests() throws Exception {
        String workspaceId = workspaceWithApprovedMember();
        createRequest(workspaceId);

        assertThat(get("/api/w/" + workspaceId + "/download-requests/mine", ALICE).body())
                .hasSize(1);
    }

    @Test
    void memberCanWithdrawOwnPendingDownloadRequest() throws Exception {
        String workspaceId = workspaceWithApprovedMember();
        String requestId = createRequest(workspaceId);

        assertThat(
                        call(
                                        "DELETE",
                                        "/api/w/" + workspaceId + "/download-requests/" + requestId,
                                        ALICE,
                                        null)
                                .status())
                .isEqualTo(204);
    }

    @Test
    void managerCanListWorkspaceDownloadRequests() throws Exception {
        String workspaceId = workspaceWithApprovedMember();
        createRequest(workspaceId);

        assertThat(get("/api/w/" + workspaceId + "/download-requests", MANAGER).body()).hasSize(1);
    }

    @Test
    void memberCannotListAllWorkspaceDownloadRequests() throws Exception {
        String workspaceId = workspaceWithApprovedMember();

        assertThat(get("/api/w/" + workspaceId + "/download-requests", ALICE).status())
                .isEqualTo(403);
    }

    @Test
    void memberCannotApproveDownloadRequest() throws Exception {
        String workspaceId = workspaceWithApprovedMember();
        String requestId = createRequest(workspaceId);

        assertThat(
                        call(
                                        "POST",
                                        "/api/w/"
                                                + workspaceId
                                                + "/download-requests/"
                                                + requestId
                                                + "/approve",
                                        ALICE,
                                        Map.of())
                                .status())
                .isEqualTo(403);
    }

    @Test
    void managerCanApproveDownloadRequest() throws Exception {
        String workspaceId = workspaceWithApprovedMember();
        String requestId = createRequest(workspaceId);

        assertThat(
                        call(
                                        "POST",
                                        "/api/w/"
                                                + workspaceId
                                                + "/download-requests/"
                                                + requestId
                                                + "/approve",
                                        MANAGER,
                                        Map.of("note", "ok"))
                                .status())
                .isEqualTo(200);
    }

    @Test
    void managerCanRejectDownloadRequest() throws Exception {
        String workspaceId = workspaceWithApprovedMember();
        String requestId = createRequest(workspaceId);

        assertThat(
                        call(
                                        "POST",
                                        "/api/w/"
                                                + workspaceId
                                                + "/download-requests/"
                                                + requestId
                                                + "/reject",
                                        MANAGER,
                                        Map.of("note", "no"))
                                .status())
                .isEqualTo(200);
    }

    @Test
    void paperReferenceMustNotBeBlank() throws Exception {
        String workspaceId = workspaceWithApprovedMember();

        assertThat(
                        call(
                                        "POST",
                                        "/api/w/" + workspaceId + "/download-requests",
                                        ALICE,
                                        Map.of("paperRef", " "))
                                .status())
                .isIn(400, 422);
    }
}
