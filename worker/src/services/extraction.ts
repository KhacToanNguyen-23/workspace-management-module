/**
 * Turns a downloaded file (or just the abstract) into section-tagged sentences.
 * Deliberately rule-based and dependency-light so it runs inside a Worker.
 */
import { extractText, getDocumentProxy } from "unpdf";

export interface ExtractedSentence {
  section: string;
  text: string;
}

const SECTION_PATTERNS: [RegExp, string][] = [
  [/^abstract$/, "abstract"],
  [/^(introduction|background)$/, "introduction"],
  [/^(related work|literature review|theoretical (framework|background))$/, "literature"],
  [/^(methods?|methodology|materials and methods|research design|experimental setup|data and methods)$/, "methods"],
  [/^(results?|findings|results and discussion)$/, "results"],
  [/^discussion$/, "discussion"],
  [/^(conclusions?|concluding remarks|summary and conclusions?)$/, "conclusion"],
  [/^limitations?( and future work)?$/, "limitations"],
];
const END_PATTERN = /^(references|bibliography|acknowledge?ments?|funding|conflicts? of interest|appendix)$/;

/** Returns a section code if the line looks like a heading such as "2. Methods" or "RESULTS". */
export function headingSection(line: string): string | "END" | null {
  const t = line
    .trim()
    .replace(/^((\d+(\.\d+)*)|[ivx]+)[.)]?\s+/i, "")
    .replace(/[:.]$/, "")
    .toLowerCase();
  if (!t || t.length > 60) return null;
  if (END_PATTERN.test(t)) return "END";
  for (const [re, code] of SECTION_PATTERNS) if (re.test(t)) return code;
  return null;
}

const ABBREVIATIONS = ["e.g", "i.e", "al", "etc", "vs", "fig", "figs", "eq", "eqs", "cf", "dr", "mr", "ms", "no", "vol", "pp", "approx", "resp", "sec", "tab"];

/** Sentence splitter that respects common academic abbreviations, decimals and initials. */
export function splitSentences(input: string): string[] {
  // Sources often glue sentences together ("articles.However"); put the space back.
  const text = input.replace(/([a-z\d)\]]{2,}[.!?])(?=[A-Z][a-z])/g, "$1 ");
  const out: string[] = [];
  const re = /[.!?]["')\]]*\s+(?=["'(\[]?[A-Z0-9])/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + 1;
    const before = text.slice(start, end);
    const lastWord = before.match(/(\S+)\.$/)?.[1]?.toLowerCase().replace(/^[("']+/, "") ?? "";
    if (ABBREVIATIONS.includes(lastWord) || /^[a-z]$/i.test(lastWord)) continue;
    out.push(text.slice(start, m.index + m[0].trimEnd().length).trim());
    start = m.index + m[0].length;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|nav|header|footer|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|section|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function fileToText(data: ArrayBuffer, contentType: string): Promise<string> {
  if (contentType === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [text]).join("\n");
  }
  const raw = new TextDecoder().decode(data);
  if (contentType === "text/html" || contentType === "application/xml") return htmlToText(raw);
  return raw;
}

const keep = (s: string) => s.length >= 20 && s.length <= 1500 && s.split(/\s+/).length >= 4 && /[a-z]/i.test(s);

/** Builds the sentence list: abstract first, then body text split by detected headings. */
export function extractSentences(fullText: string | null, abstract: string | null): ExtractedSentence[] {
  const out: ExtractedSentence[] = [];
  const seen = new Set<string>();
  const push = (section: string, s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (!keep(t) || seen.has(t)) return;
    seen.add(t);
    out.push({ section, text: t });
  };

  if (abstract) for (const s of splitSentences(abstract.replace(/\s+/g, " "))) push("abstract", s);
  if (!fullText) return out;

  // Re-join words hyphenated across line breaks, then walk the lines.
  const lines = fullText.replace(/(\w)-\n(\w)/g, "$1$2").split(/\n/);
  let section = "body";
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) for (const s of splitSentences(buffer.join(" ").replace(/\s+/g, " "))) push(section, s);
    buffer = [];
  };
  for (const line of lines) {
    const h = headingSection(line);
    if (h === "END") {
      flush();
      break;
    }
    if (h) {
      flush();
      section = h;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}
