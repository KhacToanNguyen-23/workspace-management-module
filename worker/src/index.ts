import { createApp } from "./app";
import type { Env } from "./env";
import { d1 } from "./lib/db";
import { directoryFromEnv } from "./services/directory";
import { syncDirectory } from "./services/identity";

const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron trigger (wrangler.toml): nightly Google Directory sync. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (env.DIRECTORY_MODE === "off") return;
    ctx.waitUntil(syncDirectory(d1(env.DB), directoryFromEnv(env), "system:cron").then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
