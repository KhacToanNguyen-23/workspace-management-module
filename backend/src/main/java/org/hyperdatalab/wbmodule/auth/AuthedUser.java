package org.hyperdatalab.wbmodule.auth;

/**
 * The signed-in, directory-checked user of the current request. Inject it as a controller
 * parameter.
 */
public record AuthedUser(String email, String name, String role) {
    public boolean admin() {
        return "admin".equals(role);
    }

    public boolean workspaceManager() {
        return admin() || "workspace_manager".equals(role);
    }

    public static final String ATTRIBUTE = AuthedUser.class.getName();
}
