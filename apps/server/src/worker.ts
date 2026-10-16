import { MAX_AUTH_BODY_BYTES } from "@bookmarks/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { createAuth, isAllowedOrigin, parseTrustedOrigins } from "./auth.js";
import type { AiJobMessage, Env } from "./env.js";
import { processAiJob } from "./lib/ai-jobs.js";
import { SIGN_IN_RATE_LIMIT, SIGN_UP_RATE_LIMIT, ipRateLimit } from "./lib/rate-limit.js";
import { readCappedBody } from "./lib/validation.js";
import { csrfProtection } from "./middleware/csrf.js";
import type { AppBindings } from "./middleware/session.js";
import { aiRoutes } from "./routes/ai.js";
import { bookmarksRoutes } from "./routes/bookmarks.js";
import { faviconRoutes } from "./routes/favicon.js";
import { importsRoutes } from "./routes/imports.js";
import { meRoutes } from "./routes/me.js";
import { tagsRoutes } from "./routes/tags.js";

export const app = new Hono<AppBindings>();

/**
 * Security headers, applied to every response. The CSP is split by audience
 * (see `contentSecurityPolicy` below), so it is set in its own middleware
 * rather than through `secureHeaders`. `X-FrameOptions: DENY` keeps the header
 * agree with the CSP's `frame-ancestors 'none'` (the `SAMEORIGIN` default
 * contradicts it).
 */
app.use("*", secureHeaders({ xFrameOptions: "DENY" }));

/**
 * Content-Security-Policy by response family:
 *
 * - `/api/*` responses carry no documents: lock everything down. JSON clients
 *   (SPA, extension, curl) ignore CSP on non-document responses, so nothing
 *   that consumes the API is affected.
 * - Everything else is the SPA served from `ASSETS`. `script-src` allows only
 *   same-origin bundles plus the inline theme bootstrap in
 *   `apps/web/src/index.html` (hashed below). Favicons load from
 *   `/api/favicon`, which is same-origin, so `img-src 'self'` suffices.
 *
 * `style-src 'unsafe-inline'` is required: Radix UI portals position dialogs
 * via inline `style` attributes, and React inline styles (e.g. the tag color
 * dot) are part of the app's normal rendering.
 */
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const SPA_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'sha256-OrpujmOYMBPFo4vaCa3W5qGPBWsZ3fuMSPxA2leij98='; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "connect-src 'self'; " +
  "font-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'";

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("content-security-policy", c.req.path.startsWith("/api/") ? API_CSP : SPA_CSP);
});

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

// Origin enforcement for state-changing app endpoints. Must run before the
// routers; `/api/auth/*` is excluded (Better Auth origin-checks its routes).
app.use("/api/*", csrfProtection);

// Brute-force throttling for the credential endpoints, per connecting IP.
// Wired before the auth handler; requests without `CF-Connecting-IP` (local
// dev) pass through. The username plugin registers a real password endpoint
// (`/api/auth/sign-in/username`), so it needs the same limit as email.
app.use("/api/auth/sign-in/email", ipRateLimit(SIGN_IN_RATE_LIMIT));
app.use("/api/auth/sign-in/username", ipRateLimit(SIGN_IN_RATE_LIMIT));
app.use("/api/auth/sign-up/email", ipRateLimit(SIGN_UP_RATE_LIMIT));

app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

/** Methods that may carry a body through the `/api/auth/*` size cap. */
const AUTH_BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = createAuth(c.env);
  if (!AUTH_BODY_METHODS.has(c.req.method)) {
    return auth.handler(c.req.raw);
  }
  // Auth payloads are tiny JSON documents; read the body through the shared
  // cap before Better Auth parses it, then hand the handler a reconstructed
  // Request carrying the same URL, method and headers plus the pre-read body.
  const body = await readCappedBody(c.req.raw, MAX_AUTH_BODY_BYTES);
  const headers = new Headers(c.req.raw.headers);
  headers.set("content-length", String(body.byteLength));
  return auth.handler(new Request(c.req.raw.url, { method: c.req.raw.method, headers, body }));
});

app.route("/api/bookmarks", bookmarksRoutes);
app.route("/api/tags", tagsRoutes);
app.route("/api/imports", importsRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/me", meRoutes);
app.route("/api/favicon", faviconRoutes);

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { message: "Not found" } }, 404);
  }
  // Responses returned by a Fetcher binding (ASSETS) are immutable, which
  // would make the response middlewares (secure headers, CSP) throw when they
  // decorate the SPA fallback — re-wrap into a mutable Response.
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(asset.body, asset);
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
