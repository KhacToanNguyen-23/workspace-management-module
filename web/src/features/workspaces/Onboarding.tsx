import { useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../../app/contexts";
import {
  Badge,
  ErrorBox,
  Loading,
  PageHeader,
  fmtDate,
  useAction,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import { ROLE_LABEL, type WorkspaceSummary } from "../../shared/lib/types";

/**
 * Pick a workspace and send a join request (a manager of that workspace approves it), or ask an
 * admin to create a new workspace. Workspace managers and admins create workspaces directly.
 */
export function OnboardingPage() {
  const api = useApi();
  const { me, reload: reloadMe } = useMe();
  const list = useQuery<WorkspaceSummary[]>("/workspaces");
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [workspaceForm, setWorkspaceForm] = useState({
    name: "",
    type: "research",
    description: "",
    reason: "",
  });
  const types = useQuery<{ code: string; name: string }[]>("/workspace-types");
  const approved = me.memberships.some((m) => m.status === "approved");
  const canCreateDirectly = me.user.role !== "member";

  const refresh = () => {
    list.reload();
    reloadMe();
  };

  return (
    <div>
      <PageHeader
        title="Tham gia workspace"
        sub={
          approved
            ? "Bạn có thể xin vào thêm workspace khác."
            : "Bạn chưa thuộc workspace nào. Chọn một workspace và gửi yêu cầu; manager của workspace đó sẽ duyệt."
        }
      />
      {me.memberships.length > 0 && (
        <section className="card">
          <h3>Yêu cầu của tôi</h3>
          <table>
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Gửi lúc</th>
                <th>Ghi chú duyệt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {me.memberships.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.status === "approved" ? (
                      <Link to={`/w/${m.workspace.id}`}>
                        {m.workspace.name}
                      </Link>
                    ) : (
                      m.workspace.name
                    )}
                  </td>
                  <td>{ROLE_LABEL[m.role]}</td>
                  <td>
                    <Badge value={m.status} />
                  </td>
                  <td>{fmtDate(m.requestedAt)}</td>
                  <td className="muted">{m.decisionNote || "—"}</td>
                  <td>
                    {m.status === "pending" && (
                      <button
                        className="link"
                        disabled={act.busy}
                        onClick={() =>
                          act
                            .run(() =>
                              api(
                                "DELETE",
                                `/workspaces/${m.workspace.id}/join`,
                              ),
                            )
                            .then(refresh)
                        }
                      >
                        Rút yêu cầu
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <ErrorBox error={act.error ?? list.error} />
      {canCreateDirectly ? (
        <section className="card">
          <h3>Tạo workspace mới</h3>
          <p className="muted">
            Bạn có quyền quản lý workspace nên tạo được ngay, không cần admin
            duyệt.
          </p>
          <Link to="/create-workspace">Tạo workspace</Link>
        </section>
      ) : (
        <section className="card">
          <h3>Xin tạo workspace mới</h3>
          {me.workspaceRequest && (
            <p>
              Yêu cầu gần nhất: <Badge value={me.workspaceRequest.status} />{" "}
              {me.workspaceRequest.name}{" "}
              {me.workspaceRequest.decisionNote &&
                `· ${me.workspaceRequest.decisionNote}`}
              {me.workspaceRequest.status === "pending" && (
                <button
                  className="link"
                  onClick={() =>
                    void act
                      .run(() =>
                        api(
                          "DELETE",
                          `/workspace-requests/${me.workspaceRequest!.id}`,
                        ),
                      )
                      .then(refresh)
                  }
                >
                  Rút yêu cầu
                </button>
              )}
            </p>
          )}
          {me.workspaceRequest?.status !== "pending" && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void act
                  .run(() => api("POST", "/workspace-requests", workspaceForm))
                  .then(refresh);
              }}
            >
              <div className="row wrap">
                <input
                  placeholder="Tên workspace"
                  required
                  value={workspaceForm.name}
                  onChange={(e) =>
                    setWorkspaceForm({ ...workspaceForm, name: e.target.value })
                  }
                />
                <select
                  value={workspaceForm.type}
                  onChange={(e) =>
                    setWorkspaceForm({ ...workspaceForm, type: e.target.value })
                  }
                >
                  {(types.data ?? []).map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <input
                placeholder="Mô tả"
                value={workspaceForm.description}
                onChange={(e) =>
                  setWorkspaceForm({
                    ...workspaceForm,
                    description: e.target.value,
                  })
                }
              />
              <textarea
                placeholder="Lý do xin tạo"
                value={workspaceForm.reason}
                onChange={(e) =>
                  setWorkspaceForm({ ...workspaceForm, reason: e.target.value })
                }
              />
              <button className="primary" disabled={act.busy}>
                Gửi admin duyệt
              </button>
            </form>
          )}
        </section>
      )}
      {!list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <p className="muted">
          {canCreateDirectly
            ? "Chưa có workspace nào. Hãy tạo workspace đầu tiên."
            : "Chưa có workspace nào để tham gia. Bạn có thể xin tạo workspace mới ở trên."}
        </p>
      ) : (
        <div className="grid">
          {list.data.map((w) => {
            const canRequest =
              !w.myStatus ||
              w.myStatus === "rejected" ||
              w.myStatus === "revoked";
            return (
              <article key={w.id} className="card">
                <div className="row between">
                  <h3>{w.name}</h3>
                  <span className="tag">{w.type}</span>
                </div>
                <p className="muted">{w.description || "Không có mô tả."}</p>
                <p className="small muted">
                  {w.memberCount} thành viên · Quản lý:{" "}
                  {w.managers.join(", ") || "chưa có"}
                </p>
                {w.myStatus && (
                  <p>
                    <Badge value={w.myStatus} />
                  </p>
                )}
                {canRequest && (
                  <div className="stack">
                    <input
                      placeholder="Lời nhắn cho manager (tuỳ chọn)"
                      value={notes[w.id] ?? ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [w.id]: e.target.value })
                      }
                    />
                    <button
                      className="primary"
                      disabled={act.busy}
                      onClick={() =>
                        act
                          .run(() =>
                            api("POST", `/workspaces/${w.id}/join`, {
                              note: notes[w.id] ?? "",
                            }),
                          )
                          .then(refresh)
                      }
                    >
                      Gửi yêu cầu tham gia
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
