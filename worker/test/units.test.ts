import { describe, expect, it } from "vitest";
import { mapCrossref } from "../src/fetchers/crossref";
import { rebuildAbstract } from "../src/fetchers/openalex";
import { normalizeDoi } from "../src/fetchers/types";
import { effectivePermissions } from "../src/lib/permissions";
import { sniffContentType } from "../src/services/downloader";
import { extractSentences, headingSection, splitSentences } from "../src/services/extraction";

describe("permissions", () => {
  it("intersects role permissions with the workspace switch", () => {
    expect(effectivePermissions("member", ["corpus.read", "extraction.run"], false)).toEqual(["corpus.read", "extraction.run"]);
    expect(effectivePermissions("viewer", ["corpus.read", "corpus.fetch"], false)).toEqual(["corpus.read"]);
    expect(effectivePermissions("manager", [], false)).toEqual(["members.manage"]);
    expect(effectivePermissions(null, ["corpus.read"], false)).toEqual([]);
    expect(effectivePermissions(null, [], true)).toContain("corpus.download");
  });
});

describe("sentence splitting", () => {
  it("keeps abbreviations, decimals and initials together", () => {
    const s = splitSentences(
      "Results vary, e.g. across fields (Smith et al. 2020). The rate was 3.5 times higher. See Fig. 2 for details. J. K. Rowling wrote it.",
    );
    expect(s).toEqual([
      "Results vary, e.g. across fields (Smith et al. 2020).",
      "The rate was 3.5 times higher.",
      "See Fig. 2 for details.",
      "J. K. Rowling wrote it.",
    ]);
  });

  it("splits sentences glued without a space", () => {
    expect(splitSentences("Hedging is common in articles.However, it is hard to learn.")).toEqual([
      "Hedging is common in articles.",
      "However, it is hard to learn.",
    ]);
  });

  it("detects numbered and upper-case headings", () => {
    expect(headingSection("2. Methods")).toBe("methods");
    expect(headingSection("RESULTS AND DISCUSSION")).toBe("results");
    expect(headingSection("IV. Conclusion")).toBe("conclusion");
    expect(headingSection("References")).toBe("END");
    expect(headingSection("We used methods from prior work.")).toBeNull();
  });

  it("re-joins hyphenated line breaks and drops short fragments", () => {
    const out = extractSentences("Introduction\nThe experi-\nment was repeated three times in total.\nPage 3", null);
    expect(out).toEqual([{ section: "introduction", text: "The experiment was repeated three times in total." }]);
  });
});

describe("fetcher mapping", () => {
  it("normalizes DOIs from URLs and prefixes", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC.1.")).toBe("10.1000/abc.1");
    expect(normalizeDoi("doi:10.5555/x-y")).toBe("10.5555/x-y");
    expect(normalizeDoi("not a doi")).toBeNull();
  });

  it("rebuilds OpenAlex inverted abstracts", () => {
    expect(rebuildAbstract({ world: [1], Hello: [0] })).toBe("Hello world");
    expect(rebuildAbstract(null)).toBeNull();
  });

  it("maps Crossref works and marks CC licences as open access", () => {
    const r = mapCrossref({
      DOI: "10.1/XYZ",
      title: ["A <i>study</i>"],
      author: [{ given: "Ann", family: "Lee" }],
      issued: { "date-parts": [[2020, 1]] },
      abstract: "<jats:title>Abstract</jats:title><jats:p>We study things.</jats:p>",
      license: [{ URL: "http://creativecommons.org/licenses/by/4.0/", "content-version": "vor" }],
      link: [{ URL: "https://x.org/a.pdf", "content-type": "application/pdf" }],
    });
    expect(r).toMatchObject({ doi: "10.1/xyz", title: "A study", authors: ["Ann Lee"], year: 2020, abstract: "We study things.", isOa: true, oaUrl: "https://x.org/a.pdf" });
  });
});

describe("content sniffing", () => {
  it("trusts magic bytes over the header", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    expect(sniffContentType(pdf, "application/octet-stream")).toBe("application/pdf");
    expect(sniffContentType(new TextEncoder().encode("<!DOCTYPE html><html>"), "application/pdf")).toBe("text/html");
  });
});
