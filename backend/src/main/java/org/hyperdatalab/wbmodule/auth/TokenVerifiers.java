package org.hyperdatalab.wbmodule.auth;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.DefaultJOSEObjectTypeVerifier;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;

import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.hyperdatalab.wbmodule.store.SessionStore;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;

import java.net.URL;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Configuration
public class TokenVerifiers {

    static ApiException unauthorized(String code, String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, code, message);
    }

    @Bean
    TokenVerifier tokenVerifier(AppProperties props, SessionStore sessions) throws Exception {
        return switch (props.auth().mode()) {
            case "dev" -> new DevTokenVerifier();
            case "sso" -> new SessionTokenVerifier(sessions);
            case "firebase" ->
                    new FirebaseTokenVerifier(
                            props.auth().firebaseProjectId(),
                            props.auth().allowedProviders(),
                            JWKSourceBuilder.create(new URL(FirebaseTokenVerifier.JWKS))
                                    .retrying(true)
                                    .build());
            default ->
                    throw new IllegalStateException("app.auth.mode must be sso, firebase or dev");
        };
    }

    /**
     * HyperDataLab SSO: the bearer token is a session issued by {@link SessionController} after
     * it exchanged the user's authorization code itself. Only its hash is stored.
     */
    static final class SessionTokenVerifier implements TokenVerifier {
        private final SessionStore sessions;

        SessionTokenVerifier(SessionStore sessions) {
            this.sessions = sessions;
        }

        @Override
        public TokenIdentity verify(String token) {
            return sessions.find(token)
                    .map(s -> new TokenIdentity(s.uid(), s.email(), s.name(), s.picture()))
                    .orElseThrow(
                            () ->
                                    unauthorized(
                                            "invalid_token",
                                            "Session expired or invalid; sign in again."));
        }
    }

    /** Local development only: `dev:<email>` or `dev:<email>|<name>`. */
    static final class DevTokenVerifier implements TokenVerifier {
        @Override
        public TokenIdentity verify(String token) {
            if (token == null || !token.startsWith("dev:")) {
                throw unauthorized("unauthenticated", "Dev auth expects `Bearer dev:<email>`.");
            }
            String[] parts = token.substring(4).split("\\|", 2);
            String email = parts[0].trim().toLowerCase(Locale.ROOT);
            return new TokenIdentity("dev-" + email, email, parts.length > 1 ? parts[1] : "", null);
        }
    }

    /**
     * Single sign-on through the organisation's Google accounts, brokered by Firebase Auth. The
     * React app obtains an OpenID Connect ID token; this class is the relying-party check:
     *
     * <ol>
     *   <li>signature: RS256 against Google's published keys (JWKS, cached and rotated);
     *   <li>{@code iss} = https://securetoken.google.com/&lt;project&gt; and {@code aud} =
     *       &lt;project&gt;;
     *   <li>{@code exp} in the future, {@code iat} / {@code auth_time} not in the future (60 s
     *       skew);
     *   <li>{@code sub} present, {@code email} present and {@code email_verified} = true;
     *   <li>{@code firebase.sign_in_provider} is an allowed identity provider (google.com), so a
     *       password or anonymous Firebase account can never pass as an SSO login.
     * </ol>
     *
     * The org-domain and directory checks happen afterwards in IdentityService.
     */
    public static final class FirebaseTokenVerifier implements TokenVerifier {
        static final String JWKS =
                "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
        private static final long SKEW_SECONDS = 60;

        private final DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        private final Set<String> allowedProviders;

        public FirebaseTokenVerifier(
                String projectId, List<String> allowedProviders, JWKSource<SecurityContext> keys) {
            this.allowedProviders = Set.copyOf(allowedProviders);
            processor.setJWSTypeVerifier(
                    new DefaultJOSEObjectTypeVerifier<>(JOSEObjectType.JWT, null));
            processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
            DefaultJWTClaimsVerifier<SecurityContext> claims =
                    new DefaultJWTClaimsVerifier<>(
                            projectId,
                            new JWTClaimsSet.Builder()
                                    .issuer("https://securetoken.google.com/" + projectId)
                                    .build(),
                            Set.of("sub", "iat", "exp", "auth_time", "email"));
            claims.setMaxClockSkew((int) SKEW_SECONDS);
            processor.setJWTClaimsSetVerifier(claims);
        }

        @Override
        public TokenIdentity verify(String token) {
            JWTClaimsSet claims;
            try {
                claims = processor.process(token, null);
            } catch (Exception e) {
                throw unauthorized("invalid_token", "Session expired or invalid; sign in again.");
            }
            try {
                Instant limit = Instant.now().plusSeconds(SKEW_SECONDS);
                Date iat = claims.getIssueTime();
                Date authTime = claims.getDateClaim("auth_time");
                if (claims.getSubject() == null
                        || claims.getSubject().isBlank()
                        || iat.toInstant().isAfter(limit)
                        || authTime.toInstant().isAfter(limit)) {
                    throw unauthorized("invalid_token", "Malformed token claims.");
                }
                if (!Boolean.TRUE.equals(claims.getBooleanClaim("email_verified"))) {
                    throw unauthorized("unverified", "The account email is not verified.");
                }
                Map<String, Object> firebase = claims.getJSONObjectClaim("firebase");
                Object provider = firebase == null ? null : firebase.get("sign_in_provider");
                if (!(provider instanceof String p) || !allowedProviders.contains(p)) {
                    throw unauthorized(
                            "provider_not_allowed",
                            "Sign in with your organisation's Google account.");
                }
                String name = claims.getStringClaim("name");
                return new TokenIdentity(
                        claims.getSubject(),
                        claims.getStringClaim("email").toLowerCase(Locale.ROOT),
                        name == null ? "" : name,
                        claims.getStringClaim("picture"));
            } catch (java.text.ParseException e) {
                throw unauthorized("invalid_token", "Malformed token claims.");
            }
        }
    }
}
