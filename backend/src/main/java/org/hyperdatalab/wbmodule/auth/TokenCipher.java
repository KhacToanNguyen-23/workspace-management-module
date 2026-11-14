package org.hyperdatalab.wbmodule.auth;

import org.hyperdatalab.wbmodule.common.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Encrypts the SSO access tokens kept server-side (AES-256-GCM), so a copy of the database alone
 * cannot call ResearchPulse as the users. Key: app.auth.sso.token-key (SSO_TOKEN_KEY, base64 of
 * 32 bytes). Without one a random key is made at start: stored tokens are then lost on restart
 * and it must not be used with more than one backend instance.
 */
@Component
public class TokenCipher {
    private static final Logger log = LoggerFactory.getLogger(TokenCipher.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec key;

    @Autowired
    public TokenCipher(AppProperties props) {
        this(props.auth().sso().tokenKey(), "sso".equals(props.auth().mode()));
    }

    TokenCipher(String configured, boolean warn) {
        byte[] bytes;
        if (configured == null || configured.isBlank()) {
            bytes = new byte[32];
            RANDOM.nextBytes(bytes);
            if (warn)
                log.warn(
                        "SSO_TOKEN_KEY is not set: a random key is used, so users must sign in"
                                + " again after a restart to see their projects.");
        } else {
            bytes = Base64.getDecoder().decode(configured.trim());
            if (bytes.length != 32)
                throw new IllegalStateException(
                        "SSO_TOKEN_KEY must be base64 of exactly 32 bytes (got "
                                + bytes.length
                                + ").");
        }
        key = new SecretKeySpec(bytes, "AES");
    }

    public String encrypt(String plain) {
        try {
            byte[] iv = new byte[IV_BYTES];
            RANDOM.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] sealed = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder()
                    .encodeToString(
                            ByteBuffer.allocate(iv.length + sealed.length)
                                    .put(iv)
                                    .put(sealed)
                                    .array());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Could not encrypt a token.", e);
        }
    }

    /** The plain text, or null when it was sealed with another key or was tampered with. */
    public String decrypt(String sealed) {
        try {
            byte[] all = Base64.getDecoder().decode(sealed);
            if (all.length <= IV_BYTES) return null;
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, all, 0, IV_BYTES));
            return new String(
                    c.doFinal(all, IV_BYTES, all.length - IV_BYTES), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            return null;
        }
    }
}
