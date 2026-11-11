import { crossrefFetcher } from "./crossref";
import { openAlexFetcher } from "./openalex";
import type { Fetcher } from "./types";

/** Register new sources here (e.g. the Writing Bank's own SLR source when integrating). */
export const FETCHERS: Record<string, Fetcher> = {
  [openAlexFetcher.id]: openAlexFetcher,
  [crossrefFetcher.id]: crossrefFetcher,
};

export * from "./types";
