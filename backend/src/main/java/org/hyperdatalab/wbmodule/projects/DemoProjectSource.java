package org.hyperdatalab.wbmodule.projects;

import org.hyperdatalab.wbmodule.common.ApiException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Sample projects kept in memory, for local development and demos until the ResearchPulse
 * project API is live. Member changes work and last until the backend restarts. It follows the
 * same rules the real API is expected to: one membership per person, a project keeps at least one
 * owner.
 */
public class DemoProjectSource implements ProjectSource {
    private final Map<String, Map<String, Object>> projects = new LinkedHashMap<>();
    private final Map<String, List<Map<String, Object>>> members = new LinkedHashMap<>();

    public DemoProjectSource() {
        add("demo-writingbank", "WritingBank", "Ngân hàng bài viết học thuật và công cụ hỗ trợ viết.", "NLP",
                "manager@hyperdatalab.org", "alice@hyperdatalab.org");
        add("demo-wordbank", "WordBank", "Kho từ vựng học thuật theo lĩnh vực.", "NLP",
                "alice@hyperdatalab.org", "bob@hyperdatalab.org");
        add("demo-understanding", "Understanding", "Đọc hiểu và tóm tắt bài báo khoa học.", "AI",
                "manager@hyperdatalab.org");
    }

    private static String uid(String email) {
        return "demo-" + email.substring(0, email.indexOf('@'));
    }

    private static Map<String, Object> member(String email, String role) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("uid", uid(email));
        m.put("email", email);
        String local = email.substring(0, email.indexOf('@'));
        m.put("name", local.substring(0, 1).toUpperCase(Locale.ROOT) + local.substring(1));
        m.put("role", role);
        m.put("status", "ACTIVE");
        return m;
    }

    private void add(String id, String title, String description, String area, String owner, String... others) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("id", id);
        p.put("title", title);
        p.put("description", description);
        p.put("researchArea", area);
        p.put("ownerUid", uid(owner));
        p.put("createdAt", "2026-08-15T08:00:00.000Z");
        p.put("updatedAt", "2026-11-10T08:00:00.000Z");
        projects.put(id, p);
        List<Map<String, Object>> list = new ArrayList<>();
        list.add(member(owner, "OWNER"));
        for (String o : others) list.add(member(o, "MEMBER"));
        members.put(id, list);
    }

    private List<Map<String, Object>> membersOf(String projectId) {
        List<Map<String, Object>> list = members.get(projectId);
        if (list == null)
            throw new ApiException(
                    org.springframework.http.HttpStatus.NOT_FOUND,
                    "project_not_found",
                    "Research project not found.");
        return list;
    }

    private static Map<String, Object> find(List<Map<String, Object>> list, String uid) {
        return list.stream()
                .filter(m -> uid.equals(m.get("uid")))
                .findFirst()
                .orElseThrow(
                        () ->
                                new ApiException(
                                        org.springframework.http.HttpStatus.NOT_FOUND,
                                        "member_not_found",
                                        "This person is not a member of the project."));
    }

    private static void keepAnOwner(List<Map<String, Object>> after) {
        if (after.stream().noneMatch(m -> "OWNER".equals(m.get("role"))))
            throw ApiException.conflict("last_owner", "A project must keep at least one owner.");
    }

    @Override
    public boolean listsAll() {
        return true;
    }

    @Override
    public boolean managesMembers() {
        return true;
    }

    @Override
    public synchronized List<Map<String, Object>> list(String userToken) {
        return projects.values().stream().map(p -> (Map<String, Object>) new LinkedHashMap<>(p)).toList();
    }

    @Override
    public synchronized Optional<Map<String, Object>> get(String userToken, String projectId) {
        Map<String, Object> p = projects.get(projectId);
        if (p == null) return Optional.empty();
        Map<String, Object> out = new LinkedHashMap<>(p);
        out.put("members", members.get(projectId).stream().map(m -> (Map<String, Object>) new LinkedHashMap<>(m)).toList());
        return Optional.of(out);
    }

    @Override
    public synchronized Map<String, Object> addMember(String projectId, String email, String role, String actor) {
        List<Map<String, Object>> list = membersOf(projectId);
        if (list.stream().anyMatch(m -> email.equals(m.get("email"))))
            throw ApiException.conflict("already_member", email + " is already a member of the project.");
        Map<String, Object> m = member(email, role);
        list.add(m);
        return new LinkedHashMap<>(m);
    }

    @Override
    public synchronized Map<String, Object> updateMember(String projectId, String uid, String role, String actor) {
        List<Map<String, Object>> list = membersOf(projectId);
        Map<String, Object> m = find(list, uid);
        List<Map<String, Object>> after = new ArrayList<>(list);
        after.remove(m);
        Map<String, Object> changed = new LinkedHashMap<>(m);
        changed.put("role", role);
        after.add(changed);
        keepAnOwner(after);
        m.put("role", role);
        return new LinkedHashMap<>(m);
    }

    @Override
    public synchronized void removeMember(String projectId, String uid, String actor) {
        List<Map<String, Object>> list = membersOf(projectId);
        Map<String, Object> m = find(list, uid);
        List<Map<String, Object>> after = new ArrayList<>(list);
        after.remove(m);
        keepAnOwner(after);
        list.remove(m);
    }
}
