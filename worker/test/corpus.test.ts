import { afterEach, describe, expect, it, vi } from "vitest";
import type { Downloader } from "../src/services/downloader";
import { ALICE, BOB, MANAGER, joinAndApprove, seedWorkspace, setup } from "./helpers";

const OPENALEX_PAGE = {
  results: [
    {
      id: "https://openalex.org/W1",
      doi: "https://doi.org/10.1000/abc.1",
      display_name: "Hedging in academic writing",
      publication_year: 2022,
      authorships: [{ author: { display_name: "A. Writer" } }],
      primary_location: { source: { display_name: "Journal of Writing" } },
      best_oa_location: { pdf_url: "https://example.org/w1.pdf", license: "cc-by" },
      open_access: { is_oa: true, oa_url: "https://example.org/w1.pdf" },
      abstract_inverted_index: { This: [0], study: [1], examines: [2], hedging: [3], "devices.": [4] },
    },
    {
      id: "https://openalex.org/W2",
      doi: null,
      display_name: "Closed paper",
      publication_year: 2021,
      authorships: [],
      open_access: { is_oa: false, oa_url: null },
    },
  ],
};

const ARTICLE_HTML = `<html><head><title>x</title><script>var x=1;</script></head><body>
<h2>1. Introduction</h2><p>Academic writers often hedge their claims. This paper studies how they do it, e.g. with modal verbs.</p>
<h2>2. Methods</h2><p>We collected 120 research articles from four journals. Each article was annotated by two raters.</p>
<h2>3. Results</h2><p>Hedges appeared in 85.5% of discussion sections. Fig. 2 shows the distribution across fields.</p>
<h2>References</h2><p>Hyland, K. (1998). Hedging in scientific research articles.</p>
</body></html>`;

const fakeDownloader: Downloader = {
  async download(doc) {
    if (!doc.isOa || !doc.oaUrl) return { ok: false, error: "Not open access; download skipped." };
    return { ok: true, data: new TextEncoder().encode(ARTICLE_HTML).buffer as ArrayBuffer, contentType: "text/html", sha256: "abc" };
  },
};

