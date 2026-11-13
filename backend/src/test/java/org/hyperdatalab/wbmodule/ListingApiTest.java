package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

/** Lists must work once records exist, and must carry the dates stored with them. */
class ListingApiTest extends IntegrationTest {
    @Test
    void memberSeesExistingWorkspacesWithManagersAndOwnStatus() throws Exception {
        String wid = seedWorkspace("research");
        call("PUT", "/api/v1/workspaces/" + wid + "/members/me", ALICE, Map.of("note", "hi"));

        var response = get("/api/v1/workspaces", ALICE);

        assertThat(response.status()).isEqualTo(200);
        assertThat(response.body()).hasSize(1);
        var workspace = response.body().get(0);
        assertThat(workspace.path("name").asText()).isEqualTo("Writing Lab research");
        assertThat(workspace.path("managers").get(0).asText()).isEqualTo(MANAGER);
        assertThat(workspace.path("myStatus").asText()).isEqualTo("pending");
        assertThat(workspace.path("createdAt").asText()).startsWith("20");
    }

    @Test
    void adminSeesExistingWorkspacesWithCreationDate() throws Exception {
        seedWorkspace("review");

        var response = get("/api/v1/workspaces?status=all", ADMIN);

        assertThat(response.status()).isEqualTo(200);
        assertThat(response.body()).hasSize(1);
        assertThat(response.body().get(0).path("createdAt").asText()).startsWith("20");
    }

    @Test
    void joinRequestsKeepTheirRequestAndDecisionDates() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");

        var members = get("/api/v1/workspaces/" + wid + "/members?status=approved", MANAGER).body();
        var alice = members.get(0).path("email").asText().equals(ALICE) ? members.get(0) : members.get(1);

        assertThat(alice.path("requestedAt").asText()).startsWith("20");
        assertThat(alice.path("decidedAt").asText()).startsWith("20");
        assertThat(get("/api/v1/me", ALICE).body().path("memberships").get(0).path("requestedAt").asText())
                .startsWith("20");
    }

    @Test
    void downloadRequestsKeepTheirRequestDate() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");
        call("POST", "/api/v1/workspaces/" + wid + "/download-requests", ALICE, Map.of("paperRef", "doi:1"));

        var mine = get("/api/v1/workspaces/" + wid + "/download-requests?requester=me", ALICE).body();
        var queue = get("/api/v1/workspaces/" + wid + "/download-requests", MANAGER).body();

        assertThat(mine.get(0).path("requestedAt").asText()).startsWith("20");
        assertThat(queue.get(0).path("requestedAt").asText()).startsWith("20");
    }

    @Test
    void workspaceRequestsKeepTheirRequestDate() throws Exception {
        call(
                "POST",
                "/api/v1/workspace-requests",
                ALICE,
                Map.of("name", "Alice Lab", "type", "research"));

        var mine = get("/api/v1/workspace-requests?requester=me", ALICE).body();
        var queue = get("/api/v1/workspace-requests?status=pending", ADMIN).body();

        assertThat(mine.get(0).path("requestedAt").asText()).startsWith("20");
        assertThat(queue.get(0).path("requestedAt").asText()).startsWith("20");
    }
}
