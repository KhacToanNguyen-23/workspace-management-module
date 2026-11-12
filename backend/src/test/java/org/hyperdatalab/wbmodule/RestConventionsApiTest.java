package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The conventions every endpoint follows: versioned paths, Location, paging, PATCH, scoping. */
class RestConventionsApiTest extends IntegrationTest {
    private static final String V1 = "/api/v1";

    private static Set<String> texts(JsonNode array, String field) {
        Set<String> out = new HashSet<>();
        for (JsonNode n : array) out.add(n.path(field).asText());
        return out;
    }

    // ---- versioning --------------------------------------------------------------------------

    @Test
    void unversionedRoutesAreGone() throws Exception {
        assertThat(get("/api/me", ALICE).status()).isEqualTo(404);
        assertThat(get("/api/admin/users", ADMIN).status()).isEqualTo(404);
        assertThat(get("/api/health", null).status()).isEqualTo(200);
    }

    // ---- error statuses -----------------------------------------------------------------------

    @Test
    void unsupportedMethodsAnswer405WithAnAllowHeader() throws Exception {
        Res r = call("DELETE", V1 + "/me", ALICE, null);
        assertThat(r.status()).isEqualTo(405);
        assertThat(r.code()).isEqualTo("method_not_allowed");
        assertThat(r.header("Allow")).contains("GET");
        assertThat(call("PUT", V1 + "/workspaces", ADMIN, Map.of()).status()).isEqualTo(405);
    }

    @Test
    void aBodyThatIsNotJsonAnswers415() throws Exception {
        var result =
                mvc.perform(
                                MockMvcRequestBuilders.post(V1 + "/workspaces")
                                        .header("Authorization", "Bearer dev:" + ADMIN)
                                        .contentType(MediaType.TEXT_PLAIN)
                                        .content("name=x"))
                        .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(415);
        assertThat(result.getResponse().getContentAsString()).contains("unsupported_media_type");
    }

    // ---- Location ----------------------------------------------------------------------------

    @Test
    void createdResourcesCarryALocationHeaderThatCanBeFollowed() throws Exception {
        Res workspace =
                call(
                        "POST",
                        V1 + "/workspaces",
                        ADMIN,
                        Map.of("name", "Lab", "type", "research", "managers", List.of(MANAGER)));
        String id = workspace.body().path("id").asText();
        assertThat(workspace.status()).isEqualTo(201);
        assertThat(workspace.header("Location")).endsWith(V1 + "/workspaces/" + id);

        Res join = call("PUT", V1 + "/workspaces/" + id + "/members/me", ALICE, Map.of());
        String mid = join.body().path("id").asText();
        assertThat(join.status()).isEqualTo(201);
        assertThat(join.header("Location")).endsWith(V1 + "/workspaces/" + id + "/members/" + mid);

        String location = join.header("Location");
        Res followed = get(location.substring(location.indexOf("/api")), MANAGER);
        assertThat(followed.status()).isEqualTo(200);
        assertThat(followed.body().path("email").asText()).isEqualTo(ALICE);

        Res request =
                call(
                        "POST",
                        V1 + "/workspace-requests",
                        BOB,
                        Map.of("name", "Bob Lab", "type", "research"));
        assertThat(request.header("Location"))
                .endsWith(V1 + "/workspace-requests/" + request.body().path("id").asText());
    }

    // ---- pagination --------------------------------------------------------------------------

    @Test
    void collectionsPageWithTotalAndLinkHeaders() throws Exception {
        for (int i = 0; i < 3; i++)
            call("POST", V1 + "/workspaces", ADMIN, Map.of("name", "W" + i, "type", "research"));

        Res first = get(V1 + "/workspaces?status=all&limit=2", ADMIN);
        assertThat(first.body()).hasSize(2);
        assertThat(first.header("X-Total-Count")).isEqualTo("3");
        assertThat(first.header("Link")).contains("rel=\"next\"").doesNotContain("rel=\"prev\"");

        Res last = get(V1 + "/workspaces?status=all&limit=2&offset=2", ADMIN);
        assertThat(last.body()).hasSize(1);
        assertThat(last.header("Link")).contains("rel=\"prev\"").doesNotContain("rel=\"next\"");

        Res beyond = get(V1 + "/workspaces?status=all&offset=10", ADMIN);
        assertThat(beyond.body()).isEmpty();
        assertThat(beyond.header("X-Total-Count")).isEqualTo("3");
    }

    @Test
    void invalidPagingParametersAreRejected() throws Exception {
        assertThat(get(V1 + "/workspaces?limit=0", ALICE).status()).isEqualTo(422);
        assertThat(get(V1 + "/workspaces?limit=501", ALICE).status()).isEqualTo(422);
        assertThat(get(V1 + "/workspaces?offset=-1", ALICE).status()).isEqualTo(422);
        Res text = get(V1 + "/workspaces?limit=abc", ALICE);
        assertThat(text.status()).isEqualTo(400);
        assertThat(text.code()).isEqualTo("bad_parameter");
    }

