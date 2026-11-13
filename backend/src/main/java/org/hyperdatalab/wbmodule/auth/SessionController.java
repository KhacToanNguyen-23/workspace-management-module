package org.hyperdatalab.wbmodule.auth;

import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.hyperdatalab.wbmodule.auth.TokenVerifier.TokenIdentity;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.hyperdatalab.wbmodule.common.Locations;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.hyperdatalab.wbmodule.store.SessionStore;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;

/**
 * Sign-in and sign-out of the SSO mode.
 *
 * <p>The React app sends the user to the SSO with a PKCE challenge and comes back with a one-time
 * authorization code. It posts that code here; the backend exchanges it, checks the profile and
 * answers with a session token that the app then sends as {@code Authorization: Bearer}.
 */
@RestController
@RequestMapping(Locations.API + "/sessions")
@ConditionalOnProperty(name = "app.auth.mode", havingValue = "sso")
public class SessionController {
    private final SsoClient sso;
    private final SessionStore sessions;
    private final IdentityService identity;
    private final AppProperties props;

    public SessionController(
            ObjectMapper json,
            SessionStore sessions,
            IdentityService identity,
            AppProperties props) {
        AppProperties.Sso config = props.auth().sso();
        this.sso = new SsoClient(json, config.baseUrl(), config.clientId(), config.clientSecret());
        this.sessions = sessions;
        this.identity = identity;
        this.props = props;
    }

    record SignIn(
            @NotBlank @Size(max = 2000) String code,
            // RFC 7636: 43 to 128 unreserved characters.
            @NotBlank @Pattern(regexp = "[A-Za-z0-9._~-]{43,128}") String codeVerifier,
            @NotBlank @Size(max = 500) String redirectUri) {}

    /** The callback must be a page of this module's own web app, not somewhere else. */
    private void requireOwnCallback(String redirectUri) {
        String origin;
        try {
            URI uri = URI.create(redirectUri);
            origin = uri.getScheme() + "://" + uri.getRawAuthority();
        } catch (IllegalArgumentException e) {
            origin = "";
        }
        if (!props.corsOrigins().contains(origin))
            throw ApiException.unprocessable(
                    "invalid_redirect", "redirectUri is not a page of this application.");
    }

    /** Exchanges an SSO authorization code for a session of this module. */
    @PostMapping
    ResponseEntity<Map<String, Object>> signIn(@Valid @RequestBody SignIn b) {
        requireOwnCallback(b.redirectUri());
        SsoClient.Profile p = sso.signIn(b.code(), b.codeVerifier(), b.redirectUri());
        if (p.sub() == null || p.sub().isBlank() || p.email() == null || p.email().isBlank())
            throw new ApiException(
                    HttpStatus.BAD_GATEWAY,
                    "sso_unavailable",
                    "The sign-in service returned an incomplete profile.");
        if (!p.emailVerified())
            throw ApiException.forbidden("unverified", "The account email is not verified.");
        String email = p.email().toLowerCase(Locale.ROOT);
        // Creates the user on a first sign-in; refuses another domain or a disabled account.
        AuthedUser user = identity.resolve(new TokenIdentity(p.sub(), email, p.name(), p.picture()));
        identity.applySsoProfile(email, p.name(), p.picture(), p.major(), p.role(), p.studentId());
        String name = p.name() == null || p.name().isBlank() ? user.name() : p.name();
        SessionStore.Issued issued =
                sessions.create(
                        new SessionStore.Session(p.sub(), email, name, p.picture()),
                        Duration.ofHours(props.auth().sso().sessionHours()));
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(
                        Map.of(
                                "token",
                                issued.token(),
                                "expiresAt",
                                issued.expiresAt().toString(),
                                "user",
                                Map.of("email", email, "name", name)));
    }

    /** Signs out: the session token stops working at once. */
    @DeleteMapping("/current")
    ResponseEntity<Void> signOut(HttpServletRequest req) {
        // AuthFilter already accepted this header, so it carries a live session token.
        sessions.delete(req.getHeader("Authorization").substring(7).trim());
        return ResponseEntity.noContent().build();
    }
}
