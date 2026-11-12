package org.hyperdatalab.wbmodule.dev;

import com.google.cloud.Timestamp;
import com.google.cloud.firestore.DocumentReference;

import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.store.FirestoreStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Demo accounts and data for local development: one account per role and state, so every screen
 * can be tried without clicking through the whole flow first. Exists only when {@code
 * app.auth.mode=dev}; never active with Firebase sign-in.
 */
@Component
@Order(100)
@ConditionalOnProperty(name = "app.auth.mode", havingValue = "dev")
public class DevData implements CommandLineRunner {
    public static final String WORKSPACE_ID = "demo-lab";
    static final String WORKSPACE_REQUEST_ID = "demo-carol-lab";
    static final String DOWNLOAD_REQUEST_ID = "demo-download-alice";

    /** A demo account and what it is useful for on the login screen. */
    public record Account(
            String email, String name, String department, String role, boolean disabled, String note) {}

    public static final List<Account> ACCOUNTS =
            List.of(
                    new Account(
                            "admin@hyperdatalab.org",
                            "Lab Admin",
                            "/",
                            "admin",
                            false,
                            "Quản lý user, duyệt yêu cầu tạo workspace"),
                    new Account(
                            "manager@hyperdatalab.org",
                            "Manager Mai",
                            "/research",
                            "workspace_manager",
                            false,
                            "Quản lý Demo Lab: có 1 yêu cầu tham gia và 1 yêu cầu download đang chờ"),
                    new Account(
                            "alice@hyperdatalab.org",
                            "Alice Nguyen",
                            "/research",
                            "member",
                            false,
                            "Thành viên đã duyệt của Demo Lab, đã gửi 1 yêu cầu download"),
                    new Account(
                            "bob@hyperdatalab.org",
                            "Bob Tran",
                            "/review",
                            "member",
                            false,
                            "Đang chờ manager duyệt vào Demo Lab"),
                    new Account(
                            "carol@hyperdatalab.org",
                            "Carol Le",
                            "/research",
                            "member",
                            false,
                            "Đang chờ admin duyệt yêu cầu tạo workspace"),
                    new Account(
                            "dave@hyperdatalab.org",
                            "Dave Pham",
                            "/review",
                            "member",
                            false,
                            "Member mới, chưa thuộc workspace nào"),
                    new Account(
                            "disabled@hyperdatalab.org",
                            "Disabled User",
                            "/review",
                            "member",
                            true,
                            "Bị admin disable: đăng nhập sẽ bị chặn"));

    private static final List<String> COLLECTIONS =
            List.of(
                    "users",
                    "workspaces",
                    "memberships",
                    "workspaceRequests",
                    "downloadRequests",
                    "auditLog");

    private final FirestoreStore store;
    private final boolean seedOnStartup;
    private final boolean emulator;

    public DevData(
            FirestoreStore store,
            @Value("${app.dev-seed:false}") boolean seedOnStartup,
            @Value("${app.firestore.emulator-host:}") String emulatorHost) {
        this.store = store;
        this.seedOnStartup = seedOnStartup;
        this.emulator = emulatorHost != null && !emulatorHost.isBlank();
    }

    @Override
    public void run(String... args) {
        // Demo data never goes into a real Firestore database, only into the emulator.
        if (seedOnStartup && emulator) seed();
    }

    /** Deletes every business record and seeds the demo data again. Emulator only. */
    public void reset() {
        if (!emulator) {
            throw ApiException.conflict(
                    "emulator_only", "Demo data can only be reset on the Firestore emulator.");
        }
        for (String collection : COLLECTIONS) {
            for (var doc : store.all(collection)) {
                FirestoreStore.await(doc.getReference().delete());
            }
        }
        seed();
    }

    /** Creates the demo records that do not exist yet; existing records are left untouched. */
    public void seed() {
        Timestamp now = Timestamp.now();
        for (Account account : ACCOUNTS) {
            Map<String, Object> user = new LinkedHashMap<>();
            user.put("email", account.email());
            user.put("name", account.name());
            user.put("department", account.department());
            user.put("directoryStatus", "active");
            user.put("role", account.role());
            user.put("disabled", account.disabled());
            if (account.disabled()) {
                user.put("disabledAt", now);
                user.put("disabledBy", "admin@hyperdatalab.org");
            }
            if (account.email().startsWith("carol@")) {
                user.put("pendingWorkspaceRequestId", WORKSPACE_REQUEST_ID);
            }
            createIfMissing("users", account.email(), user);
        }

        createIfMissing(
                "workspaces",
                WORKSPACE_ID,
                Map.of(
                        "name", "Demo Lab",
                        "type", "research",
                        "description", "Workspace mẫu cho môi trường dev.",
                        "status", "active",
                        "createdBy", "admin@hyperdatalab.org",
                        "createdAt", now,
                        "managerEmails", List.of("manager@hyperdatalab.org"),
                        "memberCount", 2L,
                        "pendingCount", 1L));
        membership("manager@hyperdatalab.org", "manager", "approved", "", now);
        membership("alice@hyperdatalab.org", "member", "approved", "", now);
        membership("bob@hyperdatalab.org", "member", "pending", "Cho em tham gia nhóm ạ.", now);

        createIfMissing(
                "workspaceRequests",
                WORKSPACE_REQUEST_ID,
                Map.of(
                        "requester", "carol@hyperdatalab.org",
                        "name", "Carol Lab",
                        "type", "review",
                        "description", "Nhóm review bài viết.",
                        "reason", "Cần không gian riêng cho nhóm review.",
                        "status", "pending",
                        "requestedAt", now,
                        "decisionNote", ""));
        createIfMissing(
                "downloadRequests",
                DOWNLOAD_REQUEST_ID,
                Map.of(
                        "workspaceId", WORKSPACE_ID,
                        "requester", "alice@hyperdatalab.org",
                        "requesterName", "Alice Nguyen",
                        "paperRef", "https://arxiv.org/abs/1706.03762",
                        "note", "Attention Is All You Need",
                        "status", "pending",
                        "requestedAt", now,
                        "decisionNote", ""));
    }

    private void membership(String email, String role, String status, String note, Timestamp now) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("workspaceId", WORKSPACE_ID);
        data.put("userEmail", email);
        data.put("role", role);
        data.put("status", status);
        data.put("note", note);
        data.put("requestedAt", now);
        data.put("decisionNote", "");
        if ("approved".equals(status)) {
            data.put("decidedBy", "admin@hyperdatalab.org");
            data.put("decidedAt", now);
        }
        createIfMissing("memberships", WORKSPACE_ID + "_" + email, data);
    }

    private void createIfMissing(String collection, String id, Map<String, Object> data) {
        DocumentReference ref = store.doc(collection, id);
        if (!FirestoreStore.await(ref.get()).exists()) FirestoreStore.await(ref.create(data));
    }
}