function stubOpenAlex() {
  const spy = vi.fn(async (url: string | URL) => {
    expect(String(url)).toContain("api.openalex.org/works");
    return new Response(JSON.stringify(OPENALEX_PAGE), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

async function ready() {
  const t = setup({ downloader: fakeDownloader });
  const wid = await seedWorkspace(t.call);
  await joinAndApprove(t.call, wid, ALICE, "member");
  const corpus = await t.call("POST", `/api/w/${wid}/corpora`, ALICE, { name: "Hedging", description: "SLR corpus" });
  expect(corpus.status).toBe(201);
  return { ...t, wid, cid: corpus.data.id as string };
}

describe("corpus pipeline", () => {
  it("previews without saving, then saves and skips duplicates", async () => {
    const { call, wid, cid } = await ready();
    const spy = stubOpenAlex();
    const search = { source: "openalex", query: "hedging", limit: 10, oaOnly: false };

    const preview = await call("POST", `/api/w/${wid}/corpora/${cid}/fetch/preview`, ALICE, search);
    expect(preview.status).toBe(200);
    expect(preview.data[0]).toMatchObject({ externalId: "W1", doi: "10.1000/abc.1", abstract: "This study examines hedging devices.", isOa: true, inCorpus: false });
    expect(String(spy.mock.calls[0][0])).toContain("search=hedging");

    let list = await call("GET", `/api/w/${wid}/corpora/${cid}/documents`, ALICE);
    expect(list.data.total).toBe(0);

    const save = await call("POST", `/api/w/${wid}/corpora/${cid}/fetch`, ALICE, search);
    expect(save.data).toEqual({ added: 2, skipped: 0 });
    const again = await call("POST", `/api/w/${wid}/corpora/${cid}/fetch`, ALICE, search);
    expect(again.data).toEqual({ added: 0, skipped: 2 });

    list = await call("GET", `/api/w/${wid}/corpora/${cid}/documents?status=fetched`, ALICE);
    expect(list.data.total).toBe(2);
    expect(list.data.items[0].authors).toBeInstanceOf(Array);
  });

  it("saves only the rows ticked in the preview", async () => {
    const { call, wid, cid } = await ready();
    stubOpenAlex();
    const save = await call("POST", `/api/w/${wid}/corpora/${cid}/fetch`, ALICE, { source: "openalex", query: "hedging", only: ["W1"] });
    expect(save.data.added).toBe(1);
  });

  it("downloads open-access files, refuses closed ones, then extracts sentences", async () => {
    const { call, files, wid, cid } = await ready();
    stubOpenAlex();
    await call("POST", `/api/w/${wid}/corpora/${cid}/fetch`, ALICE, { source: "openalex", query: "hedging", oaOnly: false });
    const docs = (await call("GET", `/api/w/${wid}/corpora/${cid}/documents`, ALICE)).data.items;
    const open = docs.find((d: { externalId: string }) => d.externalId === "W1");
    const closed = docs.find((d: { externalId: string }) => d.externalId === "W2");

    const dl = await call("POST", `/api/w/${wid}/corpora/${cid}/download`, ALICE, { documentIds: [open.id, closed.id] });
    const byId = Object.fromEntries(dl.data.results.map((r: { id: string }) => [r.id, r]));
    expect(byId[open.id].status).toBe("downloaded");
    expect(byId[closed.id]).toMatchObject({ status: "download_failed", error: "Not open access; download skipped." });
    expect(files.size()).toBe(1);

    const ex = await call("POST", `/api/w/${wid}/corpora/${cid}/extract`, ALICE, { documentIds: [open.id] });
    expect(ex.data.results[0].status).toBe("extracted");

    const doc = await call("GET", `/api/w/${wid}/documents/${open.id}`, ALICE);
    const sections = doc.data.sentences.map((s: { section: string }) => s.section);
    expect(sections).toEqual(expect.arrayContaining(["abstract", "introduction", "methods", "results"]));
    const texts = doc.data.sentences.map((s: { text: string }) => s.text);
    expect(texts).toContain("This paper studies how they do it, e.g. with modal verbs.");
    expect(texts).toContain("Hedges appeared in 85.5% of discussion sections.");
    expect(texts.some((t: string) => t.includes("Hyland"))).toBe(false); // references are cut
    expect(texts.some((t: string) => t.includes("var x"))).toBe(false); // scripts are stripped

    const file = await call("GET", `/api/w/${wid}/documents/${open.id}/file`, ALICE);
    expect(file.status).toBe(200);

    // Closed paper still has no abstract → extraction fails with a reason.
    const ex2 = await call("POST", `/api/w/${wid}/corpora/${cid}/extract`, ALICE, { documentIds: [closed.id] });
    expect(ex2.data.results[0].status).toBe("extract_failed");

    const corpora = await call("GET", `/api/w/${wid}/corpora`, ALICE);
    expect(corpora.data[0]).toMatchObject({ name: "Hedging", total: 2, extracted: 1, failed: 1 });
    expect(corpora.data[0].sentences).toBeGreaterThan(4);
  });

  it("enforces permissions per role and per workspace switch", async () => {
    const { call, wid, cid } = await ready();
    stubOpenAlex();
    await call("POST", `/api/w/${wid}/members`, MANAGER, { email: BOB, role: "viewer" });
    expect((await call("GET", `/api/w/${wid}/corpora`, BOB)).status).toBe(200);
    const denied = await call("POST", `/api/w/${wid}/corpora/${cid}/fetch`, BOB, { source: "openalex", query: "x" });
    expect(denied.status).toBe(403);
    expect(denied.data.error.message).toContain("corpus.fetch");

    await call("PUT", `/api/w/${wid}/permissions`, MANAGER, { permissions: ["corpus.read"] });
    expect((await call("POST", `/api/w/${wid}/corpora/${cid}/fetch`, ALICE, { source: "openalex", query: "x" })).status).toBe(403);
    expect((await call("GET", `/api/w/${wid}/corpora/${cid}/documents`, ALICE)).status).toBe(200);
  });

  it("keeps corpora inside their workspace", async () => {
    const { call, wid, cid } = await ready();
    const other = await call("POST", "/api/admin/workspaces", "admin@hyperdatalab.org", { name: "Other", slug: "other", type: "review", managers: [BOB] });
    const res = await call("GET", `/api/w/${other.data.id}/corpora/${cid}/documents`, BOB);
    expect(res.status).toBe(404);
    expect(wid).not.toBe(other.data.id);
  });

  it("validates fetch input", async () => {
    const { call, wid, cid } = await ready();
    expect((await call("POST", `/api/w/${wid}/corpora/${cid}/fetch/preview`, ALICE, { source: "openalex" })).status).toBe(422);
    expect((await call("POST", `/api/w/${wid}/corpora/${cid}/fetch/preview`, ALICE, { source: "nope", query: "x" })).status).toBe(422);
  });
});
