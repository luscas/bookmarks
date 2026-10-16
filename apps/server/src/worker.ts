import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { createAuth, parseTrustedOrigins } from "./auth.js";
import type { AiJobMessage, Env } from "./env.js";
import { processAiJob } from "./lib/ai-jobs.js";
import type { AppBindings } from "./middleware/session.js";
import { aiRoutes } from "./routes/ai.js";
import { bookmarksRoutes } from "./routes/bookmarks.js";
import { faviconRoutes } from "./routes/favicon.js";
import { importsRoutes } from "./routes/imports.js";
import { meRoutes } from "./routes/me.js";
import { tagsRoutes } from "./routes/tags.js";

function isAllowedOrigin(origin: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? origin.startsWith(pattern.slice(0, -1)) : pattern === origin,
  );
}

export const app = new Hono<AppBindings>();

app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const trusted = parseTrustedOrigins((c as Context<AppBindings>).env.TRUSTED_ORIGINS);
      if (!origin) {
        return "*";
      }
      return isAllowedOrigin(origin, trusted) ? origin : "";
    },
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.route("/api/bookmarks", bookmarksRoutes);
app.route("/api/tags", tagsRoutes);
app.route("/api/imports", importsRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/me", meRoutes);
app.route("/api/favicon", faviconRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { message: "Not found" } }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  if (error instanceof ZodError) {
    return c.json(
      {
        error: {
          message: "Invalid request",
          issues: error.issues.map((issue) => ({
            path: issue.path.map((segment) => String(segment)).join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }
  console.error("Unhandled error", error);
  return c.json({ error: { message: "Internal server error" } }, 500);
});

export type AppType = typeof app;

export const worker = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  async queue(batch: MessageBatch<AiJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await processAiJob(env, message.body);
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, AiJobMessage>;
