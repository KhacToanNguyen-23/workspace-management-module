package org.hyperdatalab.wbmodule.common;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Permission model.
 * <ul>
 *   <li>Global role {@code admin} (admin@hyperdatalab.org and promoted users) can do everything.</li>
 *   <li>Workspace role viewer &lt; member &lt; manager, granted when a manager approves a join request.</li>
 *   <li>Workspace permissions: the set a manager or admin switches on for the workspace.</li>
 * </ul>
 * Effective permissions = role permissions ∩ enabled permissions. {@code members.manage} is never
 * gated by the switch, so a manager can always approve requests and switch permissions back on.
 *
 * <p>The workspace.* codes are generic on purpose: when the module is merged into Writing Bank,
 * each feature checks one of them (e.g. editing phrases → workspace.write, approving → workspace.review).
 */
public final class Permissions {
    public static final String READ = "workspace.read";
    public static final String WRITE = "workspace.write";
    public static final String REVIEW = "workspace.review";
    public static final String MEMBERS_MANAGE = "members.manage";

    public static final List<String> ALL = List.of(READ, WRITE, REVIEW, MEMBERS_MANAGE);
    public static final List<String> TOGGLEABLE = List.of(READ, WRITE, REVIEW);
    public static final String TOGGLEABLE_PATTERN = "workspace\\.read|workspace\\.write|workspace\\.review";
    public static final List<String> ROLES = List.of("viewer", "member", "manager");

    private static final Map<String, List<String>> ROLE_PERMISSIONS = Map.of(
            "viewer", List.of(READ),
            "member", List.of(READ, WRITE, REVIEW),
            "manager", ALL);

    private Permissions() {}

    public static List<String> forRole(String role) {
        return ROLE_PERMISSIONS.getOrDefault(role, List.of());
    }

    public static List<String> effective(String role, Collection<String> enabled, boolean admin) {
        if (admin) return ALL;
        if (role == null) return List.of();
        Set<String> on = Set.copyOf(enabled);
        List<String> out = new ArrayList<>();
        for (String p : forRole(role)) {
            if (p.equals(MEMBERS_MANAGE) || on.contains(p)) out.add(p);
        }
        return out;
    }
}
