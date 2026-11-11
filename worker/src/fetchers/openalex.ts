import { type FetchQuery, type FetchedRecord, type Fetcher, FetcherError, normalizeDoi, userAgent } from "./types";

interface OpenAlexWork {
  id: string;
  doi?: string | null;
  display_name?: string | null;
  title?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null; license?: string | null } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null; license?: string | null } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

/** OpenAlex stores abstracts as word → positions; rebuild the plain text. */
export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  const text = words.filter((w) => w !== undefined).join(" ").trim();
  return text || null;
}

export function mapOpenAlex(w: OpenAlexWork): FetchedRecord {
  const best = w.best_oa_location;
  return {
    source: "openalex",
    externalId: w.id.replace("https://openalex.org/", ""),
    doi: w.doi ? normalizeDoi(w.doi) : null,
    title: w.display_name ?? w.title ?? "",
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    abstract: rebuildAbstract(w.abstract_inverted_index),
    license: best?.license ?? w.primary_location?.license ?? null,
    isOa: Boolean(w.open_access?.is_oa),
    oaUrl: best?.pdf_url ?? w.open_access?.oa_url ?? best?.landing_page_url ?? null,
  };
}

export const openAlexFetcher: Fetcher = {
  id: "openalex",
  label: "OpenAlex",
  async search(q: FetchQuery, { contactEmail }) {
    const url = new URL("https://api.openalex.org/works");
    const filters: string[] = [];
    if (q.dois?.length) {
      const dois = q.dois.map(normalizeDoi).filter((d): d is string => Boolean(d)).slice(0, 50);
      if (!dois.length) return [];
      filters.push(`doi:${dois.map((d) => `https://doi.org/${d}`).join("|")}`);
    } else if (q.query?.trim()) {
      url.searchParams.set("search", q.query.trim());
    } else {
      throw new FetcherError("Give a search query or a list of DOIs.");
    }
    if (q.fromYear) filters.push(`from_publication_date:${q.fromYear}-01-01`);
    if (q.toYear) filters.push(`to_publication_date:${q.toYear}-12-31`);
    if (q.oaOnly) filters.push("is_oa:true");
    if (filters.length) url.searchParams.set("filter", filters.join(","));
    url.searchParams.set("per-page", String(Math.min(q.limit, 200)));
    if (contactEmail) url.searchParams.set("mailto", contactEmail);

    const res = await fetch(url, { headers: { "user-agent": userAgent(contactEmail), accept: "application/json" } });
    if (!res.ok) throw new FetcherError(`OpenAlex returned ${res.status}.`);
    const data = (await res.json()) as { results?: OpenAlexWork[] };
    return (data.results ?? []).map(mapOpenAlex).slice(0, q.limit);
  },
};
