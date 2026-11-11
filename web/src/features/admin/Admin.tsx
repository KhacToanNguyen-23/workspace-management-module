import { useState } from "react";
import { useMe } from "../../app/contexts";
import { AuditTable } from "../../shared/components/AuditTable";
import {
  Badge,
  ErrorBox,
  Loading,
  PageHeader,
  useAction,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import type {
  AdminUser,
  AuditRow,
  WorkspaceRequest,
} from "../../shared/lib/types";

type Tab = "users" | "requests" | "workspaces" | "audit";
export function AdminPage() {
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>("users");
  if (!me.user.isAdmin)
    return <ErrorBox error="Chỉ admin mới vào được trang này." />;
  return (
    <div>
      <PageHeader
        title="Quản trị"
        sub="Người dùng, yêu cầu tạo workspace, workspace và nhật ký."
      />
      <div className="tabs">
        {(["users", "requests", "workspaces", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {
              {
                users: "Người dùng",
                requests: "Yêu cầu tạo workspace",
                workspaces: "Workspace",
                audit: "Nhật ký",
              }[t]
            }
          </button>
        ))}
      </div>
      {tab === "users" ? (
        <UsersTab />
      ) : tab === "requests" ? (
        <RequestsTab />
      ) : tab === "workspaces" ? (
        <WorkspacesTab />
      ) : (
        <AuditTab />
      )}
    </div>
  );
}
function UsersTab() {
  const api = useApi(),
    act = useAction(),
    { me } = useMe();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [disabled, setDisabled] = useState("");
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (role) params.set("role", role);
  if (disabled) params.set("disabled", disabled);
  const users = useQuery<AdminUser[]>(`/admin/users?${params}`);
  const patch = (email: string, body: object) =>
    void act
      .run(() =>
        api("PATCH", `/admin/users/${encodeURIComponent(email)}`, body),
      )
      .then(users.reload);
  return (
    <section className="card">
      <div className="row wrap">
        <input
          placeholder="Tìm email / tên"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Mọi role</option>
          <option value="member">Thành viên</option>
          <option value="workspace_manager">Quản lý workspace</option>
          <option value="admin">Quản trị viên</option>
        </select>
        <select value={disabled} onChange={(e) => setDisabled(e.target.value)}>
          <option value="">Mọi trạng thái</option>
          <option value="false">Đang hoạt động</option>
          <option value="true">Đã vô hiệu hoá</option>
        </select>
      </div>
      <ErrorBox error={act.error ?? users.error} />
      {!users.data ? (
        <Loading />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Người dùng</th>
              <th>Danh bạ</th>
              <th>Workspace</th>
              <th>Role</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {users.data.map((u) => (
              <tr key={u.email}>
                <td>
                  {u.name || "—"}
                  <div className="small muted">{u.email}</div>
                </td>
                <td>
                  <Badge value={u.directoryStatus} />
                </td>
                <td>
                  {u.workspaces?.map((w) => `${w.name} (${w.role})`).join(", ")}
                </td>
                <td>
                  <select
                    value={u.role}
                    disabled={
                      u.email === "admin@hyperdatalab.org" ||
                      u.email === me.user.email
                    }
                    onChange={(e) => patch(u.email, { role: e.target.value })}
                  >
                    <option value="member">member</option>
                    <option value="workspace_manager">workspace_manager</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  <button
                    disabled={
                      u.email === "admin@hyperdatalab.org" ||
                      u.email === me.user.email
                    }
                    onClick={() => {
                      if (
                        confirm(
                          `${u.disabled ? "Mở khoá" : "Vô hiệu hoá"} ${u.email}?`,
                        )
                      )
                        patch(u.email, { disabled: !u.disabled });
                    }}
                  >
                    {u.disabled ? "Enable" : "Disable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
function RequestsTab() {
  const api = useApi(),
    act = useAction();
  const q = useQuery<WorkspaceRequest[]>(
    "/admin/workspace-requests?status=pending",
  );
  const [edits, setEdits] = useState<
    Record<string, { name: string; slug: string }>
  >({});
  const refresh = () => q.reload();
  return (
    <section className="card">
      <ErrorBox error={act.error ?? q.error} />
      {!q.data ? (
        <Loading />
      ) : q.data.length === 0 ? (
        <p className="muted">Không có yêu cầu đang chờ.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Người yêu cầu</th>
              <th>Chi tiết</th>
              <th>Lý do</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.map((r) => {
              const e = edits[r.id] ?? { name: r.name, slug: r.slug };
              return (
                <tr key={r.id}>
                  <td>
                    {r.requesterName || r.requester}
                    <div className="small muted">
                      {r.requester} · {r.department}
                    </div>
                  </td>
                  <td>
                    <input
                      value={e.name}
                      onChange={(x) =>
                        setEdits({
                          ...edits,
                          [r.id]: { ...e, name: x.target.value },
                        })
                      }
                    />
                    <input
                      value={e.slug}
                      onChange={(x) =>
                        setEdits({
                          ...edits,
                          [r.id]: { ...e, slug: x.target.value },
                        })
                      }
                    />
                    <div>
                      {r.type} · {r.description}
                    </div>
                  </td>
                  <td>{r.reason || "—"}</td>
                  <td>
                    <div className="row">
                      <button
                        className="primary"
                        disabled={act.busy}
                        onClick={() =>
                          void act
                            .run(() =>
                              api(
                                "POST",
                                `/admin/workspace-requests/${r.id}/approve`,
                                { ...e, note: prompt("Ghi chú") ?? "" },
                              ),
                            )
                            .then(refresh)
                        }
                      >
                        Duyệt
                      </button>
                      <button
                        disabled={act.busy}
                        onClick={() =>
                          void act
                            .run(() =>
                              api(
                                "POST",
                                `/admin/workspace-requests/${r.id}/reject`,
                                { note: prompt("Lý do từ chối") ?? "" },
                              ),
                            )
                            .then(refresh)
                        }
                      >
                        Từ chối
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
function WorkspacesTab() {
  const api = useApi(),
    act = useAction();
  const list = useQuery<any[]>("/admin/workspaces");
  const users = useQuery<AdminUser[]>("/admin/users?disabled=false");
  const types = useQuery<{ code: string; name: string }[]>("/workspace-types");
  const [managerSelections, setManagerSelections] = useState<
    Record<string, string>
  >({});
  const [promotionMessage, setPromotionMessage] = useState("");
  const [form, setForm] = useState({
    name: "",
    slug: "",
    type: "research",
    description: "",
    managers: "",
  });
  const refresh = () => list.reload();
  return (
    <>
      <section className="card">
        <h3>Tạo workspace</h3>
        <ErrorBox error={act.error} />
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void act
              .run(() =>
                api("POST", "/admin/workspaces", {
                  ...form,
                  managers: form.managers.split(/[\s,;]+/).filter(Boolean),
                }),
              )
              .then(refresh);
          }}
        >
          <input
            required
            placeholder="Tên"
            value={form.name}
            onChange={(e) =>
              setForm({
                ...form,
                name: e.target.value,
                slug:
                  form.slug ||
                  e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              })
            }
          />
          <input
            required
            placeholder="slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {(types.data ?? []).map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Mô tả"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <input
            placeholder="Managers"
            value={form.managers}
            onChange={(e) => setForm({ ...form, managers: e.target.value })}
          />
          <button className="primary">Tạo</button>
        </form>
      </section>
      <section className="card">
        <h3>Workspace</h3>
        {!list.data ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Managers</th>
                <th>Thành viên</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((w) => (
                <tr key={w.id}>
                  <td>
                    {w.name}
                    <div className="small muted">{w.slug}</div>
                  </td>
                  <td>
                    {(w.managers ?? []).join(", ")}
                    <select
                      aria-label={`Chọn manager cho ${w.name}`}
                      value={managerSelections[w.id] ?? ""}
                      onChange={(event) =>
                        setManagerSelections({
                          ...managerSelections,
                          [w.id]: event.target.value,
                        })
                      }
                    >
                      <option value="">Chọn người dùng</option>
                      {(users.data ?? [])
                        .filter((user) => !w.managers?.includes(user.email))
                        .map((user) => (
                          <option key={user.email} value={user.email}>
                            {user.name || user.email} ({user.role})
                          </option>
                        ))}
                    </select>
                    <button
                      className="link"
                      disabled={!managerSelections[w.id] || act.busy}
                      onClick={() => {
                        const email = managerSelections[w.id];
                        const selected = users.data?.find(
                          (user) => user.email === email,
                        );
                        if (!email) return;
                        if (
                          selected?.role === "member" &&
                          !confirm(
                            "Người này sẽ được nâng lên Quản lý workspace",
                          )
                        ) {
                          return;
                        }
                        void act
                          .run(() =>
                            api<{ promoted: boolean }>(
                              "POST",
                              `/admin/workspaces/${w.id}/managers`,
                              { email },
                            ),
                          )
                          .then((result) => {
                            if (result) {
                              setPromotionMessage(
                                result.promoted
                                  ? `${email} đã được nâng lên Quản lý workspace.`
                                  : `${email} đã được thêm làm manager.`,
                              );
                              setManagerSelections({
                                ...managerSelections,
                                [w.id]: "",
                              });
                              refresh();
                            }
                          });
                      }}
                    >
                      + Manager
                    </button>
                  </td>
                  <td>
                    {w.memberCount} · {w.pendingCount} chờ
                  </td>
                  <td>
                    <Badge value={w.status} />
                  </td>
                  <td>
                    <button
                      onClick={() =>
                        void act
                          .run(() =>
                            api("PATCH", `/admin/workspaces/${w.id}`, {
                              status:
                                w.status === "active" ? "archived" : "active",
                            }),
                          )
                          .then(refresh)
                      }
                    >
                      {w.status === "active" ? "Lưu trữ" : "Mở lại"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {promotionMessage && <p className="small ok">{promotionMessage}</p>}
      <ErrorBox error={act.error ?? users.error} />
    </>
  );
}
function AuditTab() {
  const q = useQuery<AuditRow[]>("/admin/audit?limit=300");
  return (
    <section className="card">
      <ErrorBox error={q.error} />
      <AuditTable rows={q.data} />
    </section>
  );
}
