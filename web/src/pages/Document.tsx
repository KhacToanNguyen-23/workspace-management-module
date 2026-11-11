import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWorkspace } from "../App";
import { Badge, ErrorBox, Loading, PageHeader, fmtDate } from "../components/ui";
import { useQuery } from "../lib/api";
import { useAuth } from "../lib/auth";

interface DocDetail {
  document: {
    id: string;
    corpus_id: string;
    title: string;
    authors: string[];
    year: number | null;
    venue: string | null;
    doi: string | null;
    abstract: string | null;
    license: string | null;
    is_oa: boolean;
    oa_url: string | null;
    status: string;
    error: string | null;
    source: string;
    content_type: string | null;
    content_bytes: number | null;
    fetched_at: string;
    downloaded_at: string | null;
    extracted_at: string | null;
  };
  sentences: { idx: number; section: string; text: string }[];
}

/** Metadata plus the extraction result (sentences grouped by section). */
export function DocumentPage() {
  const { info } = useWorkspace();
  const { did } = useParams();
  const wid = info.workspace.id;
  const { getToken } = useAuth();
  const q = useQuery<DocDetail>(`/w/${wid}/documents/${did}`);
  const [section, setSection] = useState("");
  const [fileErr, setFileErr] = useState<unknown>(null);

  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const d = q.data.document;
  const sections = [...new Set(q.data.sentences.map((s) => s.section))];
  const shown = q.data.sentences.filter((s) => !section || s.section === section);

  async function openFile() {
    // The file route needs the auth header, so fetch it and open a blob URL.
    setFileErr(null);
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/w/${wid}/documents/${did}/file`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Không mở được file (HTTP ${res.status}).`);
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (e) {
      setFileErr(e);
    }
  }

  return (
    <div>
      <PageHeader title={d.title || "(không có tiêu đề)"} sub={<Link to={`/w/${wid}/corpora/${d.corpus_id}`}>← Về corpus</Link>} />
      <section className="card meta">
        <div>
          <b>Tác giả:</b> {d.authors.join(", ") || "—"}
        </div>
        <div>
          <b>Năm / nơi đăng:</b> {d.year ?? "—"} · {d.venue ?? "—"}
        </div>
        <div>
          <b>DOI:</b> {d.doi ? <a href={`https://doi.org/${d.doi}`} target="_blank" rel="noreferrer">{d.doi}</a> : "—"} · <b>Nguồn:</b> {d.source}
        </div>
        <div>
          <b>License:</b> {d.license ?? "—"} · <b>OA:</b> {d.is_oa ? "có" : "không"}{" "}
          {d.oa_url && (
            <a href={d.oa_url} target="_blank" rel="noreferrer">
              link gốc
            </a>
          )}
        </div>
        <div>
          <b>Trạng thái:</b> <Badge value={d.status} /> {d.error && <span className="warn small">{d.error}</span>}
        </div>
        <div className="small muted">
          Fetch {fmtDate(d.fetched_at)} · Tải {fmtDate(d.downloaded_at)} · Trích {fmtDate(d.extracted_at)}
        </div>
        {d.content_type && (
          <div>
            <button onClick={() => void openFile()}>
              Mở file đã tải ({d.content_type}, {Math.round((d.content_bytes ?? 0) / 1024)} KB)
            </button>
            <ErrorBox error={fileErr} />
          </div>
        )}
      </section>
      {d.abstract && (
        <section className="card">
          <h3>Abstract</h3>
          <p>{d.abstract}</p>
        </section>
      )}
      <section className="card">
        <div className="row between">
          <h3>Kết quả extraction · {q.data.sentences.length} câu</h3>
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">Mọi phần</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {shown.length === 0 ? (
          <p className="muted">Chưa có câu nào. Chạy extraction ở trang corpus.</p>
        ) : (
          <ol className="sentences">
            {shown.map((s) => (
              <li key={s.idx}>
                <span className="tag">{s.section}</span> {s.text}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
