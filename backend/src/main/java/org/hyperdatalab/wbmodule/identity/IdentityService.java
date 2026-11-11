package org.hyperdatalab.wbmodule.identity;

import com.google.cloud.Timestamp;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.auth.TokenVerifier.TokenIdentity;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.hyperdatalab.wbmodule.directory.UserDirectory;
import org.hyperdatalab.wbmodule.directory.UserDirectory.DirectoryUser;
import org.hyperdatalab.wbmodule.store.UserStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

@Service
public class IdentityService {
    private static final Logger log = LoggerFactory.getLogger(IdentityService.class);

    public record UserRow(
            String email,
            String authUid,
            String name,
            String photoUrl,
            String department,
            String directoryStatus,
            String globalRole,
            boolean disabled,
            OffsetDateTime firstSeen,
            OffsetDateTime lastSeen,
            OffsetDateTime syncedAt) {}

    private final UserStore users;
    private final AppProperties props;
    private final UserDirectory directory;
    private final AuditService audit;

    public IdentityService(
            UserStore users, AppProperties props, UserDirectory directory, AuditService audit) {
        this.users = users;
        this.props = props;
        this.directory = directory;
        this.audit = audit;
    }

    public boolean isOrgEmail(String email) {
        if (email == null) return false;
        int at = email.indexOf('@');
        return at > 0
                && at == email.lastIndexOf('@')
                && email.substring(at + 1).equalsIgnoreCase(props.orgDomain());
    }

    public Optional<UserRow> find(String email) {
        return users.find(email).map(this::row);
    }

    private static OffsetDateTime time(Object v) {
        if (v instanceof Timestamp t) return t.toDate().toInstant().atOffset(ZoneOffset.UTC);
        return null;
    }

    private UserRow row(UserStore.User user) {
        return new UserRow(
                user.email(),
                user.authUid(),
                user.name() == null ? "" : user.name(),
                user.photoUrl(),
                user.department(),
                user.directoryStatus() == null ? "unknown" : user.directoryStatus(),
                user.role() == null ? "member" : user.role(),
                user.disabled(),
                time(user.firstSeen()),
                time(user.lastSeen()),
                time(user.syncedAt()));
    }

    public AuthedUser resolve(TokenIdentity id) {
        String email = id.email().toLowerCase(Locale.ROOT);
        if (!isOrgEmail(email))
            throw ApiException.forbidden(
                    "wrong_domain",
                    "Only @" + props.orgDomain() + " accounts can use this module.");
        Optional<UserRow> prior = find(email);
        boolean off = directory.mode().equals("off");
        boolean stale =
                prior.map(
                                r ->
                                        r.syncedAt() == null
                                                || r.syncedAt()
                                                        .isBefore(
                                                                OffsetDateTime.now()
                                                                        .minus(
                                                                                Duration.ofHours(
                                                                                        props.directory()
                                                                                                .cacheHours()))))
                        .orElse(true);
        boolean check =
                !off && (stale || !"active".equals(prior.map(UserRow::directoryStatus).orElse("")));
        Optional<DirectoryUser> du = check ? directory.find(email) : Optional.empty();
        String status =
                check
                        ? du.map(x -> x.suspended() ? "suspended" : "active").orElse("missing")
                        : prior.map(UserRow::directoryStatus).orElse("unknown");
        boolean forced = email.equalsIgnoreCase(props.adminEmail());
        String name =
                du.map(DirectoryUser::name)
                        .filter(x -> !x.isBlank())
                        .or(() -> prior.map(UserRow::name).filter(x -> !x.isBlank()))
                        .orElse(
                                id.name() == null || id.name().isBlank()
                                        ? email.substring(0, email.indexOf('@'))
                                        : id.name());
        Map<String, Object> vals = new LinkedHashMap<>();
        vals.put("email", email);
        vals.put("authUid", id.uid());
        vals.put("name", name);
        vals.put(
                "photoUrl",
                du.map(DirectoryUser::photoUrl)
                        .orElseGet(() -> prior.map(UserRow::photoUrl).orElse(id.picture())));
        vals.put(
                "department",
                du.map(DirectoryUser::department)
                        .orElseGet(() -> prior.map(UserRow::department).orElse(null)));
        vals.put("directoryStatus", status);
        vals.put("lastSeen", Timestamp.now());
        if (check) vals.put("syncedAt", Timestamp.now());
        users.transaction(
                tx -> {
                    UserStore.User existing = users.find(tx, email).orElse(null);
                    vals.put(
                            "role",
                            forced
                                    ? "admin"
                                    : existing == null || existing.role() == null
                                            ? "member"
                                            : existing.role());
                    vals.put("disabled", existing != null && existing.disabled());
                    vals.put(
                            "firstSeen",
                            existing == null || existing.firstSeen() == null
                                    ? Timestamp.now()
                                    : existing.firstSeen());
                    users.merge(tx, email, vals);
                    if (existing == null)
                        audit.log(tx, email, "user.first_sign_in", email, null, Map.of());
                    return null;
                });
        UserRow saved = find(email).orElseThrow();
        if (status.equals("missing"))
            throw ApiException.forbidden(
                    "not_in_directory",
                    email + " is not registered under " + props.orgDomain() + ".");
        if (status.equals("suspended"))
            throw ApiException.forbidden(
                    "suspended",
                    email + " is suspended in the " + props.orgDomain() + " directory.");
        if (saved.disabled() && !forced)
            throw ApiException.forbidden(
                    "disabled", "This account was disabled by an administrator.");
        return new AuthedUser(email, saved.name(), saved.globalRole());
    }

    public String refreshFromDirectory(String email) {
        if (!isOrgEmail(email))
            throw ApiException.unprocessable("wrong_domain", "Only addresses of the org domain.");
        if (directory.mode().equals("off"))
            return find(email).map(UserRow::directoryStatus).orElse("unknown");
        Optional<DirectoryUser> u = directory.find(email);
        String status = u.map(x -> x.suspended() ? "suspended" : "active").orElse("missing");
        Map<String, Object> d = new HashMap<>();
        d.put("email", email);
        d.put("directoryStatus", status);
        d.put("syncedAt", Timestamp.now());
        u.ifPresent(
                x -> {
                    d.put("name", x.name());
                    d.put("photoUrl", x.photoUrl());
                    d.put("department", x.department());
                });
        users.merge(email, d);
        return status;
    }

    public record SyncResult(int listed, int missing, String mode) {}

    public SyncResult syncDirectory(String actor) {
        List<DirectoryUser> list = directory.listAll();
        List<UserStore.DirectorySnapshot> snapshot =
                list.stream()
                        .map(
                                user ->
                                        new UserStore.DirectorySnapshot(
                                                user.email().toLowerCase(Locale.ROOT),
                                                user.name(),
                                                user.photoUrl(),
                                                user.department(),
                                                user.suspended() ? "suspended" : "active"))
                        .toList();
        int missing = users.syncDirectory(snapshot);
        audit.log(
                actor,
                "directory.sync",
                "",
                null,
                Map.of("listed", list.size(), "missing", missing, "mode", directory.mode()));
        return new SyncResult(list.size(), missing, directory.mode());
    }

    @Scheduled(cron = "0 0 2 * * *", zone = "Asia/Ho_Chi_Minh")
    public void nightlySync() {
        if (directory.mode().equals("off")) return;
        try {
            SyncResult r = syncDirectory("system:cron");
            log.info("Directory sync: {} listed, {} missing", r.listed(), r.missing());
        } catch (Exception e) {
            log.warn("Directory sync failed: {}", e.getMessage());
        }
    }
}
