package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class WorkspaceApiTest extends IntegrationTest {

    private static List<String> texts(JsonNode arr) {
        List<String> out = new ArrayList<>();
        arr.forEach(n -> out.add(n.asText()));
        return out;
    }

    @Test
    void adminCreatesWorkspaceWithTypeDefaultsAndManager() throws Exception {
        String wid = seedWorkspace("research");
        JsonNode ws = get("/api/admin/workspaces", ADMIN).body().get(0);
        assertThat(ws.path("id").asText()).isEqualTo(wid);
        assertThat(texts(ws.path("managers"))).containsExactly(MANAGER);
        assertThat(texts(ws.path("permissions"))).containsExactly("workspace.read", "workspace.write");

        JsonNode m = get("/api/me", MANAGER).body().path("memberships").get(0);
        assertThat(m.path("role").asText()).isEqualTo("manager");
        assertThat(m.path("status").asText()).isEqualTo("approved");
        assertThat(texts(m.path("permissions"))).contains("members.manage");
    }

    @Test
    void nonAdminsCannotCreateWorkspaces() throws Exception {
        Res r = call("POST", "/api/admin/workspaces", ALICE, Map.of("name", "x", "slug", "xx", "type", "research"));
        assertThat(r.status()).isEqualTo(403);
    }

    @Test
    void validatesWorkspaceInput() throws Exception {
        assertThat(call("POST", "/api/admin/workspaces", ADMIN, Map.of("name", "x", "slug", "Bad Slug", "type", "research")).status()).isEqualTo(422);
        assertThat(call("POST", "/api/admin/workspaces", ADMIN, Map.of("name", "x", "slug", "ok-slug", "type", "nope")).code()).isEqualTo("unknown_type");
        assertThat(call("POST", "/api/admin/workspaces", ADMIN, Map.of("name", "x", "slug", "ok-slug", "type", "research",
                "managers", List.of("x@gmail.com"))).code()).isEqualTo("wrong_domain");
    }

    @Test
    void memberIsLockedOutUntilManagerApproves() throws Exception {
        String wid = seedWorkspace("research");
        assertThat(get("/api/w/" + wid, ALICE).code()).isEqualTo("not_member");

        assertThat(call("POST", "/api/workspaces/" + wid + "/join", ALICE, Map.of("note", "I write SLRs")).status()).isEqualTo(201);
        assertThat(call("POST", "/api/workspaces/" + wid + "/join", ALICE, Map.of()).status()).isEqualTo(409);
        assertThat(get("/api/w/" + wid, ALICE).code()).isEqualTo("pending_approval");

        // Someone who is not a manager cannot see the queue.
        assertThat(get("/api/w/" + wid + "/members", BOB).status()).isEqualTo(403);

        JsonNode pending = get("/api/w/" + wid + "/members?status=pending", MANAGER).body();
        assertThat(pending).hasSize(1);
        assertThat(pending.get(0).path("email").asText()).isEqualTo(ALICE);
        assertThat(pending.get(0).path("note").asText()).isEqualTo("I write SLRs");
        assertThat(pending.get(0).path("name").asText()).isEqualTo("Alice Nguyen");

        String mid = pending.get(0).path("id").asText();
        assertThat(call("POST", "/api/w/" + wid + "/members/" + mid + "/approve", MANAGER, Map.of("role", "member")).status()).isEqualTo(200);

        Res info = get("/api/w/" + wid, ALICE);
        assertThat(info.status()).isEqualTo(200);
        assertThat(texts(info.body().path("permissions"))).containsExactly("workspace.read", "workspace.write");

        assertThat(texts(actions(wid))).contains("membership.request", "membership.approve", "workspace.create");
    }

    private JsonNode actions(String wid) throws Exception {
        var arr = json.createArrayNode();
        get("/api/w/" + wid + "/audit", MANAGER).body().forEach(a -> arr.add(a.path("action").asText()));
        return arr;
    }

    @Test
    void rejectedUsersSeeTheDecisionAndCanAskAgain() throws Exception {
        String wid = seedWorkspace("research");
        call("POST", "/api/workspaces/" + wid + "/join", BOB, Map.of());
        String mid = get("/api/w/" + wid + "/members?status=pending", MANAGER).body().get(0).path("id").asText();
        call("POST", "/api/w/" + wid + "/members/" + mid + "/reject", MANAGER, Map.of("note", "wrong team"));

        JsonNode m = get("/api/me", BOB).body().path("memberships").get(0);
        assertThat(m.path("status").asText()).isEqualTo("rejected");
        assertThat(m.path("decisionNote").asText()).isEqualTo("wrong team");
        assertThat(call("POST", "/api/workspaces/" + wid + "/join", BOB, Map.of("note", "again")).status()).isEqualTo(201);
    }

    @Test
    void userCanWithdrawAPendingRequest() throws Exception {
        String wid = seedWorkspace("research");
        call("POST", "/api/workspaces/" + wid + "/join", BOB, Map.of());
        assertThat(call("DELETE", "/api/workspaces/" + wid + "/join", BOB, null).status()).isEqualTo(204);
        assertThat(get("/api/me", BOB).body().path("memberships")).isEmpty();
    }

    @Test
    void lastManagerCannotLeave() throws Exception {
        String wid = seedWorkspace("research");
        assertThat(call("DELETE", "/api/workspaces/" + wid + "/join", MANAGER, null).code()).isEqualTo("last_manager");
    }

    @Test
    void onlyAdminsGrantTheManagerRole() throws Exception {
        String wid = seedWorkspace("research");
        call("POST", "/api/workspaces/" + wid + "/join", ALICE, Map.of());
        String mid = get("/api/w/" + wid + "/members?status=pending", MANAGER).body().get(0).path("id").asText();
        assertThat(call("POST", "/api/w/" + wid + "/members/" + mid + "/approve", MANAGER, Map.of("role", "manager")).code()).isEqualTo("admin_only");
        assertThat(call("POST", "/api/w/" + wid + "/members/" + mid + "/approve", ADMIN, Map.of("role", "manager")).status()).isEqualTo(200);
    }

    @Test
    void managersCannotChangeTheirOwnMembership() throws Exception {
        String wid = seedWorkspace("research");
        String mine = null;
        for (JsonNode m : get("/api/w/" + wid + "/members", MANAGER).body()) if (m.path("email").asText().equals(MANAGER)) mine = m.path("id").asText();
        assertThat(call("PATCH", "/api/w/" + wid + "/members/" + mine, MANAGER, Map.of("role", "viewer")).code()).isEqualTo("self_change");
    }

    @Test
    void managerChangesRoleAndRevokes() throws Exception {
        String wid = seedWorkspace("research");
        String mid = joinAndApprove(wid, ALICE, "member");
        assertThat(call("PATCH", "/api/w/" + wid + "/members/" + mid, MANAGER, Map.of("role", "viewer")).status()).isEqualTo(200);
        assertThat(texts(get("/api/w/" + wid, ALICE).body().path("permissions"))).containsExactly("workspace.read");

        assertThat(call("POST", "/api/w/" + wid + "/members/" + mid + "/revoke", MANAGER, Map.of("note", "left")).status()).isEqualTo(200);
        assertThat(get("/api/w/" + wid, ALICE).status()).isEqualTo(403);
    }

    @Test
    void managerAddsDirectoryUsersDirectlyButNotUnknownOnes() throws Exception {
        String wid = seedWorkspace("research");
        assertThat(call("POST", "/api/w/" + wid + "/members", MANAGER, Map.of("email", BOB, "role", "viewer")).status()).isEqualTo(201);
        assertThat(get("/api/w/" + wid, BOB).status()).isEqualTo(200);
        assertThat(call("POST", "/api/w/" + wid + "/members", MANAGER, Map.of("email", "ghost@hyperdatalab.org")).code()).isEqualTo("not_in_directory");
        assertThat(call("POST", "/api/w/" + wid + "/members", MANAGER, Map.of("email", "x@gmail.com")).code()).isEqualTo("wrong_domain");
        assertThat(call("POST", "/api/w/" + wid + "/members", MANAGER, Map.of("email", BOB)).code()).isEqualTo("already_member");
    }

    @Test
    void workspacePermissionsCapEachRole() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");
        assertThat(texts(get("/api/w/" + wid, ALICE).body().path("permissions"))).containsExactly("workspace.read", "workspace.write");

        assertThat(call("PUT", "/api/w/" + wid + "/permissions", MANAGER,
                Map.of("permissions", List.of("workspace.read", "workspace.write", "workspace.review"))).status()).isEqualTo(200);
        assertThat(texts(get("/api/w/" + wid, ALICE).body().path("permissions")))
                .containsExactly("workspace.read", "workspace.write", "workspace.review");

        // The manager keeps members.manage even with everything switched off.
        call("PUT", "/api/w/" + wid + "/permissions", MANAGER, Map.of("permissions", List.of()));
        assertThat(texts(get("/api/w/" + wid, MANAGER).body().path("permissions"))).containsExactly("members.manage");
        assertThat(texts(get("/api/w/" + wid, ALICE).body().path("permissions"))).isEmpty();

        assertThat(call("PUT", "/api/w/" + wid + "/permissions", ALICE, Map.of("permissions", List.of("workspace.read"))).status()).isEqualTo(403);
        assertThat(call("PUT", "/api/w/" + wid + "/permissions", MANAGER, Map.of("permissions", List.of("members.manage"))).status()).isEqualTo(422);
    }

    @Test
    void membersSeeTheirColleagues() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");
        JsonNode people = get("/api/w/" + wid + "/people", ALICE).body();
        assertThat(people).hasSize(2);
        assertThat(people.get(0).path("email").asText()).isEqualTo(MANAGER);
        assertThat(people.get(0).path("role").asText()).isEqualTo("manager");
        assertThat(people.get(1).path("department").asText()).isEqualTo("/research");
    }

    @Test
    void archivedWorkspacesCloseForMembersButNotAdmins() throws Exception {
        String wid = seedWorkspace("research");
        joinAndApprove(wid, ALICE, "member");
        call("PATCH", "/api/admin/workspaces/" + wid, ADMIN, Map.of("status", "archived"));
        assertThat(get("/api/w/" + wid, ALICE).code()).isEqualTo("archived");
        assertThat(get("/api/w/" + wid, ADMIN).status()).isEqualTo(200);
        assertThat(get("/api/workspaces", ALICE).body()).isEmpty();
    }

    @Test
    void adminAssignsAnotherManagerAndAddsWorkspaceTypes() throws Exception {
        String wid = seedWorkspace("research");
        assertThat(call("POST", "/api/admin/workspaces/" + wid + "/managers", ADMIN, Map.of("email", BOB)).status()).isEqualTo(201);
        assertThat(texts(get("/api/w/" + wid, BOB).body().path("permissions"))).contains("members.manage");

        assertThat(call("POST", "/api/admin/workspace-types", ADMIN, Map.of("code", "teaching", "name", "Teaching",
                "defaultPermissions", List.of("workspace.read", "workspace.review"))).status()).isEqualTo(201);
        assertThat(get("/api/workspace-types", ALICE).body().findValuesAsText("code")).contains("teaching");
        assertThat(call("POST", "/api/admin/workspace-types", ADMIN, Map.of("code", "teaching", "name", "Dup")).status()).isEqualTo(409);
    }

    @Test
    void unknownWorkspaceIdsAre404() throws Exception {
        assertThat(get("/api/w/00000000-0000-0000-0000-000000000000", ADMIN).status()).isEqualTo(404);
        assertThat(get("/api/w/not-a-uuid", ADMIN).status()).isEqualTo(404);
    }
}
