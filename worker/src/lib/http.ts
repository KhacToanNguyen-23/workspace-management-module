import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { StatusCode } from "hono/utils/http-status";
import type { ZodTypeAny, output } from "zod";

export function fail(status: StatusCode, message: string, code = "error"): never {
  throw new HTTPException(status, { res: Response.json({ error: { code, message } }, { status }) });
}

export async function body<S extends ZodTypeAny>(c: Context, schema: S): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    fail(400, "Body must be JSON.", "bad_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    fail(422, msg, "validation");
  }
  return parsed.data;
}

export function intParam(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
