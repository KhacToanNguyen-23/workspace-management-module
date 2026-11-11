/**
 * A fetcher lists article *metadata* from an external source. It never downloads full text:
 * that is the downloader's job, after a person has picked which records to keep.
 */
export interface FetchQuery {
  query?: string;
  dois?: string[];
  limit: number;
  fromYear?: number;
  toYear?: number;
  oaOnly?: boolean;
}

export interface FetchedRecord {
  source: string;
  externalId: string;
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  license: string | null;
  isOa: boolean;
  oaUrl: string | null;
}

export interface Fetcher {
  readonly id: string;
  readonly label: string;
  search(q: FetchQuery, opts: { contactEmail?: string }): Promise<FetchedRecord[]>;
}

export class FetcherError extends Error {}

export function normalizeDoi(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/10\.\d{4,9}\/\S+/);
  return m ? m[0].replace(/[.,;]+$/, "") : null;
}

export function userAgent(contactEmail?: string) {
  return contactEmail ? `WritingBankModule/0.1 (mailto:${contactEmail})` : "WritingBankModule/0.1";
}
