package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

/** Lists must work once records exist, and must carry the dates stored with them. */
class ListingApiTest extends IntegrationTest {
    @Test
    void memberSeesExistingWorkspacesWithManagersAndOwnStatus() throws Exception {
        String wid = seedWorkspace("research");
        call("POST", "/api/workspaces/" + wid + "/join", ALICE, Map.of("note", "hi"));

        var response = get("/api/workspaces", ALICE);

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

        var response = get("/api/admin/workspaces", ADMIN);

        assertThat(response.status()).isEqualTo(200);
        assertThat(response.body()).hasSize(1);
        assertThat(response.body().get(0).path("createdAt").asText()).startsWith("20");
    }

    @Test
    void joinRequestsKeepTheirRequestAndDecisionDates() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");

        var members = get("/api/w/" + wid + "/members?status=approved", MANAGER).body();
        var alice = members.get(0).path("email").asText().equals(ALICE) ? members.get(0) : members.get(1);

        assertThat(alice.path("requestedAt").asText()).startsWith("20");
        assertThat(alice.path("decidedAt").asText()).startsWith("20");
        assertThat(get("/api/me", ALICE).body().path("memberships").get(0).path("requestedAt").asText())
                .startsWith("20");
    }

    @Test
    void downloadRequestsKeepTheirRequestDate() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");
        call("POST", "/api/w/" + wid + "/download-requests", ALICE, Map.of("paperRef", "doi:1"));

        var mine = get("/api/w/" + wid + "/download-requests/mine", ALICE).body();
        var queue = get("/api/w/" + wid + "/download-requests", MANAGER).body();

        assertThat(mine.get(0).path("requestedAt").asText()).startsWith("20");
        assertThat(queue.get(0).path("requestedAt").asText()).startsWith("20");
    }

    @Test
    void workspaceRequestsKeepTheirRequestDate() throws Exception {
        call(
                "POST",
                "/api/workspace-requests",
                ALICE,
                Map.of("name", "Alice Lab", "type", "research"));

        var mine = get("/api/workspace-requests/mine", ALICE).body();
        var queue = get("/api/admin/workspace-requests?status=pending", ADMIN).body();

        assertThat(mine.get(0).path("requestedAt").asText()).startsWith("20");
        assertThat(queue.get(0).path("requestedAt").asText()).startsWith("20");
    }
}
