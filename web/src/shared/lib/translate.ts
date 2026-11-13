import { EN } from "./en";

export type Lang = "vi" | "en";
export type Vars = Record<string, string | number>;

/**
 * Translates an in-app string. Vietnamese is the source language and doubles as the lookup key; a
 * string without an English entry falls back to Vietnamese. `{name}` placeholders are filled from
 * `vars`.
 */
export function translate(lang: Lang, vi: string, vars?: Vars): string {
  const text = lang === "en" ? (EN[vi] ?? vi) : vi;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match: string, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}
