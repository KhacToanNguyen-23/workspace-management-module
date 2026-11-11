import { useEffect, useState } from "react";
import { useMe, useWorkspace } from "../App";
import { Badge, ErrorBox, Loading, PageHeader, fmtDate, useAction } from "../components/ui";
import { useApi, useQuery } from "../lib/api";
import { type AuditRow, type MemberRow, PERMISSION_LABEL, type Permission, ROLE_LABEL, type WorkspaceRole } from "../lib/types";

/** Manager view: approve join requests, manage members, switch workspace permissions. */
export function MembersPage() {
  const { info, reload: reloadWs } = useWorkspace();
  const { me, reload: reloadMe } = useMe();
  const wid = info.workspace.id;
  const api = useApi();
  const members = useQuery<MemberRow[]>(`/w/${wid}/members`);
  const audit = useQuery<AuditRow[]>(`/w/${wid}/audit?limit=50`);
  const act = useAction();
  const [roles, setRoles] = useState<Record<string, WorkspaceRole>>({});
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<WorkspaceRole>("member");
  const [perms, setPerms] = useState<Set<Permission>>(new Set(info.enabledPermissions));
  useEffect(() => setPerms(new Set(info.enabledPermissions)), [info.enabledPermissions]);

  if (!info.permissions.includes("members.manage")) {
    return <ErrorBox error="Bạn không có quyền quản lý thành viên trong workspace này." />;
  }
  const isAdmin = me.user.isAdmin;
  const roleOptions: WorkspaceRole[] = isAdmin ? ["viewer", "member", "manager"] : ["viewer", "member"];

  const refresh = () => {
    members.reload();
    audit.reload();
    reloadWs();
    reloadMe();
  };
  const decide = (id: string, action: "approve" | "reject" | "revoke", extra: object = {}) =>
    act.run(() => api("POST", `/w/${wid}/members/${id}/${action}`, extra)).then(refresh);

  const pending = members.data?.filter((m) => m.status === "pending") ?? [];
  const approved = members.data?.filter((m) => m.status === "approved") ?? [];
  const past = members.data?.filter((m) => m.status === "rejected" || m.status === "revoked") ?? [];

  return (
    <div>
      <PageHeader title={`Thành viên & quyền · ${info.workspace.name}`} sub={`Loại workspace: ${info.workspace.type}`} />
      <ErrorBox error={act.error ?? members.error} />

      <section className="card">
        <h3>Yêu cầu chờ duyệt ({pending.length})</h3>
        {!members.data ? (
          <Loading />
        ) : pending.length === 0 ? (
          <p className="muted">Không có yêu cầu nào.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Người xin</th>
                <th>Lời nhắn</th>
                <th>Gửi lúc</th>
                <th>Vai trò khi duyệt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.name || m.email}
                    <div className="small muted">
                      {m.email} {m.department ? `· ${m.department}` : ""}
                    </div>
                  </td>
                  <td>{m.note || "—"}</td>
                  <td className="small">{fmtDate(m.requestedAt)}</td>
                  <td>
                    <select value={roles[m.id] ?? "member"} onChange={(e) => setRoles({ ...roles, [m.id]: e.target.value as WorkspaceRole })}>
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="row">
                    <button className="primary" disabled={act.busy} onClick={() => void decide(m.id, "approve", { role: roles[m.id] ?? "member" })}>
                      Duyệt
                    </button>
                    <button
                      disabled={act.busy}
                      onClick={() => {
                        const note = prompt("Lý do từ chối (tuỳ chọn)") ?? "";
                        void decide(m.id, "reject", { note });
                      }}
                    >
                      Từ chối
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3>Thành viên ({approved.length})</h3>
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => api("POST", `/w/${wid}/members`, { email: addEmail, role: addRole })).then((r) => {
              if (r !== undefined) setAddEmail("");
              refresh();
            });
          }}
        >
          <input className="grow" placeholder="Thêm trực tiếp: ten@hyperdatalab.org" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} />
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as WorkspaceRole)}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button disabled={act.busy || !addEmail}>Thêm</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Thành viên</th>
              <th>Danh bạ</th>
              <th>Vai trò</th>
              <th>Duyệt bởi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {approved.map((m) => {
              const self = m.email === me.user.email;
              const locked = (self && !isAdmin) || (m.role === "manager" && !isAdmin);
              return (
                <tr key={m.id}>
                  <td>
                    {m.name || m.email}
                    <div className="small muted">{m.email}</div>
                  </td>
                  <td>
                    <Badge value={m.directoryStatus} />
                  </td>
                  <td>
                    <select
                      value={m.role}
                      disabled={locked || act.busy}
                      onChange={(e) => void act.run(() => api("PATCH", `/w/${wid}/members/${m.id}`, { role: e.target.value })).then(refresh)}
                    >
                      {(locked ? [m.role] : roleOptions).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="small">
                    {m.decidedBy ?? "—"}
                    <div className="muted">{fmtDate(m.decidedAt)}</div>
                  </td>
                  <td>
                    {!locked && (
                      <button className="link danger" disabled={act.busy} onClick={() => confirm(`Thu hồi quyền của ${m.email}?`) && void decide(m.id, "revoke")}>
                        Thu hồi
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {past.length > 0 && (
          <details>
            <summary className="muted">Đã từ chối / thu hồi ({past.length})</summary>
            <ul>
              {past.map((m) => (
                <li key={m.id} className="small">
                  {m.email} · <Badge value={m.status} /> · {m.decidedBy} · {m.decisionNote || "—"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <h3>Quyền của workspace</h3>
        <p className="muted small">
          Quyền thực tế của mỗi người = quyền theo vai trò ∩ quyền bật ở đây. Người xem chỉ có quyền xem; thành viên có xem, sửa, duyệt; quản lý luôn giữ quyền quản lý thành viên.
        </p>
        <div className="perm-grid">
          {info.toggleablePermissions.map((p) => (
            <label key={p} className="inline">
              <input
                type="checkbox"
                checked={perms.has(p)}
                onChange={() => {
                  const n = new Set(perms);
                  n.has(p) ? n.delete(p) : n.add(p);
                  setPerms(n);
                }}
              />{" "}
              {PERMISSION_LABEL[p]} <code>{p}</code>
            </label>
          ))}
        </div>
        <button className="primary" disabled={act.busy} onClick={() => void act.run(() => api("PUT", `/w/${wid}/permissions`, { permissions: [...perms] })).then(refresh)}>
          Lưu quyền
        </button>
      </section>

      <section className="card">
        <h3>Nhật ký</h3>
        <AuditTable rows={audit.data} />
      </section>
    </div>
  );
}

export function AuditTable({ rows }: { rows: AuditRow[] | null }) {
  if (!rows) return <Loading />;
  return (
    <table className="compact">
      <thead>
        <tr>
          <th>Lúc</th>
          <th>Ai</th>
          <th>Hành động</th>
          <th>Đối tượng</th>
          <th>Chi tiết</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="small">{fmtDate(r.at)}</td>
            <td className="small">{r.actor}</td>
            <td>
              <code>{r.action}</code>
            </td>
            <td className="small">{r.target}</td>
            <td className="small muted">{JSON.stringify(r.detail)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