    // ---- memberships -------------------------------------------------------------------------

    @Test
    void aMembershipMovesThroughItsStatesWithPatch() throws Exception {
        String wid = seedWorkspace("research");
        String mid =
                call("PUT", V1 + "/workspaces/" + wid + "/members/me", ALICE, Map.of("note", "hi"))
                        .body()
                        .path("id")
                        .asText();
        String url = V1 + "/workspaces/" + wid + "/members/" + mid;

        assertThat(call("PATCH", url, ALICE, Map.of("status", "approved")).status()).isEqualTo(403);

        Res approved = call("PATCH", url, MANAGER, Map.of("status", "approved", "note", "welcome"));
        assertThat(approved.status()).isEqualTo(200);
        assertThat(approved.body().path("status").asText()).isEqualTo("approved");
        assertThat(get(V1 + "/workspaces/" + wid, ALICE).status()).isEqualTo(200);

        assertThat(call("PATCH", url, MANAGER, Map.of("status", "approved")).code())
                .isEqualTo("not_pending");
        assertThat(call("PATCH", url, MANAGER, Map.of("status", "bogus")).status()).isEqualTo(422);

        Res revoked = call("PATCH", url, MANAGER, Map.of("status", "revoked"));
        assertThat(revoked.status()).isEqualTo(200);
        assertThat(revoked.body().path("status").asText()).isEqualTo("revoked");
        assertThat(get(V1 + "/workspaces/" + wid, ALICE).code()).isEqualTo("not_member");
    }

    @Test
    void membersReadTheirOwnMembershipThroughTheMeAlias() throws Exception {
        String wid = seedWorkspace("research");
        call("PUT", V1 + "/workspaces/" + wid + "/members/me", ALICE, Map.of());

        Res mine = get(V1 + "/workspaces/" + wid + "/members/me", ALICE);
        assertThat(mine.status()).isEqualTo(200);
        assertThat(mine.body().path("status").asText()).isEqualTo("pending");
        assertThat(mine.body().path("email").asText()).isEqualTo(ALICE);
        assertThat(get(V1 + "/workspaces/" + wid + "/members/me", BOB).status()).isEqualTo(404);
    }

    @Test
    void ordinaryMembersSeeOnlyApprovedColleaguesWithPublicFields() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");
        call("PUT", V1 + "/workspaces/" + wid + "/members/me", BOB, Map.of("note", "private"));

