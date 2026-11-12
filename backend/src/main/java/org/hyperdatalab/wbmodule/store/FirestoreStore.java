package org.hyperdatalab.wbmodule.store;

import com.google.api.core.ApiFuture;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.Transaction;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class FirestoreStore {
    private final Firestore firestore;

    public FirestoreStore(Firestore firestore) {
        this.firestore = firestore;
    }

    public Firestore firestore() {
        return firestore;
    }

    public DocumentReference doc(String collection, String id) {
        return firestore.collection(collection).document(id);
    }

    public Optional<Map<String, Object>> get(String collection, String id) {
        return Optional.ofNullable(await(doc(collection, id).get()).getData());
    }

    public List<DocumentSnapshot> all(String collection) {
        return await(firestore.collection(collection).get()).getDocuments().stream()
                .map(x -> (DocumentSnapshot) x)
                .toList();
    }

    public List<DocumentSnapshot> equal(String collection, String field, Object value) {
        return await(firestore.collection(collection).whereEqualTo(field, value).get())
                .getDocuments()
                .stream()
                .map(x -> (DocumentSnapshot) x)
                .toList();
    }

    public List<DocumentSnapshot> arrayContains(String collection, String field, Object value) {
        return await(firestore.collection(collection).whereArrayContains(field, value).get())
                .getDocuments()
                .stream()
                .map(x -> (DocumentSnapshot) x)
                .toList();
    }

    public <T> T transaction(Transaction.Function<T> fn) {
        return await(firestore.runTransaction(fn));
    }

    public static <T> T await(ApiFuture<T> future) {
        try {
            return future.get();
        } catch (Exception e) {
            Throwable cause = e.getCause();
            if (cause instanceof org.hyperdatalab.wbmodule.common.ApiException api) throw api;
            if (cause instanceof RuntimeException runtime) throw runtime;
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    /**
     * The document's fields as stored (timestamps stay {@link com.google.cloud.Timestamp}). Stores
     * map records from this; use {@link #data} only to build a JSON response.
     */
    public static Map<String, Object> raw(DocumentSnapshot snapshot) {
        Map<String, Object> fields = snapshot.getData();
        return fields == null ? new LinkedHashMap<>() : new LinkedHashMap<>(fields);
    }

    public static Map<String, Object> data(DocumentSnapshot s) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (s.getData() != null) s.getData().forEach((k, v) -> out.put(k, jsonValue(v)));
        return out;
    }

    public static Map<String, Object> jsonData(Map<String, Object> input) {
        Map<String, Object> out = new LinkedHashMap<>();
        input.forEach((k, v) -> out.put(k, jsonValue(v)));
        return out;
    }

    private static Object jsonValue(Object v) {
        if (v instanceof com.google.cloud.Timestamp t) return t.toDate().toInstant().toString();
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, x) -> out.put(String.valueOf(k), jsonValue(x)));
            return out;
        }
        if (v instanceof List<?> l) return l.stream().map(FirestoreStore::jsonValue).toList();
        return v;
    }

    public static String text(Map<String, Object> d, String key) {
        Object v = d.get(key);
        return v == null ? null : String.valueOf(v);
    }

    public static boolean bool(Map<String, Object> d, String key) {
        return Boolean.TRUE.equals(d.get(key));
    }
}
