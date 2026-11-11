package org.hyperdatalab.wbmodule.common;

public final class Roles {
    public static final String ADMIN = "admin";
    public static final String WORKSPACE_MANAGER = "workspace_manager";
    public static final String MEMBER = "member";
    public static final String WS_MANAGER = "manager";
    public static final String WS_MEMBER = "member";

    private Roles() {}

    public static boolean canManageWorkspaces(String globalRole) {
        return ADMIN.equals(globalRole) || WORKSPACE_MANAGER.equals(globalRole);
    }
}
