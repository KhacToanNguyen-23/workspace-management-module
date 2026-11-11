import { type Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { type Param, newId, nowIso, stmt } from "../lib/db";
import { body, fail, intParam } from "../lib/http";
import { FETCHERS, FetcherError, type FetchedRecord } from "../fetchers";
import { loadAccess, requirePerm } from "../services/access";
import { auditStmt } from "../services/audit";
import { HttpDownloader, type Downloader } from "../services/downloader";
import { extractSentences, fileToText } from "../services/extraction";

/** Routes under /api/w/:wid — corpora, fetch → download → extract, document views. */
export function corpusRoutes(makeDownloader?: (maxBytes: number) => Downloader) {
  const r = new Hono<AppEnv>();
  const downloaderFor = (maxBytes: number) => makeDownloader?.(maxBytes) ?? new HttpDownloader(maxBytes);

  const access = (c: Context<AppEnv>) =>
    loadAccess(c.get("db"), c.get("user"), c.req.param("wid")!);

  async function loadCorpus(c: Context<AppEnv>, workspaceId: string) {
    const corpus = await c.get("db").first<{ id: string; name: string }>(
      "SELECT id, name FROM corpora WHERE id = ? AND workspace_id = ?",
      c.req.param("cid")!,
      workspaceId,
    );
    if (!corpus) fail(404, "Corpus not found.", "not_found");
    return corpus;
  }

  r.get("/sources", (c) => c.json(Object.values(FETCHERS).map((f) => ({ id: f.id, label: f.label }))));

  // ---- corpora ---------------------------------------------------------------------------
  r.get("/corpora", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.read");
    const rows = await c.get("db").all(
      `SELECT c.id, c.name, c.description, c.created_by AS createdBy, c.created_at AS createdAt,
              COUNT(d.id) AS total,
              SUM(CASE WHEN d.status = 'fetched' THEN 1 ELSE 0 END) AS fetched,
              SUM(CASE WHEN d.status = 'downloaded' THEN 1 ELSE 0 END) AS downloaded,
              SUM(CASE WHEN d.status = 'extracted' THEN 1 ELSE 0 END) AS extracted,
              SUM(CASE WHEN d.status IN ('download_failed','extract_failed') THEN 1 ELSE 0 END) AS failed,
              COALESCE(SUM(d.sentence_count), 0) AS sentences
         FROM corpora c LEFT JOIN documents d ON d.corpus_id = c.id
        WHERE c.workspace_id = ?
        GROUP BY c.id ORDER BY c.created_at DESC`,
      a.workspace.id,
    );
    return c.json(rows);
  });

  const CorpusBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).default("") });

  r.post("/corpora", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.write");
    const { name, description } = await body(c, CorpusBody);
    const db = c.get("db");
    const user = c.get("user");
    if (await db.first("SELECT 1 FROM corpora WHERE workspace_id = ? AND name = ?", a.workspace.id, name)) {
      fail(409, "A corpus with this name already exists.", "duplicate");
    }
    const id = newId();
    await db.batch([
      stmt(
        "INSERT INTO corpora (id, workspace_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        a.workspace.id,
        name,
        description,
        user.email,
        nowIso(),
      ),
      auditStmt({ actor: user.email, action: "corpus.create", target: id, workspaceId: a.workspace.id, detail: { name } }),
    ]);
    return c.json({ id, name, description }, 201);
  });

  r.delete("/corpora/:cid", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.write");
    const corpus = await loadCorpus(c, a.workspace.id);
    const db = c.get("db");
    const keys = await db.all<{ content_key: string }>(
      "SELECT content_key FROM documents WHERE corpus_id = ? AND content_key IS NOT NULL",
      corpus.id,
    );
    for (const k of keys) await c.get("files").delete(k.content_key);
    await db.batch([
      stmt("DELETE FROM sentences WHERE document_id IN (SELECT id FROM documents WHERE corpus_id = ?)", corpus.id),
      stmt("DELETE FROM documents WHERE corpus_id = ?", corpus.id),
      stmt("DELETE FROM corpora WHERE id = ?", corpus.id),
      auditStmt({ actor: c.get("user").email, action: "corpus.delete", target: corpus.id, workspaceId: a.workspace.id, detail: { name: corpus.name } }),
    ]);
    return c.body(null, 204);
  });

  // ---- documents list --------------------------------------------------------------------
  r.get("/corpora/:cid/documents", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.read");
    const corpus = await loadCorpus(c, a.workspace.id);
    const page = intParam(c.req.query("page"), 1, 1, 10_000);
    const pageSize = intParam(c.req.query("pageSize"), 25, 1, 100);
    const where = ["corpus_id = ?"];
    const params: Param[] = [corpus.id];
    const status = c.req.query("status");
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    const q = c.req.query("q")?.trim();
    if (q) {
      where.push("(title LIKE ? OR doi LIKE ? OR authors LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const db = c.get("db");
    const total = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM documents WHERE ${where.join(" AND ")}`, ...params);
    const rows = await db.all<Record<string, unknown> & { authors: string }>(
      `SELECT id, source, external_id AS externalId, doi, title, authors, year, venue, license, is_oa AS isOa,
              oa_url AS oaUrl, status, error, content_type AS contentType, content_bytes AS contentBytes,
              sentence_count AS sentenceCount, fetched_at AS fetchedAt, downloaded_at AS downloadedAt,
              extracted_at AS extractedAt
         FROM documents WHERE ${where.join(" AND ")}
        ORDER BY fetched_at DESC, title LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    return c.json({
      corpus,
      page,
      pageSize,
      total: total?.n ?? 0,
      items: rows.map((d) => ({ ...d, authors: JSON.parse(d.authors), isOa: Boolean(d.isOa) })),
    });
  });

  // ---- fetcher ---------------------------------------------------------------------------
  const FetchBody = z
    .object({
      source: z.string(),
      query: z.string().max(500).optional(),
      dois: z.array(z.string()).max(100).optional(),
      limit: z.number().int().min(1).max(100).default(25),
      fromYear: z.number().int().min(1900).max(2100).optional(),
      toYear: z.number().int().min(1900).max(2100).optional(),
      oaOnly: z.boolean().default(true),
      /** When saving: keep only these external ids from the result (the rows ticked in the preview). */
      only: z.array(z.string()).max(200).optional(),
    })
    .refine((b) => b.query?.trim() || b.dois?.length, { message: "query or dois is required" });

  async function runFetch(c: Context<AppEnv>, input: z.infer<typeof FetchBody>) {
    const fetcher = FETCHERS[input.source];
    if (!fetcher) fail(422, `Unknown source "${input.source}".`, "unknown_source");
    try {
      return await fetcher.search(input, { contactEmail: c.env.API_CONTACT_EMAIL });
    } catch (err) {
      if (err instanceof FetcherError) fail(502, err.message, "source_error");
      throw err;
    }
  }

  /** Preview: list matching records without saving anything. */
  r.post("/corpora/:cid/fetch/preview", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.fetch");
    const corpus = await loadCorpus(c, a.workspace.id);
    const input = await body(c, FetchBody);
    const records = await runFetch(c, input);
    const existing = await c.get("db").all<{ external_id: string }>(
      "SELECT external_id FROM documents WHERE corpus_id = ? AND source = ?",
      corpus.id,
      input.source,
    );
    const have = new Set(existing.map((e) => e.external_id));
    return c.json(records.map((r) => ({ ...r, inCorpus: have.has(r.externalId) })));
  });

  /** Save fetched metadata into the corpus (status = fetched). Duplicates are skipped. */
  r.post("/corpora/:cid/fetch", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.fetch");
    const corpus = await loadCorpus(c, a.workspace.id);
    const input = await body(c, FetchBody);
    let records: FetchedRecord[] = await runFetch(c, input);
    if (input.only) {
      const only = new Set(input.only);
      records = records.filter((r) => only.has(r.externalId));
    }
    const db = c.get("db");
    const user = c.get("user");
    const dupes = await db.all<{ external_id: string; doi: string | null }>(
      "SELECT external_id, doi FROM documents WHERE corpus_id = ?",
      corpus.id,
    );
    const haveIds = new Set(dupes.map((d) => d.external_id));
    const haveDois = new Set(dupes.map((d) => d.doi).filter(Boolean));
    const fresh = records.filter((r) => !haveIds.has(r.externalId) && !(r.doi && haveDois.has(r.doi)));
    const now = nowIso();
    await db.batch([
      ...fresh.map((r) =>
        stmt(
          `INSERT INTO documents (id, corpus_id, workspace_id, source, external_id, doi, title, authors, year, venue,
                                  abstract, license, is_oa, oa_url, status, added_by, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fetched', ?, ?)`,
          newId(),
          corpus.id,
          a.workspace.id,
          r.source,
          r.externalId,
          r.doi,
          r.title,
          JSON.stringify(r.authors),
          r.year,
          r.venue,
          r.abstract,
          r.license,
          r.isOa ? 1 : 0,
          r.oaUrl,
          user.email,
          now,
        ),
      ),
      auditStmt({
        actor: user.email,
        action: "corpus.fetch",
        target: corpus.id,
        workspaceId: a.workspace.id,
        detail: { source: input.source, query: input.query ?? null, dois: input.dois?.length ?? 0, added: fresh.length, skipped: records.length - fresh.length },
      }),
    ]);
    return c.json({ added: fresh.length, skipped: records.length - fresh.length });
  });

  // ---- downloader ------------------------------------------------------------------------
  const IdsBody = z.object({ documentIds: z.array(z.string()).min(1).max(10) });

  type DocRow = {
    id: string;
    title: string;
    is_oa: number;
    oa_url: string | null;
    status: string;
    abstract: string | null;
    content_key: string | null;
    content_type: string | null;
  };

  async function loadDocs(c: Context<AppEnv>, corpusId: string, ids: string[]) {
    const docs = await c.get("db").all<DocRow>(
      `SELECT id, title, is_oa, oa_url, status, abstract, content_key, content_type
         FROM documents WHERE corpus_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
      corpusId,
      ...ids,
    );
    if (docs.length !== new Set(ids).size) fail(404, "Some documents are not in this corpus.", "not_found");
    return docs;
  }

  r.post("/corpora/:cid/download", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.download");
    const corpus = await loadCorpus(c, a.workspace.id);
    const { documentIds } = await body(c, IdsBody);
    const docs = await loadDocs(c, corpus.id, documentIds);
    const db = c.get("db");
    const files = c.get("files");
    const downloader = downloaderFor(Number(c.env.MAX_DOWNLOAD_BYTES ?? "") || 25 * 1024 * 1024);
    const results: { id: string; status: string; error?: string }[] = [];
    // Publishers can be slow; download the batch (≤10) in parallel instead of one by one.
    const fetched = await Promise.all(docs.map((d) => downloader.download({ oaUrl: d.oa_url, isOa: Boolean(d.is_oa) })));
    for (const [i, d] of docs.entries()) {
      const res = fetched[i];
      if (!res.ok) {
        await db.run("UPDATE documents SET status = 'download_failed', error = ? WHERE id = ?", res.error, d.id);
        results.push({ id: d.id, status: "download_failed", error: res.error });
        continue;
      }
      const key = `ws/${a.workspace.id}/docs/${d.id}`;
      await files.put(key, res.data, res.contentType);
      await db.run(
        `UPDATE documents SET status = 'downloaded', error = NULL, content_key = ?, content_type = ?, content_bytes = ?,
                content_sha256 = ?, downloaded_at = ?, sentence_count = 0, extracted_at = NULL WHERE id = ?`,
        key,
        res.contentType,
        res.data.byteLength,
        res.sha256,
        nowIso(),
        d.id,
      );
      await db.run("DELETE FROM sentences WHERE document_id = ?", d.id);
      results.push({ id: d.id, status: "downloaded" });
    }
    await db.batch([
      auditStmt({
        actor: c.get("user").email,
        action: "corpus.download",
        target: corpus.id,
        workspaceId: a.workspace.id,
        detail: { ok: results.filter((x) => x.status === "downloaded").length, failed: results.filter((x) => x.status !== "downloaded").length },
      }),
    ]);
    return c.json({ results });
  });

  // ---- extraction ------------------------------------------------------------------------
  r.post("/corpora/:cid/extract", async (c) => {
    const a = await access(c);
    requirePerm(a, "extraction.run");
    const corpus = await loadCorpus(c, a.workspace.id);
    const { documentIds } = await body(c, IdsBody);
    const docs = await loadDocs(c, corpus.id, documentIds);
    const db = c.get("db");
    const files = c.get("files");
    const results: { id: string; status: string; sentences?: number; error?: string }[] = [];
    for (const d of docs) {
      try {
        let fullText: string | null = null;
        if (d.content_key) {
          const file = await files.get(d.content_key);
          if (file) fullText = await fileToText(file.data, d.content_type ?? file.contentType);
        }
        if (!fullText && !d.abstract) throw new Error("Nothing to extract: no downloaded file and no abstract.");
        const sentences = extractSentences(fullText, d.abstract);
        const stmts = [
          stmt("DELETE FROM sentences WHERE document_id = ?", d.id),
          ...sentences.map((s, i) =>
            stmt("INSERT INTO sentences (document_id, idx, section, text) VALUES (?, ?, ?, ?)", d.id, i, s.section, s.text),
          ),
          stmt(
            `UPDATE documents SET status = 'extracted', error = ?, sentence_count = ?, extracted_at = ? WHERE id = ?`,
            fullText ? null : "Only the abstract was available.",
            sentences.length,
            nowIso(),
            d.id,
          ),
        ];
        for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
        results.push({ id: d.id, status: "extracted", sentences: sentences.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.run("UPDATE documents SET status = 'extract_failed', error = ? WHERE id = ?", msg, d.id);
        results.push({ id: d.id, status: "extract_failed", error: msg });
      }
    }
    await db.batch([
      auditStmt({
        actor: c.get("user").email,
        action: "extraction.run",
        target: corpus.id,
        workspaceId: a.workspace.id,
        detail: { ok: results.filter((x) => x.status === "extracted").length, failed: results.filter((x) => x.status !== "extracted").length },
      }),
    ]);
    return c.json({ results });
  });

  // ---- one document ----------------------------------------------------------------------
  async function loadDocument(c: Context<AppEnv>, workspaceId: string) {
    const d = await c.get("db").first<Record<string, unknown> & { authors: string; content_key: string | null }>(
      "SELECT * FROM documents WHERE id = ? AND workspace_id = ?",
      c.req.param("did")!,
      workspaceId,
    );
    if (!d) fail(404, "Document not found.", "not_found");
    return d;
  }

  r.get("/documents/:did", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.read");
    const d = await loadDocument(c, a.workspace.id);
    const section = c.req.query("section");
    const sentences = await c.get("db").all(
      `SELECT idx, section, text FROM sentences WHERE document_id = ? ${section ? "AND section = ?" : ""} ORDER BY idx`,
      ...(section ? [d.id as string, section] : [d.id as string]),
    );
    const { content_key: _k, ...rest } = d;
    return c.json({ document: { ...rest, authors: JSON.parse(d.authors), is_oa: Boolean(d.is_oa) }, sentences });
  });

  r.get("/documents/:did/file", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.read");
    const d = await loadDocument(c, a.workspace.id);
    if (!d.content_key) fail(404, "This document has not been downloaded.", "not_downloaded");
    const file = await c.get("files").get(d.content_key);
    if (!file) fail(404, "File is missing from storage.", "missing_file");
    return new Response(file.data, { headers: { "content-type": file.contentType, "cache-control": "private, no-store" } });
  });

  r.delete("/documents/:did", async (c) => {
    const a = await access(c);
    requirePerm(a, "corpus.write");
    const d = await loadDocument(c, a.workspace.id);
    if (d.content_key) await c.get("files").delete(d.content_key);
    await c.get("db").batch([
      stmt("DELETE FROM sentences WHERE document_id = ?", d.id as string),
      stmt("DELETE FROM documents WHERE id = ?", d.id as string),
      auditStmt({ actor: c.get("user").email, action: "document.delete", target: d.id as string, workspaceId: a.workspace.id }),
    ]);
    return c.body(null, 204);
  });

  return r;
}