        Res list = get(V1 + "/workspaces/" + wid + "/members", ALICE);
        assertThat(list.status()).isEqualTo(200);
        assertThat(texts(list.body(), "email")).containsExactlyInAnyOrder(MANAGER, ALICE);
        for (JsonNode m : list.body()) {
            assertThat(m.path("status").asText()).isEqualTo("approved");
            assertThat(m.has("note")).isFalse();
            assertThat(m.has("lastSeen")).isFalse();
        }
        assertThat(get(V1 + "/workspaces/" + wid + "/members?status=pending", ALICE).status())
                .isEqualTo(403);
        assertThat(get(V1 + "/workspaces/" + wid + "/members?status=pending", MANAGER).body())
                .hasSize(1);
    }

    // ---- reading one resource ----------------------------------------------------------------

    @Test
    void aDownloadRequestIsReadableByItsRequesterAndManagersOnly() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");
        joinAndApprove(wid, BOB, "member");
        String id =
                call(
                                "POST",
                                V1 + "/workspaces/" + wid + "/download-requests",
                                ALICE,
                                Map.of("paperRef", "doi:1"))
                        .body()
                        .path("id")
                        .asText();
        String url = V1 + "/workspaces/" + wid + "/download-requests/" + id;

        assertThat(get(url, ALICE).status()).isEqualTo(200);
        assertThat(get(url, MANAGER).status()).isEqualTo(200);
        assertThat(get(url, BOB).status()).isEqualTo(403);
        assertThat(get(url + "x", ALICE).status()).isEqualTo(404);
    }

    @Test
    void workspaceRequestsAreScopedToTheirOwner() throws Exception {
        String a =
                call(
                                "POST",
                                V1 + "/workspace-requests",
                                ALICE,
                                Map.of("name", "A Lab", "type", "research"))
                        .body()
                        .path("id")
                        .asText();
        call("POST", V1 + "/workspace-requests", BOB, Map.of("name", "B Lab", "type", "research"));

        Res own = get(V1 + "/workspace-requests", ALICE);
        assertThat(own.body()).hasSize(1);
        assertThat(own.body().get(0).path("id").asText()).isEqualTo(a);
        assertThat(get(V1 + "/workspace-requests", ADMIN).body()).hasSize(2);
        assertThat(get(V1 + "/workspace-requests?requester=me", ADMIN).body()).isEmpty();
        assertThat(get(V1 + "/workspace-requests?requester=bob", ADMIN).status()).isEqualTo(422);

        assertThat(get(V1 + "/workspace-requests/" + a, ALICE).status()).isEqualTo(200);
        assertThat(get(V1 + "/workspace-requests/" + a, BOB).status()).isEqualTo(404);
        assertThat(get(V1 + "/workspace-requests/" + a, ADMIN).status()).isEqualTo(200);
        assertThat(
                        call("PATCH", V1 + "/workspace-requests/" + a, ALICE, Map.of("status", "approved"))
                                .code())
                .isEqualTo("admin_only");
    }

    // ---- workspaces --------------------------------------------------------------------------

    @Test
    void onlyAdminsChooseTheInitialManagers() throws Exception {
        get(V1 + "/me", MANAGER);
        call("PATCH", V1 + "/users/" + MANAGER, ADMIN, Map.of("role", "workspace_manager"));

        Res chosen =
                call(
                        "POST",
                        V1 + "/workspaces",
                        MANAGER,
                        Map.of("name", "X", "type", "research", "managers", List.of(ALICE)));
        assertThat(chosen.code()).isEqualTo("admin_only");

        Res own = call("POST", V1 + "/workspaces", MANAGER, Map.of("name", "X", "type", "research"));
        assertThat(own.status()).isEqualTo(201);
        assertThat(own.body().path("managers")).hasSize(1);
        assertThat(own.body().path("managers").get(0).asText()).isEqualTo(MANAGER);
    }

    @Test
    void archivedWorkspacesAreForAdminsOnly() throws Exception {
        String wid = seedWorkspace("research");
        assertThat(call("PATCH", V1 + "/workspaces/" + wid, MANAGER, Map.of("status", "archived")).code())
                .isEqualTo("admin_only");
        assertThat(call("PATCH", V1 + "/workspaces/" + wid, ADMIN, Map.of("status", "weird")).status())
                .isEqualTo(422);
        assertThat(call("PATCH", V1 + "/workspaces/" + wid, ADMIN, Map.of("status", "archived")).status())
                .isEqualTo(200);

        assertThat(get(V1 + "/workspaces", ALICE).body()).isEmpty();
        assertThat(get(V1 + "/workspaces?status=archived", ALICE).code()).isEqualTo("admin_only");
        assertThat(get(V1 + "/workspaces?status=archived", ADMIN).body()).hasSize(1);
        assertThat(get(V1 + "/workspaces?status=bogus", ADMIN).status()).isEqualTo(422);
    }

    @Test
    void oneWorkspaceRepresentationIsUsedEverywhere() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");

        JsonNode listed = get(V1 + "/workspaces", ALICE).body().get(0);
        assertThat(listed.has("managers")).isTrue();
        assertThat(listed.has("managerEmails")).isFalse();
        assertThat(listed.has("pendingCount")).isFalse();

        JsonNode admin = get(V1 + "/workspaces?status=all", ADMIN).body().get(0);
        assertThat(admin.path("managers").get(0).asText()).isEqualTo(MANAGER);
        assertThat(admin.has("pendingCount")).isTrue();

        JsonNode member = get(V1 + "/workspaces/" + wid, ALICE).body();
        assertThat(member.path("managers").get(0).asText()).isEqualTo(MANAGER);
        assertThat(member.path("myRole").asText()).isEqualTo("member");
        assertThat(member.path("canManage").asBoolean()).isFalse();
        assertThat(member.has("pendingCount")).isFalse();

        JsonNode manager = get(V1 + "/workspaces/" + wid, MANAGER).body();
        assertThat(manager.path("canManage").asBoolean()).isTrue();
        assertThat(manager.has("pendingCount")).isTrue();
    }

    // ---- audit -------------------------------------------------------------------------------

    @Test
    void auditEventsHaveUniqueIdsAndAreScoped() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");

        Res all = get(V1 + "/audit-events", ADMIN);
        Set<String> ids = texts(all.body(), "id");
        assertThat(ids).doesNotContain("").hasSize(all.body().size());
        assertThat(get(V1 + "/audit-events", MANAGER).code()).isEqualTo("admin_only");

        Res scoped = get(V1 + "/audit-events?workspaceId=" + wid, MANAGER);
        assertThat(scoped.status()).isEqualTo(200);
        assertThat(scoped.body()).isNotEmpty();
        assertThat(texts(scoped.body(), "workspaceId")).containsExactly(wid);
        assertThat(get(V1 + "/audit-events?workspaceId=" + wid, ALICE).status()).isEqualTo(403);
    }

    // ---- read-only requests stay read-only ---------------------------------------------------

    @Test
    void lastSeenIsNotRewrittenOnEveryRequest() throws Exception {
        get(V1 + "/me", ALICE);
        Object first = store.get("users", ALICE).orElseThrow().get("lastSeen");
        Thread.sleep(50);
        get(V1 + "/me", ALICE);
        Object second = store.get("users", ALICE).orElseThrow().get("lastSeen");

        assertThat(first).isNotNull();
        assertThat(second).isEqualTo(first);
    }
}
