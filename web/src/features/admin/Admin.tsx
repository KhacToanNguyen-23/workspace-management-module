import { useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../../app/contexts";
import { Badge, ErrorBox, Loading, PageHeader, fmtDate, useAction } from "../../shared/components/ui";
import { AuditTable } from "../../shared/components/AuditTable";
import { useApi, useQuery } from "../../shared/lib/api";
import type { AuditRow } from "../../shared/lib/types";

interface AdminUser {
  email: string;
  name: string;
  department: string | null;
  directoryStatus: string;
  globalRole: "user" | "admin";
  disabled: boolean;
  lastSeen: string | null;
  syncedAt: string | null;
  workspaces: { name: string; role: string; status: string }[];
}

interface AdminWorkspace {
  id: string;
  slug: string;
  name: string;
  type: string;
  description: string;
  status: "active" | "archived";
  memberCount: number;
  pendingCount: number;
  managers: string[];
  permissions: string[];
}

interface WsType {
  code: string;
  name: string;
  description: string;
  defaultPermissions: string[];
}

/** Global admin (admin@hyperdatalab.org): directory users, workspaces, managers, audit. */
export function AdminPage() {
  const { me } = useMe();
  const [tab, setTab] = useState<"users" | "workspaces" | "audit">("workspaces");
  if (!me.user.isAdmin) return <ErrorBox error="Chỉ admin mới vào được trang này." />;
  return (
    <div>
      <PageHeader title="Quản trị" sub="Member @hyperdatalab.org, workspace, quyền và nhật ký." />
      <div className="tabs">
        {(["workspaces", "users", "audit"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "workspaces" ? "Workspace" : t === "users" ? "Người dùng" : "Nhật ký"}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "workspaces" && <WorkspacesTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function UsersTab() {
  const api = useApi();
  const { me } = useMe();
  const [q, setQ] = useState("");
  const users = useQuery<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const act = useAction();
  const [syncMsg, setSyncMsg] = useState("");

  const patch = (email: string, body: object) =>
    act.run(() => api("PATCH", `/admin/users/${encodeURIComponent(email)}`, body)).then(users.reload);

  return (
    <section className="card">
      <div className="row wrap">
        <input className="grow" placeholder="Tìm email / tên" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              const r = await api<{ listed: number; missing: number; mode: string }>("POST", "/admin/users/sync");
              setSyncMsg(`Đồng bộ danh bạ (${r.mode}): ${r.listed} người, ${r.missing} không còn trong danh bạ.`);
              users.reload();
            })
          }
        >
          Đồng bộ danh bạ Google
        </button>
      </div>
      {syncMsg && <div className="ok">{syncMsg}</div>}
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
              <th>Lần cuối</th>
              <th>Quyền hệ thống</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data.map((u) => {
              const protectedUser = u.email === "admin@hyperdatalab.org" || u.email === me.user.email;
              return (
                <tr key={u.email} className={u.disabled ? "dim" : ""}>
                  <td>
                    {u.name || "—"}
                    <div className="small muted">
                      {u.email} {u.department ? `· ${u.department}` : ""}
                    </div>
                  </td>
                  <td>
                    <Badge value={u.directoryStatus} />
                  </td>
                  <td className="small">
                    {u.workspaces.map((w) => `${w.name} (${w.role}, ${w.status})`).join("; ") || "—"}
                  </td>
                  <td className="small">{fmtDate(u.lastSeen)}</td>
                  <td>
                    <select value={u.globalRole} disabled={protectedUser || act.busy} onChange={(e) => void patch(u.email, { globalRole: e.target.value })}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    {!protectedUser && (
                      <button className="link" disabled={act.busy} onClick={() => void patch(u.email, { disabled: !u.disabled })}>
                        {u.disabled ? "Mở khoá" : "Khoá"}
                      </button>
                    )}
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
  const api = useApi();
  const list = useQuery<AdminWorkspace[]>("/admin/workspaces");
  const types = useQuery<WsType[]>("/workspace-types");
  const act = useAction();
  const [form, setForm] = useState({ name: "", slug: "", type: "research", description: "", managers: "" });
  const [newType, setNewType] = useState({ code: "", name: "", description: "" });

  return (
    <>
      <section className="card">
        <h3>Tạo workspace</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act
              .run(() =>
                api("POST", "/admin/workspaces", {
                  ...form,
                  managers: form.managers.split(/[\s,;]+/).filter(Boolean),
                }),
              )
              .then((r) => {
                if (r !== undefined) setForm({ name: "", slug: "", type: form.type, description: "", managers: "" });
                list.reload();
              });
          }}
        >
          <div className="row wrap">
            <input
              placeholder="Tên"
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                  slug: form.slug || e.target.value.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
                })
              }
              required
            />
            <input placeholder="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {(types.data ?? []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name} — {t.defaultPermissions.join(", ")}
                </option>
              ))}
            </select>
          </div>
          <input placeholder="Mô tả" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input
            placeholder="Email manager (cách nhau bởi dấu phẩy), vd: mai@hyperdatalab.org"
            value={form.managers}
            onChange={(e) => setForm({ ...form, managers: e.target.value })}
          />
          <button className="primary" disabled={act.busy}>
            Tạo workspace
          </button>
        </form>
      </section>
      <ErrorBox error={act.error ?? list.error} />
      <section className="card">
        <h3>Danh sách workspace</h3>
        {!list.data ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Loại</th>
                <th>Quản lý</th>
                <th className="num">Thành viên</th>
                <th className="num">Chờ duyệt</th>
                <th>Quyền bật</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((w) => (
                <tr key={w.id} className={w.status === "archived" ? "dim" : ""}>
                  <td>
                    <Link to={`/w/${w.id}/members`}>{w.name}</Link>
                    <div className="small muted">{w.slug}</div>
                  </td>
                  <td>
                    <select
                      value={w.type}
                      disabled={act.busy}
                      onChange={(e) => void act.run(() => api("PATCH", `/admin/workspaces/${w.id}`, { type: e.target.value })).then(list.reload)}
                    >
                      {(types.data ?? []).map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="small">
                    {w.managers.join(", ") || "—"}
                    <div>
                      <button
                        className="link"
                        onClick={() => {
                          const email = prompt("Email manager mới (@hyperdatalab.org)");
                          if (email) void act.run(() => api("POST", `/admin/workspaces/${w.id}/managers`, { email })).then(list.reload);
                        }}
                      >
                        + Gán manager
                      </button>
                    </div>
                  </td>
                  <td className="num">{w.memberCount}</td>
                  <td className="num">{w.pendingCount}</td>
                  <td className="small">{w.permissions.join(", ") || "—"}</td>
                  <td>
                    <button
                      className="link"
                      disabled={act.busy}
                      onClick={() =>
                        void act
                          .run(() => api("PATCH", `/admin/workspaces/${w.id}`, { status: w.status === "active" ? "archived" : "active" }))
                          .then(list.reload)
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
      <section className="card">
        <h3>Loại workspace</h3>
        <ul>
          {(types.data ?? []).map((t) => (
            <li key={t.code}>
              <b>{t.name}</b> <code>{t.code}</code> — {t.description} <span className="muted small">({t.defaultPermissions.join(", ")})</span>
            </li>
          ))}
        </ul>
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => api("POST", "/admin/workspace-types", newType)).then((r) => {
              if (r !== undefined) setNewType({ code: "", name: "", description: "" });
              types.reload();
            });
          }}
        >
          <input placeholder="code" value={newType.code} onChange={(e) => setNewType({ ...newType, code: e.target.value })} required />
          <input placeholder="Tên" value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} required />
          <input className="grow" placeholder="Mô tả" value={newType.description} onChange={(e) => setNewType({ ...newType, description: e.target.value })} />
          <button disabled={act.busy}>Thêm loại (mặc định chỉ xem)</button>
        </form>
      </section>
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
