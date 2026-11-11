package org.hyperdatalab.wbmodule.auth;

/** Verifies the bearer token sent by the React app and returns who signed in. */
public interface TokenVerifier {
    record TokenIdentity(String uid, String email, String name, String picture) {}

    /** @throws org.hyperdatalab.wbmodule.common.ApiException 401 when the token is missing or invalid */
    TokenIdentity verify(String token);
}
