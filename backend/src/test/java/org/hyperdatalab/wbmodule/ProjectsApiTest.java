package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;

import org.junit.jupiter.api.Test;

import java.util.Map;

/**
 * The project pages' API with the sample projects (PROJECTS_MODE=demo, the default). The samples
 * live in memory for the whole test run, so each test adds its own unique address and cleans up.
 */
class ProjectsApiTest extends IntegrationTest {
    static final String MEMBERS = "/api/v1/projects/demo-wordbank/members";

    private static String unique() {
        return "t" + System.nanoTime() + "@hyperdatalab.org";
    }

    private JsonNode member(String as, String email) throws Exception {
        for (JsonNode m : get("/api/v1/projects/demo-wordbank", as).body().path("members"))
            if (email.equals(m.path("email").asText())) return m;
        return null;
    }

    @Test
    void everyoneSeesEveryProjectOfTheLab() throws Exception {
        Res r = get("/api/v1/projects", BOB);

        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body().path("mode").asText()).isEqualTo("demo");
        assertThat(r.body().path("items")).hasSize(3);
        // Bob is not in Understanding, and still sees it.
        Res p = get("/api/v1/projects/demo-understanding", BOB);
        assertThat(p.status()).isEqualTo(200);
        assertThat(p.body().path("members")).isNotEmpty();
    }

    @Test
    void onlyAdminsSeeMemberEmails() throws Exception {
        JsonNode asMember = get("/api/v1/projects/demo-wordbank", ALICE).body().path("members");
        JsonNode asAdmin = get("/api/v1/projects/demo-wordbank", ADMIN).body().path("members");

        assertThat(asMember.get(0).has("email")).isFalse();
        assertThat(asMember.get(0).path("name").asText()).isNotBlank();
        assertThat(asAdmin.get(0).path("email").asText()).endsWith("@hyperdatalab.org");
    }

    @Test
    void anAdminAddsChangesAndRemovesAMember() throws Exception {
        String email = unique();

        Res added = call("POST", MEMBERS, ADMIN, Map.of("email", email, "role", "MEMBER"));
        assertThat(added.status()).isEqualTo(201);
        String uid = added.body().path("uid").asText();
        assertThat(member(ADMIN, email).path("role").asText()).isEqualTo("MEMBER");

        Res changed = call("PATCH", MEMBERS + "/" + uid, ADMIN, Map.of("role", "OWNER"));
        assertThat(changed.status()).isEqualTo(200);
        assertThat(member(ADMIN, email).path("role").asText()).isEqualTo("OWNER");

        assertThat(call("DELETE", MEMBERS + "/" + uid, ADMIN, null).status()).isEqualTo(204);
        assertThat(member(ADMIN, email)).isNull();
    }

    @Test
    void adminChangesAreAudited() throws Exception {
        String email = unique();
        String uid =
                call("POST", MEMBERS, ADMIN, Map.of("email", email, "role", "MEMBER"))
                        .body()
                        .path("uid")
                        .asText();
        call("DELETE", MEMBERS + "/" + uid, ADMIN, null);

        boolean logged = false;
        for (int i = 0; i < 20 && !logged; i++) {
            logged =
                    store.all("auditLog").stream()
                            .anyMatch(
                                    d ->
                                            "project.member.add".equals(d.getString("action"))
                                                    && email.equals(d.getString("target"))
                                                    && ADMIN.equals(d.getString("actor")));
            if (!logged) Thread.sleep(100);
        }
        assertThat(logged).isTrue();
    }

    @Test
    void membersCannotChangeProjects() throws Exception {
        Res r = call("POST", MEMBERS, ALICE, Map.of("email", unique(), "role", "MEMBER"));

        assertThat(r.status()).isEqualTo(403);
        assertThat(r.code()).isEqualTo("admin_only");
        assertThat(call("DELETE", MEMBERS + "/demo-bob", ALICE, null).status()).isEqualTo(403);
    }

    @Test
    void addingRefusesOtherDomainsDuplicatesAndUnknownRoles() throws Exception {
        Res other = call("POST", MEMBERS, ADMIN, Map.of("email", "eve@example.com", "role", "MEMBER"));
        assertThat(other.status()).isEqualTo(422);
        assertThat(other.code()).isEqualTo("wrong_domain");

        Res dup = call("POST", MEMBERS, ADMIN, Map.of("email", BOB, "role", "MEMBER"));
        assertThat(dup.status()).isEqualTo(409);
        assertThat(dup.code()).isEqualTo("already_member");

        assertThat(
                        call("POST", MEMBERS, ADMIN, Map.of("email", unique(), "role", "BOSS"))
                                .status())
                .isEqualTo(422);
    }

    @Test
    void aProjectKeepsAnOwner() throws Exception {
        String base = "/api/v1/projects/demo-understanding/members/demo-manager";

        Res remove = call("DELETE", base, ADMIN, null);
        assertThat(remove.status()).isEqualTo(409);
        assertThat(remove.code()).isEqualTo("last_owner");

        Res demote = call("PATCH", base, ADMIN, Map.of("role", "MEMBER"));
        assertThat(demote.status()).isEqualTo(409);
    }

    @Test
    void unknownProjectsAndMembersAre404() throws Exception {
        assertThat(get("/api/v1/projects/nope", ALICE).status()).isEqualTo(404);
        assertThat(call("DELETE", MEMBERS + "/demo-nobody", ADMIN, null).status()).isEqualTo(404);
    }
}
