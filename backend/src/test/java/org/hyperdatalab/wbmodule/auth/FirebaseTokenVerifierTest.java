package org.hyperdatalab.wbmodule.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.hyperdatalab.wbmodule.auth.TokenVerifiers.FirebaseTokenVerifier;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** Relying-party checks of the SSO ID token, using tokens signed with a throwaway RSA key. */
class FirebaseTokenVerifierTest {
    static final String PROJECT = "test-project";
    static RSAKey key;
    static RSAKey otherKey;
    static FirebaseTokenVerifier verifier;

    @BeforeAll
    static void keys() throws Exception {
        key = new RSAKeyGenerator(2048).keyID("k1").generate();
        otherKey = new RSAKeyGenerator(2048).keyID("k1").generate();
        verifier = new FirebaseTokenVerifier(PROJECT, List.of("google.com"), new ImmutableJWKSet<>(new JWKSet(key.toPublicJWK())));
    }

    static String token(RSAKey signer, Consumer<JWTClaimsSet.Builder> change) throws Exception {
        Instant now = Instant.now();
        JWTClaimsSet.Builder b = new JWTClaimsSet.Builder()
                .issuer("https://securetoken.google.com/" + PROJECT)
                .audience(PROJECT)
                .subject("uid-123")
                .issueTime(Date.from(now.minusSeconds(10)))
                .expirationTime(Date.from(now.plusSeconds(3600)))
                .claim("auth_time", now.minusSeconds(30).getEpochSecond())
                .claim("email", "Alice@HyperDataLab.org")
                .claim("email_verified", true)
                .claim("name", "Alice Nguyen")
                .claim("picture", "https://example.org/a.png")
                .claim("firebase", Map.of("sign_in_provider", "google.com"));
        change.accept(b);
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).keyID("k1").build(), b.build());
        jwt.sign(new RSASSASigner(signer));
        return jwt.serialize();
    }

    static String codeOf(String token) {
        try {
            verifier.verify(token);
            return "accepted";
        } catch (ApiException e) {
            assertThat(e.status().value()).isEqualTo(401);
            return e.code();
        }
    }

    @Test
    void acceptsAValidGoogleSsoToken() throws Exception {
        TokenVerifier.TokenIdentity id = verifier.verify(token(key, b -> {}));
        assertThat(id.uid()).isEqualTo("uid-123");
        assertThat(id.email()).isEqualTo("alice@hyperdatalab.org");
        assertThat(id.name()).isEqualTo("Alice Nguyen");
        assertThat(id.picture()).isEqualTo("https://example.org/a.png");
    }

    @Test
    void rejectsATokenSignedWithAnotherKey() throws Exception {
        assertThat(codeOf(token(otherKey, b -> {}))).isEqualTo("invalid_token");
    }

    @Test
    void rejectsATokenForAnotherProject() throws Exception {
        assertThat(codeOf(token(key, b -> b.audience("someone-else")))).isEqualTo("invalid_token");
        assertThat(codeOf(token(key, b -> b.issuer("https://securetoken.google.com/someone-else")))).isEqualTo("invalid_token");
        assertThat(codeOf(token(key, b -> b.issuer("https://accounts.evil.example")))).isEqualTo("invalid_token");
    }

    @Test
    void rejectsExpiredAndFutureTokens() throws Exception {
        Instant now = Instant.now();
        assertThat(codeOf(token(key, b -> b.expirationTime(Date.from(now.minusSeconds(300)))))).isEqualTo("invalid_token");
        assertThat(codeOf(token(key, b -> b.issueTime(Date.from(now.plusSeconds(600)))))).isEqualTo("invalid_token");
        assertThat(codeOf(token(key, b -> b.claim("auth_time", now.plusSeconds(600).getEpochSecond())))).isEqualTo("invalid_token");
    }

    @Test
    void rejectsTokensMissingRequiredClaims() throws Exception {
        assertThat(codeOf(token(key, b -> b.subject(null)))).isEqualTo("invalid_token");
        assertThat(codeOf(token(key, b -> b.claim("email", null)))).isEqualTo("invalid_token");
        assertThat(codeOf(token(key, b -> b.claim("auth_time", null)))).isEqualTo("invalid_token");
    }

    @Test
    void rejectsUnverifiedEmails() throws Exception {
        assertThat(codeOf(token(key, b -> b.claim("email_verified", false)))).isEqualTo("unverified");
        assertThat(codeOf(token(key, b -> b.claim("email_verified", null)))).isEqualTo("unverified");
    }

    @Test
    void rejectsNonSsoSignInProviders() throws Exception {
        assertThat(codeOf(token(key, b -> b.claim("firebase", Map.of("sign_in_provider", "password"))))).isEqualTo("provider_not_allowed");
        assertThat(codeOf(token(key, b -> b.claim("firebase", Map.of("sign_in_provider", "anonymous"))))).isEqualTo("provider_not_allowed");
        assertThat(codeOf(token(key, b -> b.claim("firebase", null)))).isEqualTo("provider_not_allowed");
    }

    @Test
    void rejectsGarbageAndUnsignedTokens() {
        assertThat(codeOf("not-a-jwt")).isEqualTo("invalid_token");
        // alg=none header + payload, no signature
        assertThat(codeOf("eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.")).isEqualTo("invalid_token");
    }

    @Test
    void wrapsNothingElse() {
        assertThatThrownBy(() -> verifier.verify("")).isInstanceOf(ApiException.class);
    }
}
