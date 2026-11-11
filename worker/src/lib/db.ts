/**
 * Thin database interface so services do not depend on D1 directly.
 * Production uses the D1 adapter; tests use an in-process SQLite adapter (test/sqlite.ts).
 */
export type Param = string | number | null;

export interface Stmt {
  sql: string;
  params: Param[];
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T | null>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  /** Runs all statements in one transaction. */
  batch(stmts: Stmt[]): Promise<void>;
}

export const stmt = (sql: string, ...params: Param[]): Stmt => ({ sql, params });

export function d1(db: D1Database): Db {
  return {
    async all<T>(sql: string, ...params: Param[]) {
      const res = await db.prepare(sql).bind(...params).all<T>();
      return res.results ?? [];
    },
    async first<T>(sql: string, ...params: Param[]) {
      return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
    },
    async run(sql: string, ...params: Param[]) {
      const res = await db.prepare(sql).bind(...params).run();
      return { changes: res.meta?.changes ?? 0 };
    },
    async batch(stmts: Stmt[]) {
      if (stmts.length === 0) return;
      await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params)));
    },
  };
}

/** Binary storage for downloaded files (R2 in production, memory in tests). */
export interface FileStore {
  put(key: string, data: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: ArrayBuffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export function r2(bucket: R2Bucket): FileStore {
  return {
    async put(key, data, contentType) {
      await bucket.put(key, data, { httpMetadata: { contentType } });
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return {
        data: await obj.arrayBuffer(),
        contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
