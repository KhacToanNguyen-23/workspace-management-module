import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";
import { verifyToken } from "./lib/auth";
import { type Db, type FileStore, d1, r2 } from "./lib/db";
import { adminRoutes } from "./routes/admin";
import { corpusRoutes } from "./routes/corpus";
import { meRoutes } from "./routes/me";
import { workspaceRoutes } from "./routes/workspace";
import { type Directory, DirectoryError, directoryFromEnv } from "./services/directory";
import type { Downloader } from "./services/downloader";
import { resolveUser } from "./services/identity";

/** Everything the app needs that is not plain config; tests replace these. */
export interface AppDeps {
  db?: Db;
  files?: FileStore;
  directory?: Directory;
  downloader?: (maxBytes: number) => Downloader;
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<AppEnv>();

  app.use("/api/*", (c, next) =>
    cors({
      origin: (c.env.CORS_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      allowHeaders: ["authorization", "content-type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    })(c, next),
  );

  app.get("/api/health", (c) => c.json({ ok: true, auth: c.env.AUTH_MODE, directory: c.env.DIRECTORY_MODE }));

  // Every other /api route needs a signed-in, directory-verified @hyperdatalab.org user.
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    c.set("db", deps.db ?? d1(c.env.DB));
    c.set("files", deps.files ?? r2(c.env.FILES));
    c.set("directory", deps.directory ?? directoryFromEnv(c.env));
    const identity = await verifyToken(c.req.header("authorization"), c.env);
    c.set("user", await resolveUser(c.get("db"), c.env, c.get("directory"), identity));
    await next();
  });

  app.route("/api", meRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/api/w/:wid", workspaceRoutes);
  app.route("/api/w/:wid", corpusRoutes(deps.downloader));

  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such route." } }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof DirectoryError) {
      return c.json({ error: { code: "directory_error", message: err.message } }, 502);
    }
    console.error(err);
    return c.json({ error: { code: "internal", message: "Unexpected server error." } }, 500);
  });

  return app;
}
