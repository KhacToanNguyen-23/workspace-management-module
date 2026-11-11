import { type FetchQuery, type FetchedRecord, type Fetcher, FetcherError, normalizeDoi, userAgent } from "./types";

interface CrossrefWork {
  DOI: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: (number | null)[][] };
  "container-title"?: string[];
  abstract?: string;
  license?: { URL: string; "content-version"?: string }[];
  link?: { URL: string; "content-type"?: string; "intended-application"?: string }[];
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export function mapCrossref(w: CrossrefWork): FetchedRecord {
  const license = w.license?.find((l) => l["content-version"] === "vor")?.URL ?? w.license?.[0]?.URL ?? null;
  const isOa = Boolean(license && /creativecommons\.org/i.test(license));
  const pdf =
    w.link?.find((l) => l["content-type"] === "application/pdf" && l["intended-application"] === "text-mining") ??
    w.link?.find((l) => l["content-type"] === "application/pdf") ??
    w.link?.find((l) => l["intended-application"] === "text-mining");
  const doi = normalizeDoi(w.DOI) ?? w.DOI.toLowerCase();
  return {
    source: "crossref",
    externalId: doi,
    doi,
    title: stripTags(w.title?.[0] ?? ""),
    authors: (w.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
    year: w.issued?.["date-parts"]?.[0]?.[0] ?? null,
    venue: w["container-title"]?.[0] ?? null,
    abstract: w.abstract ? stripTags(w.abstract.replace(/<jats:title>.*?<\/jats:title>/i, "")) : null,
    license,
    isOa,
    oaUrl: isOa ? (pdf?.URL ?? null) : null,
  };
}

export const crossrefFetcher: Fetcher = {
  id: "crossref",
  label: "Crossref",
  async search(q: FetchQuery, { contactEmail }) {
    const headers = { "user-agent": userAgent(contactEmail), accept: "application/json" };
    let works: CrossrefWork[];
    if (q.dois?.length) {
      const dois = q.dois.map(normalizeDoi).filter((d): d is string => Boolean(d)).slice(0, q.limit);
      works = [];
      for (const doi of dois) {
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers });
        if (res.status === 404) continue;
        if (!res.ok) throw new FetcherError(`Crossref returned ${res.status} for ${doi}.`);
        works.push(((await res.json()) as { message: CrossrefWork }).message);
      }
    } else if (q.query?.trim()) {
      const url = new URL("https://api.crossref.org/works");
      url.searchParams.set("query", q.query.trim());
      url.searchParams.set("rows", String(Math.min(q.limit, 100)));
      const filters = ["type:journal-article"];
      if (q.fromYear) filters.push(`from-pub-date:${q.fromYear}`);
      if (q.toYear) filters.push(`until-pub-date:${q.toYear}`);
      if (q.oaOnly) filters.push("has-license:true");
      url.searchParams.set("filter", filters.join(","));
      if (contactEmail) url.searchParams.set("mailto", contactEmail);
      const res = await fetch(url, { headers });
      if (!res.ok) throw new FetcherError(`Crossref returned ${res.status}.`);
      works = ((await res.json()) as { message: { items: CrossrefWork[] } }).message.items ?? [];
    } else {
      throw new FetcherError("Give a search query or a list of DOIs.");
    }
    const records = works.map(mapCrossref);
    return (q.oaOnly ? records.filter((r) => r.isOa) : records).slice(0, q.limit);
  },
};
