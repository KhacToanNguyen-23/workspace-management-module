package org.hyperdatalab.wbmodule.workspace;

import org.hyperdatalab.wbmodule.store.MembershipStore;
import org.hyperdatalab.wbmodule.store.WorkspaceStore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The single JSON representation of a workspace used by every endpoint. */
public final class WorkspaceViews {
    private WorkspaceViews() {}

    /**
     * @param mine the caller's membership in this workspace, or null
     * @param showPending whether the caller may see the number of pending join requests
     */
    public static Map<String, Object> of(
            WorkspaceStore store,
            WorkspaceStore.Workspace workspace,
            MembershipStore.Membership mine,
            boolean showPending) {
        Map<String, Object> view = new LinkedHashMap<>(store.asMap(workspace));
        Object managers = view.remove("managerEmails");
        view.put("managers", managers == null ? List.of() : managers);
        if (!showPending) view.remove("pendingCount");
        if (mine != null) {
            view.put("myStatus", mine.status());
            view.put("myRole", mine.role());
        }
        return view;
    }
}
