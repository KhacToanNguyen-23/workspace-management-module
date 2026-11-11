/**
 * Downloads the open-access file of a fetched document.
 *
 * The Writing Bank already has a downloader; this module keeps the same contract behind the
 * `Downloader` interface so the existing one can be plugged in at integration time.
 * Gate: only records the fetcher marked open access (is_oa + oa_url) are downloaded.
 */
export interface DownloadInput {
  oaUrl: string | null;
  isOa: boolean;
}

export type DownloadResult =
  | { ok: true; data: ArrayBuffer; contentType: string; sha256: string }
  | { ok: false; error: string };

export interface Downloader {
  download(doc: DownloadInput): Promise<DownloadResult>;
}

const DEFAULT_MAX = 25 * 1024 * 1024;

export function sniffContentType(bytes: Uint8Array, header: string | null): string {
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("%pdf")) return "application/pdf";
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || /<(head|body)[\s>]/.test(head)) return "text/html";
  if (header?.includes("xml")) return "application/xml";
  if (header?.startsWith("text/")) return header.split(";")[0];
  return header?.split(";")[0] || "application/octet-stream";
}

async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class HttpDownloader implements Downloader {
  constructor(
    private readonly maxBytes = DEFAULT_MAX,
    private readonly userAgent = "WritingBankModule/0.1",
  ) {}

  async download(doc: DownloadInput): Promise<DownloadResult> {
    if (!doc.isOa) return { ok: false, error: "Not open access; download skipped." };
    if (!doc.oaUrl) return { ok: false, error: "No open-access file URL." };
    let res: Response;
    try {
      res = await fetch(doc.oaUrl, {
        redirect: "follow",
        headers: { "user-agent": this.userAgent, accept: "application/pdf, text/html;q=0.8, */*;q=0.5" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      return { ok: false, error: `Download failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!res.ok) return { ok: false, error: `Source answered HTTP ${res.status}.` };
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > this.maxBytes) return { ok: false, error: `File is larger than ${this.maxBytes} bytes.` };
    const data = await res.arrayBuffer();
    if (data.byteLength > this.maxBytes) return { ok: false, error: `File is larger than ${this.maxBytes} bytes.` };
    if (data.byteLength === 0) return { ok: false, error: "Empty file." };
    const contentType = sniffContentType(new Uint8Array(data), res.headers.get("content-type"));
    return { ok: true, data, contentType, sha256: await sha256Hex(data) };
  }
}
