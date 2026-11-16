package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

/** POST /workspaces with an initial member list. */
class CreateWorkspaceMembersApiTest extends IntegrationTest {
    private Res create(List<String> members) throws Exception {
        return call(
                "POST",
                "/api/v1/workspaces",
                ADMIN,
                Map.of(
                        "name", "Lab",
                        "type", "research",
                        "managers", List.of(MANAGER),
                        "members", members));
    }

    @Test
    void addsMembersAsApprovedAndSkipsTheManager() throws Exception {
        Res r = create(List.of(ALICE, "BOB@hyperdatalab.org", MANAGER, ALICE));

        assertThat(r.status()).isEqualTo(201);
        assertThat(r.body().path("members").toString())
                .isEqualTo("[\"" + ALICE + "\",\"" + BOB + "\"]");
        String wid = r.body().path("id").asText();
        Res members = get("/api/v1/workspaces/" + wid + "/members?status=approved", MANAGER);
        Map<String, String> roles = new java.util.HashMap<>();
        for (JsonNode m : members.body()) roles.put(m.path("email").asText(), m.path("role").asText());
        assertThat(roles)
                .containsEntry(MANAGER, "manager")
                .containsEntry(ALICE, "member")
                .containsEntry(BOB, "member")
                .hasSize(3);
        assertThat(get("/api/v1/workspaces/" + wid, ALICE).status()).isEqualTo(200);
    }

    @Test
    void unknownAddressCreatesNothing() throws Exception {
        Res r = create(List.of(ALICE, "ghost@hyperdatalab.org"));

        assertThat(r.status()).isEqualTo(404);
        assertThat(r.code()).isEqualTo("not_in_directory");
        assertThat(store.all("workspaces")).isEmpty();
        assertThat(store.all("memberships")).isEmpty();
    }

    @Test
    void suspendedAddressIsRefused() throws Exception {
        Res r = create(List.of("gone@hyperdatalab.org"));

        assertThat(r.status()).isEqualTo(409);
        assertThat(r.code()).isEqualTo("inactive_user");
        assertThat(store.all("workspaces")).isEmpty();
    }

    @Test
    void otherDomainIsRefused() throws Exception {
        Res r = create(List.of("eve@example.com"));

        assertThat(r.status()).isEqualTo(422);
        assertThat(r.code()).isEqualTo("wrong_domain");
    }
}
