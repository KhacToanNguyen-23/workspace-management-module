package org.hyperdatalab.wbmodule.projects;

import com.fasterxml.jackson.databind.ObjectMapper;

import org.hyperdatalab.wbmodule.auth.AuthedUser;
import org.hyperdatalab.wbmodule.auth.TokenCipher;
import org.hyperdatalab.wbmodule.common.ApiException;
import org.hyperdatalab.wbmodule.common.AppProperties;
import org.hyperdatalab.wbmodule.identity.AuditService;
import org.hyperdatalab.wbmodule.identity.IdentityService;
import org.hyperdatalab.wbmodule.store.SessionStore;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Research projects, read from ResearchPulse with the signed-in user's own SSO token (kept
 * encrypted with their session at sign-in). ResearchPulse is the source of truth; nothing about
 * projects is stored here except the audit trail of admin changes.
 *
 * <p>The SSO token lives one hour and cannot be renewed: after that the page asks the user to
 * sign in again.
 */
@Service
public class ProjectService {
    private final ProjectSource source;
    private final String mode;
    private final SessionStore sessions;
    private final TokenCipher cipher;
    private final IdentityService identity;
    private final AuditService audit;

    public ProjectService(
            AppProperties props,
            ObjectMapper json,
            SessionStore sessions,
            TokenCipher cipher,
            IdentityService identity,
            AuditService audit) {
        String m = props.projects().mode();
        if (m.equals("auto")) m = "sso".equals(props.auth().mode()) ? "http" : "demo";
        this.mode = m;
        String base = props.projects().baseUrl();
        this.source =
                switch (m) {
                    case "http" ->
                            new HttpProjectSource(
                                    json,
                                    base == null || base.isBlank()
                                            ? props.auth().sso().baseUrl()
                                            : base);
                    case "demo" -> new DemoProjectSource();
                    case "off" -> null;
                    default ->
                            throw new IllegalStateException(
                                    "app.projects.mode must be auto, http, demo or off");
                };
        this.sessions = sessions;
        this.cipher = cipher;
        this.identity = identity;
        this.audit = audit;
    }

    private ProjectSource source() {
        if (source == null) throw ApiException.notFound("Research projects are turned off.");
        return source;
    }

    /** The user's SSO token for ResearchPulse; the sample source needs none. */
    private String userToken(String sessionToken) {
        if (!mode.equals("http")) return "";
        SessionStore.SsoGrant g =
                (sessionToken != null && sessionToken.startsWith("wbs_")
                                ? sessions.ssoGrant(sessionToken)
                                : java.util.Optional.<SessionStore.SsoGrant>empty())
                        .orElseThrow(
                                () ->
                                        ApiException.conflict(
                                                "scope_not_granted",
                                                "ResearchPulse chưa cho ứng dụng này đọc dự án."
                                                        + " Khi được bật, đăng nhập lại là xem"
                                                        + " được."));
        String token = g.expiresAt().isAfter(Instant.now()) ? cipher.decrypt(g.sealedToken()) : null;
        if (token == null)
            throw ApiException.conflict(
                    "sso_token_expired",
                    "Quyền xem dự án chỉ kéo dài một giờ sau khi đăng nhập. Đăng nhập lại để xem"
                            + " tiếp.");
        return token;
    }

    /** The projects, and what the page may show about them. */
    public Map<String, Object> list(AuthedUser u, String sessionToken) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("mode", mode);
        out.put("listsAll", source != null && source.listsAll());
        out.put("canManageMembers", source != null && source.managesMembers() && u.admin());
        out.put("items", source == null ? List.of() : source.list(userToken(sessionToken)));
        return out;
    }

    /** One project with its members; only admins see the members' email addresses. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> detail(AuthedUser u, String sessionToken, String projectId) {
        Map<String, Object> p =
                source().get(userToken(sessionToken), projectId)
                        .orElseThrow(() -> ApiException.notFound("Research project not found."));
        if (!u.admin() && p.get("members") instanceof List<?> list)
            p.put(
                    "members",
                    list.stream()
                            .map(
                                    m -> {
                                        Map<String, Object> x =
                                                new LinkedHashMap<>((Map<String, Object>) m);
                                        x.remove("email");
                                        return x;
                                    })
                            .toList());
        p.put("canManageMembers", source().managesMembers() && u.admin());
        return p;
    }

    private static void requireAdmin(AuthedUser u) {
        if (!u.admin())
            throw ApiException.forbidden("admin_only", "Only an admin can change project members.");
    }

    public Map<String, Object> addMember(
            AuthedUser u, String projectId, String email, String role) {
        requireAdmin(u);
        String e = email.trim().toLowerCase(Locale.ROOT);
        if (!identity.isOrgEmail(e))
            throw ApiException.unprocessable(
                    "wrong_domain", "Only addresses of the org domain can join a project.");
        Map<String, Object> m = source().addMember(projectId, e, role, u.email());
        audit.log(
                u.email(), "project.member.add", e, null, Map.of("project", projectId, "role", role));
        return m;
    }

    public Map<String, Object> updateMember(
            AuthedUser u, String projectId, String uid, String role) {
        requireAdmin(u);
        Map<String, Object> m = source().updateMember(projectId, uid, role, u.email());
        audit.log(
                u.email(),
                "project.member.role",
                String.valueOf(m.getOrDefault("email", uid)),
                null,
                Map.of("project", projectId, "role", role));
        return m;
    }

    public void removeMember(AuthedUser u, String projectId, String uid) {
        requireAdmin(u);
        source().removeMember(projectId, uid, u.email());
        audit.log(u.email(), "project.member.remove", uid, null, Map.of("project", projectId));
    }
}
