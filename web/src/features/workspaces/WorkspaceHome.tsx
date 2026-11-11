import { useMe, useWorkspace } from "../../app/contexts";
import { ErrorBox, Loading, PageHeader } from "../../shared/components/ui";
import { useQuery } from "../../shared/lib/api";
import { PERMISSION_LABEL, type Permission, type Person, ROLE_LABEL } from "../../shared/lib/types";

const ALL: Permission[] = ["workspace.read", "workspace.write", "workspace.review", "members.manage"];

/** What a member sees after entering a workspace: its info, their own permissions, and colleagues. */
export function WorkspaceHomePage() {
  const { info } = useWorkspace();
  const { me } = useMe();
  const canRead = info.permissions.includes("workspace.read");
  const people = useQuery<Person[]>(canRead ? `/w/${info.workspace.id}/people` : null);

  return (
    <div>
      <PageHeader title={info.workspace.name} sub={info.workspace.description || "Không có mô tả."} />
      <section className="card meta">
        <div>
          <b>Loại workspace:</b> <span className="tag">{info.workspace.type}</span>
        </div>
        <div>
          <b>Vai trò của tôi:</b> {info.role ? ROLE_LABEL[info.role] : me.user.isAdmin ? "Admin hệ thống (không phải thành viên)" : "—"}
        </div>
      </section>

      <section className="card">
        <h3>Quyền của tôi trong workspace này</h3>
        <table className="compact">
          <thead>
            <tr>
              <th>Quyền</th>
              <th>Mã</th>
              <th>Tôi có?</th>
              <th>Workspace bật?</th>
            </tr>
          </thead>
          <tbody>
            {ALL.map((p) => (
              <tr key={p}>
                <td>{PERMISSION_LABEL[p]}</td>
                <td>
                  <code>{p}</code>
                </td>
                <td>{info.permissions.includes(p) ? "✓" : "—"}</td>
                <td>{p === "members.manage" ? "theo vai trò" : info.enabledPermissions.includes(p) ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Quyền thực tế = quyền theo vai trò ∩ quyền manager bật cho workspace.</p>
      </section>

      <section className="card">
        <h3>Thành viên {people.data ? `(${people.data.length})` : ""}</h3>
        {!canRead ? (
          <p className="muted">Workspace này đang tắt quyền xem.</p>
        ) : people.error ? (
          <ErrorBox error={people.error} />
        ) : !people.data ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Email</th>
                <th>Phòng ban</th>
                <th>Vai trò</th>
              </tr>
            </thead>
            <tbody>
              {people.data.map((p) => (
                <tr key={p.email}>
                  <td>{p.name || "—"}</td>
                  <td>{p.email}</td>
                  <td>{p.department ?? "—"}</td>
                  <td>{ROLE_LABEL[p.role]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
