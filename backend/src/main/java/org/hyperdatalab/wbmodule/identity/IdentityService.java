package org.hyperdatalab.wbmodule.identity;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.auth.TokenVerifier.TokenIdentity;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.hyperdatalab.wbmodule.directory.UserDirectory;
import org.hyperdatalab.wbmodule.directory.UserDirectory.DirectoryUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Links a signed-in Google account to an app user, checked against the user directory. */
@Service
public class IdentityService {
    private static final Logger log = LoggerFactory.getLogger(IdentityService.class);

    public record UserRow(String email, String authUid, String name, String photoUrl, String department,
                          String directoryStatus, String globalRole, boolean disabled,
                          OffsetDateTime firstSeen, OffsetDateTime lastSeen, OffsetDateTime syncedAt) {}

    private final JdbcClient db;
    private final AppProperties props;
    private final UserDirectory directory;
    private final AuditService audit;

    public IdentityService(JdbcClient db, AppProperties props, UserDirectory directory, AuditService audit) {
        this.db = db;
        this.props = props;
        this.directory = directory;
        this.audit = audit;
    }

    public boolean isOrgEmail(String email) {
        if (email == null) return false;
        int at = email.indexOf('@');
        return at > 0 && at == email.lastIndexOf('@')
                && email.substring(at + 1).equalsIgnoreCase(props.orgDomain());
    }

    public Optional<UserRow> find(String email) {
        return db.sql("SELECT * FROM users WHERE email = ?").param(email).query(UserRow.class).optional();
    }

    /**
     * Domain check → directory check (cached) → upsert → admin / disabled checks.
     * The upsert is kept even when access is refused, so admins can see who tried to sign in.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public AuthedUser resolve(TokenIdentity id) {
        String email = id.email().toLowerCase(Locale.ROOT);
        if (!isOrgEmail(email)) {
            throw ApiException.forbidden("wrong_domain", "Only @" + props.orgDomain() + " accounts can use this module.");
        }
        Optional<UserRow> row = find(email);
        boolean directoryOff = directory.mode().equals("off");
        boolean stale = row.map(r -> r.syncedAt() == null
                        || r.syncedAt().isBefore(OffsetDateTime.now().minus(Duration.ofHours(props.directory().cacheHours()))))
                .orElse(true);
        boolean mustCheck = !directoryOff && (stale || !"active".equals(row.get().directoryStatus()));

        Optional<DirectoryUser> dirUser = Optional.empty();
        String status;
        if (mustCheck) {
            dirUser = directory.find(email);
            status = dirUser.map(u -> u.suspended() ? "suspended" : "active").orElse("missing");
        } else {
            status = row.map(UserRow::directoryStatus).orElse(directoryOff ? "unknown" : "active");
        }

        boolean forcedAdmin = email.equalsIgnoreCase(props.adminEmail());
        String name = dirUser.map(DirectoryUser::name).filter(s -> !s.isBlank())
                .or(() -> row.map(UserRow::name).filter(s -> !s.isBlank()))
                .orElse(id.name() == null || id.name().isBlank() ? email.substring(0, email.indexOf('@')) : id.name());
        String photo = dirUser.map(DirectoryUser::photoUrl).or(() -> row.map(UserRow::photoUrl)).orElse(id.picture());
        String department = dirUser.map(DirectoryUser::department).or(() -> row.map(UserRow::department)).orElse(null);

        db.sql("""
                INSERT INTO users (email, auth_uid, name, photo_url, department, directory_status, global_role,
                                   first_seen, last_seen, synced_at)
                VALUES (:email, :uid, :name, :photo, :dept, :status, :role, now(), now(), CASE WHEN :checked THEN now() END)
                ON CONFLICT (email) DO UPDATE SET
                  auth_uid = EXCLUDED.auth_uid, name = EXCLUDED.name, photo_url = EXCLUDED.photo_url,
                  department = EXCLUDED.department, directory_status = EXCLUDED.directory_status,
                  global_role = CASE WHEN :forced THEN 'admin' ELSE users.global_role END,
                  first_seen = COALESCE(users.first_seen, EXCLUDED.first_seen),
                  last_seen = now(),
                  synced_at = CASE WHEN :checked THEN now() ELSE users.synced_at END
                """)
                .param("email", email).param("uid", id.uid()).param("name", name).param("photo", photo)
                .param("dept", department).param("status", status).param("role", forcedAdmin ? "admin" : "user")
                .param("checked", mustCheck).param("forced", forcedAdmin)
                .update();
        if (row.map(r -> r.firstSeen() == null).orElse(true)) {
            audit.log(email, "user.first_sign_in", email, null);
        }
        UserRow saved = find(email).orElseThrow();

        if ("missing".equals(status)) {
            throw ApiException.forbidden("not_in_directory", email + " is not registered under " + props.orgDomain() + ".");
        }
        if ("suspended".equals(status)) {
            throw ApiException.forbidden("suspended", email + " is suspended in the " + props.orgDomain() + " directory.");
        }
        if (saved.disabled() && !forcedAdmin) {
            throw ApiException.forbidden("disabled", "This account was disabled by an administrator.");
        }
        return new AuthedUser(email, saved.name(), "admin".equals(saved.globalRole()));
    }

    /** Looks one address up in the directory and stores the result; returns the directory status. */
    @Transactional
    public String refreshFromDirectory(String email) {
        if (!isOrgEmail(email)) throw ApiException.unprocessable("wrong_domain", "Only addresses of the org domain.");
        if (directory.mode().equals("off")) return find(email).map(UserRow::directoryStatus).orElse("unknown");
        Optional<DirectoryUser> u = directory.find(email);
        String status = u.map(x -> x.suspended() ? "suspended" : "active").orElse("missing");
        db.sql("""
                INSERT INTO users (email, name, photo_url, department, directory_status, synced_at)
                VALUES (?, ?, ?, ?, ?, now())
                ON CONFLICT (email) DO UPDATE SET
                  name = CASE WHEN EXCLUDED.name = '' THEN users.name ELSE EXCLUDED.name END,
                  photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url),
                  department = COALESCE(EXCLUDED.department, users.department),
                  directory_status = EXCLUDED.directory_status, synced_at = now()
                """).params(email, u.map(DirectoryUser::name).orElse(""), u.map(DirectoryUser::photoUrl).orElse(null),
                u.map(DirectoryUser::department).orElse(null), status).update();
        return status;
    }

