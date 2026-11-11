package org.hyperdatalab.wbmodule.auth;

/** The signed-in, directory-checked user of the current request. Inject it as a controller parameter. */
public record AuthedUser(String email, String name, boolean admin) {
    public static final String ATTRIBUTE = AuthedUser.class.getName();
}
