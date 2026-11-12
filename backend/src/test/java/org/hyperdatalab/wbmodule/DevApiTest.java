package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;

import org.hyperdatalab.wbmodule.dev.DevData;
import org.junit.jupiter.api.Test;

import java.util.Map;

/** The dev-only demo data: one account per role and state, ready to use after a reset. */
class DevApiTest extends IntegrationTest {
    private static final String DEMO = "/api/w/" + DevData.WORKSPACE_ID;

    private JsonNode account(String email) throws Exception {
        for (JsonNode a : get("/api/dev/accounts", null).body()) {
            if (a.path("email").asText().equals(email)) return a;
        }
        throw new AssertionError("no demo account " + email);
    }

    @Test
    void accountsAreListedWithoutSigningIn() throws Exception {
        var response = get("/api/dev/accounts", null);

        assertThat(response.status()).isEqualTo(200);
        assertThat(response.body()).hasSize(DevData.ACCOUNTS.size());
        assertThat(account(MANAGER).path("seeded").asBoolean()).isFalse();
    }

    @Test
    void resetSeedsOneAccountPerRole() throws Exception {
        assertThat(call("POST", "/api/dev/reset", null, null).status()).isEqualTo(200);

        assertThat(get("/api/me", ADMIN).body().path("user").path("role").asText())
                .isEqualTo("admin");
        assertThat(get("/api/me", MANAGER).body().path("user").path("role").asText())
                .isEqualTo("workspace_manager");
        assertThat(get("/api/me", ALICE).body().path("user").path("role").asText())
                .isEqualTo("member");
        assertThat(account("disabled@hyperdatalab.org").path("disabled").asBoolean()).isTrue();
    }

    @Test
    void resetGivesTheManagerPendingJoinAndDownloadQueues() throws Exception {
        call("POST", "/api/dev/reset", null, null);

        var joins = get(DEMO + "/members?status=pending", MANAGER).body();
        var downloads = get(DEMO + "/download-requests?status=pending", MANAGER).body();

        assertThat(joins).hasSize(1);
        assertThat(joins.get(0).path("email").asText()).isEqualTo(BOB);
        assertThat(downloads).hasSize(1);
        assertThat(downloads.get(0).path("requester").asText()).isEqualTo(ALICE);
    }

    @Test
    void resetLetsTheApprovedMemberSendDownloadRequests() throws Exception {
        call("POST", "/api/dev/reset", null, null);

        var response =
                call("POST", DEMO + "/download-requests", ALICE, Map.of("paperRef", "doi:10/x"));

        assertThat(response.status()).isEqualTo(201);
        assertThat(get(DEMO, BOB).code()).isEqualTo("pending_approval");
    }

    @Test
    void resetGivesTheAdminAPendingWorkspaceRequestToApprove() throws Exception {
        call("POST", "/api/dev/reset", null, null);
        var pending = get("/api/admin/workspace-requests?status=pending", ADMIN).body();

        assertThat(pending).hasSize(1);
        String id = pending.get(0).path("id").asText();
        var approved =
                call("POST", "/api/admin/workspace-requests/" + id + "/approve", ADMIN, Map.of());

        assertThat(approved.status()).isEqualTo(200);
        assertThat(account("carol@hyperdatalab.org").path("role").asText())
                .isEqualTo("workspace_manager");
    }

    @Test
    void resetReflectsRoleChangesMadeLater() throws Exception {
        call("POST", "/api/dev/reset", null, null);
        call("PATCH", "/api/admin/users/" + ALICE, ADMIN, Map.of("role", "workspace_manager"));

        assertThat(account(ALICE).path("role").asText()).isEqualTo("workspace_manager");

        call("POST", "/api/dev/reset", null, null);
        assertThat(account(ALICE).path("role").asText()).isEqualTo("member");
    }
}
