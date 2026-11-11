package org.hyperdatalab.wbmodule;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import java.util.Map;

class AdminApiTest extends IntegrationTest {
    private void makeAliceAdmin() throws Exception {
        get("/api/me", ALICE);
        call("PATCH", "/api/admin/users/" + ALICE, ADMIN, Map.of("role", "admin"));
    }

    @Test
    void adminCanPromoteMemberToWorkspaceManager() throws Exception {
        get("/api/me", ALICE);

        assertThat(
                        call(
                                        "PATCH",
                                        "/api/admin/users/" + ALICE,
                                        ADMIN,
                                        Map.of("role", "workspace_manager"))
                                .status())
                .isEqualTo(200);
    }

    @Test
    void adminCanDemoteWorkspaceManagerWithoutActiveWorkspace() throws Exception {
        get("/api/me", ALICE);
        call("PATCH", "/api/admin/users/" + ALICE, ADMIN, Map.of("role", "workspace_manager"));

        assertThat(
                        call("PATCH", "/api/admin/users/" + ALICE, ADMIN, Map.of("role", "member"))
                                .status())
                .isEqualTo(200);
    }

    @Test
    void adminCannotDemoteTheOnlyManagerOfAnActiveWorkspace() throws Exception {
        seedWorkspace("research");

        assertThat(
                        call(
                                        "PATCH",
                                        "/api/admin/users/" + MANAGER,
                                        ADMIN,
                                        Map.of("role", "member"))
                                .code())
                .isEqualTo("still_managing");
    }

    @Test
    void adminCanDemoteManagerAfterAnotherManagerIsAssigned() throws Exception {
        String workspaceId = seedWorkspace("research");
        call(
                "POST",
                "/api/admin/workspaces/" + workspaceId + "/managers",
                ADMIN,
                Map.of("email", ALICE));

        assertThat(
                        call(
                                        "PATCH",
                                        "/api/admin/users/" + MANAGER,
                                        ADMIN,
                                        Map.of("role", "member"))
                                .status())
                .isEqualTo(200);
    }

    @Test
    void adminCanDisableUserAndDisabledUserCannotSignIn() throws Exception {
        get("/api/me", ALICE);
        call("PATCH", "/api/admin/users/" + ALICE, ADMIN, Map.of("disabled", true));

        assertThat(get("/api/me", ALICE).code()).isEqualTo("disabled");
    }

    @Test
    void adminCanEnablePreviouslyDisabledUser() throws Exception {
        get("/api/me", ALICE);
        call("PATCH", "/api/admin/users/" + ALICE, ADMIN, Map.of("disabled", true));

        assertThat(
                        call("PATCH", "/api/admin/users/" + ALICE, ADMIN, Map.of("disabled", false))
                                .status())
                .isEqualTo(200);
        assertThat(get("/api/me", ALICE).status()).isEqualTo(200);
    }

    @Test
    void adminCannotDisableProtectedDomainAdmin() throws Exception {
        assertThat(
                        call("PATCH", "/api/admin/users/" + ADMIN, ADMIN, Map.of("disabled", true))
                                .code())
                .isEqualTo("protected");
    }

    @Test
    void adminCannotChangeProtectedDomainAdminRole() throws Exception {
        assertThat(
                        call("PATCH", "/api/admin/users/" + ADMIN, ADMIN, Map.of("role", "member"))
                                .code())
                .isEqualTo("protected");
    }

    @Test
    void adminCannotDisableOwnAccount() throws Exception {
        makeAliceAdmin();

        assertThat(
                        call("PATCH", "/api/admin/users/" + ALICE, ALICE, Map.of("disabled", true))
                                .code())
                .isEqualTo("self_change");
    }

    @Test
    void adminCannotLowerOwnRole() throws Exception {
        makeAliceAdmin();

        assertThat(
                        call("PATCH", "/api/admin/users/" + ALICE, ALICE, Map.of("role", "member"))
                                .code())
                .isEqualTo("self_change");
    }

    @Test
    void nonAdminCannotUseAdminEndpoints() throws Exception {
        assertThat(get("/api/admin/users", ALICE).status()).isEqualTo(403);
    }

    @Test
    void disabledUserCannotBeAssignedAsManager() throws Exception {
        String workspaceId = seedWorkspace("review");
        get("/api/me", ALICE);
        call("PATCH", "/api/admin/users/" + ALICE, ADMIN, Map.of("disabled", true));

        assertThat(
                        call(
                                        "POST",
                                        "/api/admin/workspaces/" + workspaceId + "/managers",
                                        ADMIN,
                                        Map.of("email", ALICE))
                                .code())
                .isEqualTo("inactive_user");
    }

    @Test
    void assigningManagerRecordsRoleChangeInAuditLog() throws Exception {
        String workspaceId = seedWorkspace("review");
        call(
                "POST",
                "/api/admin/workspaces/" + workspaceId + "/managers",
                ADMIN,
                Map.of("email", ALICE));

        assertThat(get("/api/admin/audit", ADMIN).body().findValuesAsText("action"))
                .contains("user.role");
    }
}
