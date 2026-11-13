package org.hyperdatalab.wbmodule.identity;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.hyperdatalab.wbmodule.directory.UserDirectory.DirectoryException;
import org.junit.jupiter.api.Test;

/** The check that stops a broken directory answer from marking everyone missing. */
class SyncGuardTest {

    @Test
    void emptyListIsRefusedWhenUsersAreKnown() {
        assertThatThrownBy(() -> IdentityService.requirePlausible(0, 3))
                .isInstanceOf(DirectoryException.class);
    }

    @Test
    void emptyListIsFineOnAFreshInstall() {
        assertThatCode(() -> IdentityService.requirePlausible(0, 0)).doesNotThrowAnyException();
    }

    @Test
    void listUnderHalfIsRefusedFromTenUsersUp() {
        assertThatThrownBy(() -> IdentityService.requirePlausible(4, 10))
                .isInstanceOf(DirectoryException.class);
    }

    @Test
    void halfOrMoreIsAccepted() {
        assertThatCode(() -> IdentityService.requirePlausible(5, 10)).doesNotThrowAnyException();
    }

    @Test
    void smallTeamsMayShrinkFreely() {
        assertThatCode(() -> IdentityService.requirePlausible(1, 9)).doesNotThrowAnyException();
    }
}
