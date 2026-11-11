package org.hyperdatalab.wbmodule.directory;

import java.util.List;
import java.util.Optional;

/**
 * Source of truth for who is registered under the org domain (@hyperdatalab.org).
 * Implementations call an external service; the app's own workspaces are unrelated to it.
 */
public interface UserDirectory {
    record DirectoryUser(String email, String name, String photoUrl, String department, boolean suspended) {}

    String mode();

    /** Empty = the address is not registered in the domain. */
    Optional<DirectoryUser> find(String email);

    List<DirectoryUser> listAll();

    class DirectoryException extends RuntimeException {
        public DirectoryException(String message) {
            super(message);
        }
    }
}
