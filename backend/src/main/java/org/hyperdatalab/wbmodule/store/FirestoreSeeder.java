package org.hyperdatalab.wbmodule.store;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
public class FirestoreSeeder implements CommandLineRunner {
    private final FirestoreStore store;

    public FirestoreSeeder(FirestoreStore store) {
        this.store = store;
    }

    @Override
    public void run(String... args) {
        seed("research", "Research", "Team that builds and edits Writing Bank content.");
        seed("review", "Review", "Team that reviews and approves content.");
        seed("readonly", "Read only", "Read access only.");
    }

    private void seed(String code, String name, String description) {
        var ref = store.doc("workspaceTypes", code);
        if (!FirestoreStore.await(ref.get()).exists())
            FirestoreStore.await(
                    ref.create(Map.of("code", code, "name", name, "description", description)));
    }
}