    public record SyncResult(int listed, int missing, String mode) {}

    /** Pulls every domain user into the users table; users no longer listed become `missing`. */
    @Transactional
    public SyncResult syncDirectory(String actor) {
        List<DirectoryUser> users = directory.listAll();
        Set<String> seen = new HashSet<>();
        for (DirectoryUser u : users) {
            String email = u.email().toLowerCase(Locale.ROOT);
            seen.add(email);
            db.sql("""
                    INSERT INTO users (email, name, photo_url, department, directory_status, synced_at)
                    VALUES (?, ?, ?, ?, ?, now())
                    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, photo_url = EXCLUDED.photo_url,
                      department = EXCLUDED.department, directory_status = EXCLUDED.directory_status, synced_at = now()
                    """)
                    .params(email, u.name(), u.photoUrl(), u.department(), u.suspended() ? "suspended" : "active")
                    .update();
        }
        int missing = 0;
        if (!users.isEmpty()) {
            List<String> known = db.sql("SELECT email FROM users WHERE directory_status IN ('active','suspended')")
                    .query(String.class).list();
            for (String email : known) {
                if (!seen.contains(email)) {
                    missing++;
                    db.sql("UPDATE users SET directory_status = 'missing', synced_at = now() WHERE email = ?").param(email).update();
                }
            }
        }
        audit.log(actor, "directory.sync", "", null, Map.of("listed", users.size(), "missing", missing, "mode", directory.mode()));
        return new SyncResult(users.size(), missing, directory.mode());
    }

    /** Nightly sync (02:00 Asia/Ho_Chi_Minh). */
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
