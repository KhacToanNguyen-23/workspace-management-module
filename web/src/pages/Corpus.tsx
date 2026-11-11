import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWorkspace } from "../App";
import { Badge, ErrorBox, Loading, PageHeader, useAction } from "../components/ui";
import { useApi, useQuery } from "../lib/api";
import type { DocumentRow, FetchedRecord } from "../lib/types";

interface DocPage {
  corpus: { id: string; name: string };
  page: number;
  pageSize: number;
  total: number;
  items: DocumentRow[];
}

const STATUSES = ["", "fetched", "downloaded", "download_failed", "extracted", "extract_failed"];

export function CorpusPage() {
  const { info } = useWorkspace();
  const { cid } = useParams();
  const wid = info.workspace.id;
  const api = useApi();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const act = useAction();
  const can = (p: string) => info.permissions.includes(p as never);

  const path = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (status) p.set("status", status);
    if (search) p.set("q", search);
    return `/w/${wid}/corpora/${cid}/documents?${p}`;
  }, [wid, cid, page, status, search]);
  const q = useQuery<DocPage>(path);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  /** Downloader/extraction take at most 10 ids per call, so send in chunks. */
  async function runBatch(kind: "download" | "extract") {
    const ids = [...selected];
    const lines: string[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const res = await api<{ results: { id: string; status: string; error?: string; sentences?: number }[] }>(
        "POST",
        `/w/${wid}/corpora/${cid}/${kind}`,
        { documentIds: ids.slice(i, i + 10) },
      );
      const title = (id: string) => q.data?.items.find((d) => d.id === id)?.title.slice(0, 60) ?? id;
      for (const r of res.results) {
        lines.push(`${title(r.id)} → ${r.status}${r.sentences !== undefined ? ` (${r.sentences} câu)` : ""}${r.error ? `: ${r.error}` : ""}`);
      }
    }
    setLog(lines);
    setSelected(new Set());
    q.reload();
  }

  const items = q.data?.items ?? [];
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title={q.data?.corpus.name ?? "Corpus"}
        sub={<Link to={`/w/${wid}/corpora`}>← Danh sách corpus</Link>}
        actions={
          can("corpus.write") && (
            <button
              className="danger"
              onClick={() =>
                confirm("Xoá corpus này cùng toàn bộ tài liệu, file và câu đã trích?") &&
                void act.run(() => api("DELETE", `/w/${wid}/corpora/${cid}`)).then(() => navigate(`/w/${wid}/corpora`))
              }
            >
              Xoá corpus
            </button>
          )
        }
      />

      {can("corpus.fetch") && <FetchPanel wid={wid} cid={cid!} onSaved={q.reload} />}

      <section className="card">
        <div className="row wrap">
          <input
            className="grow"
            placeholder="Tìm theo tiêu đề, DOI, tác giả"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s : "Mọi trạng thái"}
              </option>
            ))}
          </select>
          {can("corpus.download") && (
            <button disabled={!selected.size || act.busy} onClick={() => void act.run(() => runBatch("download"))}>
              Tải file ({selected.size})
            </button>
          )}
          {can("extraction.run") && (
            <button disabled={!selected.size || act.busy} onClick={() => void act.run(() => runBatch("extract"))}>
              Chạy extraction ({selected.size})
            </button>
          )}
        </div>
        {act.busy && <div className="muted small">Đang xử lý…</div>}
        <ErrorBox error={act.error ?? q.error} />
        {log.length > 0 && (
          <pre className="log">{log.join("\n")}</pre>
        )}
        {!q.data ? (
          <Loading />
        ) : (
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={items.length > 0 && items.every((d) => selected.has(d.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(items.map((d) => d.id)) : new Set())}
                  />
                </th>
                <th>Tài liệu</th>
                <th>Năm</th>
                <th>Nguồn</th>
                <th>OA</th>
                <th>Trạng thái</th>
                <th className="num">Câu</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  </td>
                  <td>
                    <Link to={`/w/${wid}/documents/${d.id}`}>{d.title || "(không có tiêu đề)"}</Link>
                    <div className="small muted">
                      {d.authors.slice(0, 3).join(", ")}
                      {d.authors.length > 3 ? " …" : ""} {d.venue ? `· ${d.venue}` : ""} {d.doi ? `· ${d.doi}` : ""}
                    </div>
                    {d.error && <div className="small warn">{d.error}</div>}
                  </td>
                  <td>{d.year ?? "—"}</td>
                  <td>{d.source}</td>
                  <td>{d.isOa ? "✓" : "—"}</td>
                  <td>
                    <Badge value={d.status} />
                  </td>
                  <td className="num">{d.sentenceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <span className="muted small">
            Trang {page}/{pages} · {q.data?.total ?? 0} tài liệu
          </span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
      </section>
    </div>
  );
}

/** Fetcher: search a source, preview metadata, tick rows, then save them as `fetched`. */
function FetchPanel({ wid, cid, onSaved }: { wid: string; cid: string; onSaved(): void }) {
  const api = useApi();
  const sources = useQuery<{ id: string; label: string }[]>(`/w/${wid}/sources`);
  const act = useAction();
  const [source, setSource] = useState("openalex");
  const [mode, setMode] = useState<"query" | "dois">("query");
  const [query, setQuery] = useState("");
  const [dois, setDois] = useState("");
  const [limit, setLimit] = useState(25);
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [oaOnly, setOaOnly] = useState(true);
  const [preview, setPreview] = useState<FetchedRecord[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");

  const payload = () => ({
    source,
    ...(mode === "query" ? { query } : { dois: dois.split(/[\s,;]+/).filter(Boolean) }),
    limit,
    oaOnly,
    ...(fromYear ? { fromYear: Number(fromYear) } : {}),
    ...(toYear ? { toYear: Number(toYear) } : {}),
  });

  return (
    <section className="card">
      <h3>Fetcher</h3>
      <p className="muted small">Fetcher chỉ lấy metadata (tiêu đề, DOI, license, link OA). File chỉ được tải khi bấm "Tải file".</p>
      <div className="row wrap">
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {(sources.data ?? [{ id: "openalex", label: "OpenAlex" }]).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as "query" | "dois")}>
          <option value="query">Từ khoá</option>
          <option value="dois">Danh sách DOI</option>
        </select>
        {mode === "query" ? (
          <input className="grow" placeholder="vd: hedging academic writing" value={query} onChange={(e) => setQuery(e.target.value)} />
        ) : (
          <textarea className="grow" rows={2} placeholder="Mỗi DOI một dòng" value={dois} onChange={(e) => setDois(e.target.value)} />
        )}
      </div>
      <div className="row wrap">
        <label className="inline">
          Số bản ghi <input type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </label>
        <label className="inline">
          Từ năm <input type="number" value={fromYear} onChange={(e) => setFromYear(e.target.value)} />
        </label>
        <label className="inline">
          Đến năm <input type="number" value={toYear} onChange={(e) => setToYear(e.target.value)} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={oaOnly} onChange={(e) => setOaOnly(e.target.checked)} /> Chỉ open access
        </label>
        <button
          disabled={act.busy}
          onClick={() =>
            void act.run(async () => {
              setMsg("");
              const res = await api<FetchedRecord[]>("POST", `/w/${wid}/corpora/${cid}/fetch/preview`, payload());
              setPreview(res);
              setPicked(new Set(res.filter((r) => !r.inCorpus).map((r) => r.externalId)));
            })
          }
        >
          Xem trước
        </button>
        {preview && (
          <button
            className="primary"
            disabled={act.busy || picked.size === 0}
            onClick={() =>
              void act.run(async () => {
                const res = await api<{ added: number; skipped: number }>("POST", `/w/${wid}/corpora/${cid}/fetch`, {
                  ...payload(),
                  only: [...picked],
                });
                setMsg(`Đã thêm ${res.added}, bỏ qua ${res.skipped} trùng.`);
                setPreview(null);
                onSaved();
              })
            }
          >
            Lưu {picked.size} bản ghi vào corpus
          </button>
        )}
      </div>
      <ErrorBox error={act.error} />
      {msg && <div className="ok">{msg}</div>}
      {preview && (
        <table className="compact">
          <thead>
            <tr>
              <th />
              <th>Tiêu đề</th>
              <th>Năm</th>
              <th>License</th>
              <th>OA</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.externalId} className={r.inCorpus ? "dim" : ""}>
                <td>
                  <input
                    type="checkbox"
                    disabled={r.inCorpus}
                    checked={picked.has(r.externalId)}
                    onChange={() => {
                      const n = new Set(picked);
                      n.has(r.externalId) ? n.delete(r.externalId) : n.add(r.externalId);
                      setPicked(n);
                    }}
                  />
                </td>
                <td>
                  {r.title}
                  <div className="small muted">
                    {r.authors.slice(0, 3).join(", ")} {r.doi ? `· ${r.doi}` : ""} {r.inCorpus ? "· đã có trong corpus" : ""}
                  </div>
                </td>
                <td>{r.year ?? "—"}</td>
                <td className="small">{r.license ?? "—"}</td>
                <td>{r.isOa ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
