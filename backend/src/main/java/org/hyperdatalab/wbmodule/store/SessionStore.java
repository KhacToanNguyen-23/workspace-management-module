package org.hyperdatalab.wbmodule.store;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentReference;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Sign-in sessions of the SSO mode, one document per session in {@code sessions}. The document id
 * is the SHA-256 of the bearer token, so reading the database never yields a usable token.
 * Expired documents are removed when they are next presented; a Firestore TTL policy on {@code
 * expiresAt} clears the ones that never come back.
 */
@Component
public class SessionStore {
    public record Session(String uid, String email, String name, String picture) {}

    public record Issued(String token, Instant expiresAt) {}

    private static final SecureRandom RANDOM = new SecureRandom();

    private final FirestoreStore firestore;

    public SessionStore(FirestoreStore firestore) {
        this.firestore = firestore;
    }

    private DocumentReference doc(String token) {
        try {
            byte[] hash =
                    MessageDigest.getInstance("SHA-256")
                            .digest(token.getBytes(StandardCharsets.UTF_8));
            return firestore.doc("sessions", HexFormat.of().formatHex(hash));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public Issued create(Session session, Duration life) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = "wbs_" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt = Instant.now().plus(life);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("uid", session.uid());
        fields.put("email", session.email());
        fields.put("name", session.name());
        fields.put("picture", session.picture());
        fields.put("createdAt", Timestamp.now());
        fields.put("expiresAt", Timestamp.of(Date.from(expiresAt)));
        FirestoreStore.await(doc(token).set(fields));
        return new Issued(token, expiresAt);
    }

    /** The session behind {@code token}, unless it is unknown or has expired. */
    public Optional<Session> find(String token) {
        DocumentReference ref = doc(token);
        Map<String, Object> d = FirestoreStore.await(ref.get()).getData();
        if (d == null) return Optional.empty();
        if (!(d.get("expiresAt") instanceof Timestamp t)
                || t.toDate().toInstant().isBefore(Instant.now())) {
            FirestoreStore.await(ref.delete());
            return Optional.empty();
        }
        return Optional.of(
                new Session(
                        FirestoreStore.text(d, "uid"),
                        FirestoreStore.text(d, "email"),
                        FirestoreStore.text(d, "name"),
                        FirestoreStore.text(d, "picture")));
    }

    public void delete(String token) {
        FirestoreStore.await(doc(token).delete());
    }
}
