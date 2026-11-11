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
import java.net.URL;
import java.util.Locale;
import java.util.Set;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;

@Configuration
public class TokenVerifiers {

    static ApiException unauthorized(String code, String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, code, message);
    }

    @Bean
    TokenVerifier tokenVerifier(AppProperties props) throws Exception {
        return switch (props.auth().mode()) {
            case "dev" -> new DevTokenVerifier();
            case "firebase" -> new FirebaseTokenVerifier(props.auth().firebaseProjectId());
            default -> throw new IllegalStateException("app.auth.mode must be firebase or dev");
        };
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

    /** Firebase Auth ID tokens from the same Firebase project as the Writing Bank web app. */
    static final class FirebaseTokenVerifier implements TokenVerifier {
        private static final String JWKS =
                "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
        private final DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();

        FirebaseTokenVerifier(String projectId) throws Exception {
            JWKSource<SecurityContext> keys = JWKSourceBuilder.create(new URL(JWKS)).retrying(true).build();
            processor.setJWSTypeVerifier(new DefaultJOSEObjectTypeVerifier<>(JOSEObjectType.JWT, null));
            processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
            processor.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(
                    projectId,
                    new JWTClaimsSet.Builder().issuer("https://securetoken.google.com/" + projectId).build(),
                    Set.of("sub", "iat", "exp", "email")));
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
                if (!Boolean.TRUE.equals(claims.getBooleanClaim("email_verified"))) {
                    throw unauthorized("unverified", "The account email is not verified.");
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
