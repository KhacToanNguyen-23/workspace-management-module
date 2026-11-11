package org.hyperdatalab.wbmodule;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * Runs the app against the Firestore emulator with dev tokens and a mock directory. Start it with
 * `npm run db:up` (docker compose up -d firestore).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class IntegrationTest {
    public static final String ADMIN = "admin@hyperdatalab.org";
    public static final String MANAGER = "manager@hyperdatalab.org";
    public static final String ALICE = "alice@hyperdatalab.org";
    public static final String BOB = "bob@hyperdatalab.org";

    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper json;
    @Autowired protected FirestoreStore store;

    @BeforeEach
    void cleanDatabase() {
        for (String collection :
                java.util.List.of(
                        "users",
                        "workspaces",
                        "workspaceSlugs",
                        "memberships",
                        "workspaceRequests",
                        "downloadRequests",
                        "auditLog")) {
            for (var doc : store.all(collection))
                org.hyperdatalab.wbmodule.store.FirestoreStore.await(doc.getReference().delete());
        }
    }

    public record Res(int status, JsonNode body) {
        public String code() {
            return body.path("error").path("code").asText();
        }
    }

    protected Res call(String method, String path, String as, Object body) throws Exception {
        MockHttpServletRequestBuilder req =
                MockMvcRequestBuilders.request(
                        org.springframework.http.HttpMethod.valueOf(method),
                        java.net.URI.create(path));
        if (as != null) req.header("Authorization", "Bearer dev:" + as);
        if (body != null)
            req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        MvcResult r = mvc.perform(req).andReturn();
        String text = r.getResponse().getContentAsString();
        return new Res(
                r.getResponse().getStatus(),
                text.isEmpty() ? json.nullNode() : json.readTree(text));
    }

    protected Res get(String path, String as) throws Exception {
        return call("GET", path, as, null);
    }

    /** Admin creates a workspace of the given type managed by MANAGER; returns its id. */
    protected String seedWorkspace(String type) throws Exception {
        Res r =
                call(
                        "POST",
                        "/api/admin/workspaces",
                        ADMIN,
                        java.util.Map.of(
                                "name",
                                "Writing Lab " + type,
                                "slug",
                                "writing-lab-" + type,
                                "type",
                                type,
                                "managers",
                                java.util.List.of(MANAGER)));
        if (r.status() != 201) throw new AssertionError(r.body().toString());
        return r.body().path("id").asText();
    }

    /**
     * `who` requests to join and MANAGER approves with the given role; returns the membership id.
     */
    protected String joinAndApprove(String wid, String who, String role) throws Exception {
        call("POST", "/api/workspaces/" + wid + "/join", who, java.util.Map.of("note", "please"));
        Res pending = get("/api/w/" + wid + "/members?status=pending", MANAGER);
        String mid = null;
        for (JsonNode m : pending.body())
            if (m.path("email").asText().equals(who)) mid = m.path("id").asText();
        Res ok =
                call(
                        "POST",
                        "/api/w/" + wid + "/members/" + mid + "/approve",
                        MANAGER,
                        java.util.Map.of());
        if (ok.status() != 200) throw new AssertionError(ok.body().toString());
        return mid;
    }
}
