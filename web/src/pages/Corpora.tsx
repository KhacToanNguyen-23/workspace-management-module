import { useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../App";
import { ErrorBox, Loading, PageHeader, fmtDate, useAction } from "../components/ui";
import { useApi, useQuery } from "../lib/api";
import type { Corpus } from "../lib/types";

/** List of corpora in the workspace with pipeline counts. */
export function CorporaPage() {
  const { info } = useWorkspace();
  const wid = info.workspace.id;
  const api = useApi();
  const q = useQuery<Corpus[]>(`/w/${wid}/corpora`);
  const act = useAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const canWrite = info.permissions.includes("corpus.write");

  return (
    <div>
      <PageHeader title={`Corpus · ${info.workspace.name}`} sub="Danh sách corpus của workspace và tiến độ fetch → tải → trích." />
      {canWrite && (
        <form
          className="card row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => api("POST", `/w/${wid}/corpora`, { name, description })).then((r) => {
              if (r !== undefined) {
                setName("");
                setDescription("");
                q.reload();
              }
            });
          }}
        >
          <input placeholder="Tên corpus mới" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="grow" placeholder="Mô tả" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button className="primary" disabled={act.busy || !name.trim()}>
            Tạo corpus
          </button>
        </form>
      )}
      <ErrorBox error={act.error ?? q.error} />
      {!q.data ? (
        <Loading />
      ) : q.data.length === 0 ? (
        <p className="muted">Chưa có corpus nào.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Corpus</th>
              <th className="num">Tổng</th>
              <th className="num">Đã fetch</th>
              <th className="num">Đã tải</th>
              <th className="num">Đã trích</th>
              <th className="num">Lỗi</th>
              <th className="num">Câu</th>
              <th>Tạo bởi</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/w/${wid}/corpora/${c.id}`}>{c.name}</Link>
                  <div className="small muted">{c.description}</div>
                </td>
                <td className="num">{c.total}</td>
                <td className="num">{c.fetched ?? 0}</td>
                <td className="num">{c.downloaded ?? 0}</td>
                <td className="num">{c.extracted ?? 0}</td>
                <td className="num">{c.failed ?? 0}</td>
                <td className="num">{c.sentences}</td>
                <td className="small">
                  {c.createdBy}
                  <div className="muted">{fmtDate(c.createdAt)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
