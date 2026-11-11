import { useState } from "react";
import { useMe, useWorkspace } from "../../app/contexts";
import {
  Badge,
  ErrorBox,
  Loading,
  PageHeader,
  fmtDate,
  useAction,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import {
  ROLE_LABEL,
  type DownloadRequest,
  type Person,
} from "../../shared/lib/types";

export function WorkspaceHomePage() {
  const { info } = useWorkspace();
  const { me } = useMe();
  const api = useApi();
  const act = useAction();
  const wid = info.workspace.id;
  const mine = useQuery<DownloadRequest[]>(`/w/${wid}/download-requests/mine`);
  const queue = useQuery<DownloadRequest[]>(
    info.canManage ? `/w/${wid}/download-requests` : null,
  );
  const people = useQuery<Person[]>(`/w/${wid}/people`);
  const [paperRef, setPaperRef] = useState("");
  const [note, setNote] = useState("");
  const refresh = () => {
    mine.reload();
    queue.reload();
  };
  const decide = (id: string, status: "approve" | "reject") => {
    const decisionNote =
      prompt(
        status === "approve" ? "Ghi chú cho thành viên" : "Lý do từ chối",
      ) ?? "";
    void act
      .run(() =>
        api("POST", `/w/${wid}/download-requests/${id}/${status}`, {
          note: decisionNote,
        }),
      )
      .then(refresh);
  };
  return (
    <div>
      <PageHeader
        title={info.workspace.name}
        sub={info.workspace.description || "Không có mô tả."}
      />
      <section className="card meta">
        <div>
          <b>Loại workspace:</b>{" "}
          <span className="tag">{info.workspace.type}</span>
        </div>
        <div>
          <b>Vai trò của tôi:</b>{" "}
          {info.role
            ? ROLE_LABEL[info.role]
            : me.user.isAdmin
              ? "Quản trị viên"
              : "—"}
        </div>
      </section>
      <section id="downloads" className="card">
        <h3>Gửi yêu cầu download paper</h3>
        <p className="muted">
          Gửi DOI, URL hoặc tiêu đề để manager xem xét. Chức năng này không tạo
          file hay link tải.
        </p>
        <ErrorBox error={act.error} />
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act
              .run(() =>
                api("POST", `/w/${wid}/download-requests`, { paperRef, note }),
              )
              .then((r) => {
                if (r !== undefined) {
                  setPaperRef("");
                  setNote("");
                  refresh();
                }
              });
          }}
        >
          <input
            required
            maxLength={500}
            placeholder="DOI / URL / tiêu đề paper"
            value={paperRef}
            onChange={(e) => setPaperRef(e.target.value)}
          />
          <textarea
            maxLength={1000}
            placeholder="Ghi chú (tuỳ chọn)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="primary" disabled={act.busy}>
            Gửi yêu cầu
          </button>
        </form>
      </section>
      <section className="card">
        <h3>Yêu cầu download của tôi</h3>
        {mine.error ? (
          <ErrorBox error={mine.error} />
        ) : !mine.data ? (
          <Loading />
        ) : mine.data.length === 0 ? (
          <p className="muted">Chưa có yêu cầu.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Paper</th>
                <th>Trạng thái</th>
                <th>Gửi lúc</th>
                <th>Ghi chú manager</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mine.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.paperRef}
                    <div className="small muted">{r.note}</div>
                  </td>
                  <td>
                    <Badge value={r.status} />
                  </td>
                  <td>{fmtDate(r.requestedAt)}</td>
                  <td>{r.decisionNote || "—"}</td>
                  <td>
                    {r.status === "pending" && (
                      <button
                        className="link"
                        onClick={() =>
                          void act
                            .run(() =>
                              api(
                                "DELETE",
                                `/w/${wid}/download-requests/${r.id}`,
                              ),
                            )
                            .then(refresh)
                        }
                      >
                        Rút
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {info.canManage && (
        <section className="card">
          <h3>Hàng đợi yêu cầu download</h3>
          {queue.error ? (
            <ErrorBox error={queue.error} />
          ) : !queue.data ? (
            <Loading />
          ) : queue.data.length === 0 ? (
            <p className="muted">Không có yêu cầu chờ duyệt.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Người yêu cầu</th>
                  <th>Paper</th>
                  <th>Ghi chú</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.requesterName}
                      <div className="small muted">{r.requester}</div>
                    </td>
                    <td>{r.paperRef}</td>
                    <td>{r.note || "—"}</td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td>
                      {r.status === "pending" && (
                        <div className="row">
                          <button
                            className="primary"
                            onClick={() => decide(r.id, "approve")}
                          >
                            Duyệt
                          </button>
                          <button onClick={() => decide(r.id, "reject")}>
                            Từ chối
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <section className="card">
        <h3>Thành viên {people.data ? `(${people.data.length})` : ""}</h3>
        {people.error ? (
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
                  <td>{p.department || "—"}</td>
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
