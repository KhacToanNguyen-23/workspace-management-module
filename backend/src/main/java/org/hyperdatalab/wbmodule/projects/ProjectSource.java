package org.hyperdatalab.wbmodule.projects;

import org.hyperdatalab.wbmodule.common.ApiException;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Where research projects come from. ResearchPulse owns them; {@code userToken} is the signed-in
 * user's own SSO access token (ignored by the sample source).
 *
 * <p>A project is a map with id, title, description, researchArea, ownerUid, myRole, joinedAt,
 * createdAt and updatedAt (null when absent). A detail adds members [{name, role}], plus uid and
 * email when the source has them.
 *
 * <p>Failures are thrown as {@link ApiException}s that can go straight to the client.
 */
public interface ProjectSource {
    /** Whether this source lists every project of the lab, or only the user's own. */
    boolean listsAll();

    List<Map<String, Object>> list(String userToken);

    Optional<Map<String, Object>> get(String userToken, String projectId);

    /** Whether members can be changed through this source. */
    default boolean managesMembers() {
        return false;
    }

    private static ApiException unsupported() {
        return new ApiException(
                HttpStatus.NOT_IMPLEMENTED,
                "not_supported",
                "ResearchPulse does not let other applications change project members yet.");
    }

    default Map<String, Object> addMember(
            String projectId, String email, String role, String actor) {
        throw unsupported();
    }

    default Map<String, Object> updateMember(
            String projectId, String uid, String role, String actor) {
        throw unsupported();
    }

    default void removeMember(String projectId, String uid, String actor) {
        throw unsupported();
    }
}
