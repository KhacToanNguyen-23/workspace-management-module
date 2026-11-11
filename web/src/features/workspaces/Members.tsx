import { useMe, useWorkspace } from "../../app/contexts";
import {
  Badge,
  ErrorBox,
  Loading,
  PageHeader,
  fmtDate,
  useAction,
} from "../../shared/components/ui";
import { AuditTable } from "../../shared/components/AuditTable";
import { useApi, useQuery } from "../../shared/lib/api";
import {
  type AuditRow,
  type MemberRow,
  ROLE_LABEL,
} from "../../shared/lib/types";
import { useState } from "react";

export function MembersPage() {
  const { info } = useWorkspace();
  const { me, reload: reloadMe } = useMe();
  const wid = info.workspace.id;
  const api = useApi();
  const act = useAction();
  const members = useQuery<MemberRow[]>(`/w/${wid}/members`);
  const audit = useQuery<AuditRow[]>(`/w/${wid}/audit?limit=50`);
  const [email, setEmail] = useState("");
  if (!info.canManage)
    return <ErrorBox error="Bạn không có quyền quản lý workspace này." />;
  const refresh = () => {
    members.reload();
    audit.reload();
    reloadMe();
  };
  const decide = (
    id: string,
    what: "approve" | "reject" | "revoke",
    body: object = {},
  ) =>
    void act
      .run(() => api("POST", `/w/${wid}/members/${id}/${what}`, body))
      .then(refresh);
  const rows = members.data ?? [];
  const pending = rows.filter((m) => m.status === "pending"),
    approved = rows.filter((m) => m.status === "approved"),
    past = rows.filter((m) => ["rejected", "revoked"].includes(m.status));
  return (
    <div>
      <PageHeader
        title={`Quản lý workspace · ${info.workspace.name}`}
        sub="Duyệt yêu cầu tham gia và quản lý thành viên."
      />
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
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.name || m.email}
                    <div className="small muted">
                      {m.email} {m.department && `· ${m.department}`}
                    </div>
                  </td>
                  <td>{m.note || "—"}</td>
                  <td>{fmtDate(m.requestedAt)}</td>
                  <td className="row">
                    <button
                      className="primary"
                      disabled={act.busy}
                      onClick={() => decide(m.id, "approve")}
                    >
                      Duyệt
                    </button>
                    <button
                      disabled={act.busy}
                      onClick={() =>
                        decide(m.id, "reject", {
                          note: prompt("Lý do từ chối") ?? "",
                        })
                      }
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
            void act
              .run(() => api("POST", `/w/${wid}/members`, { email }))
              .then((r) => {
                if (r !== undefined) setEmail("");
                refresh();
              });
          }}
        >
          <input
            className="grow"
            placeholder="Thêm trực tiếp: ten@hyperdatalab.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button disabled={act.busy || !email}>Thêm</button>
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
              const locked =
                (m.email === me.user.email && !me.user.isAdmin) ||
                (m.role === "manager" && !me.user.isAdmin);
              return (
                <tr key={m.id}>
                  <td>
                    {m.name || m.email}
                    <div className="small muted">{m.email}</div>
                  </td>
                  <td>
                    <Badge value={m.directoryStatus} />
                  </td>
                  <td>{ROLE_LABEL[m.role]}</td>
                  <td>
                    {m.decidedBy || "—"}
                    <div className="small muted">{fmtDate(m.decidedAt)}</div>
                  </td>
                  <td>
                    {!locked && (
                      <button
                        className="link danger"
                        disabled={act.busy}
                        onClick={() =>
                          confirm(`Thu hồi quyền của ${m.email}?`) &&
                          decide(m.id, "revoke")
                        }
                      >
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
            <summary>Đã từ chối / thu hồi ({past.length})</summary>
            {past.map((m) => (
              <p key={m.id}>
                {m.email} · <Badge value={m.status} /> · {m.decisionNote || "—"}
              </p>
            ))}
          </details>
        )}
      </section>
      <section className="card">
        <h3>Nhật ký</h3>
        <AuditTable rows={audit.data} />
      </section>
    </div>
  );
}
