import { apiKey } from "@better-auth/api-key";
import { createDb } from "@bookmarks/db";
import { API_KEY_RATE_LIMIT_MAX, API_KEY_RATE_LIMIT_WINDOW_MS } from "@bookmarks/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import type { Env } from "./env.js";

/** Browser-extension origins are always allowed to talk to the API. */
const EXTENSION_ORIGIN_PATTERN = "chrome-extension://*";

/**
 * Match an origin against trusted patterns: an exact string, or a trailing
 * `*` acting as a prefix wildcard. Shared by the CORS and CSRF checks.
 */
export function isAllowedOrigin(origin: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? origin.startsWith(pattern.slice(0, -1)) : pattern === origin,
  );
}

/**
 * Parse the comma-separated `TRUSTED_ORIGINS` variable and always include the
 * extension origin pattern so the Chromium MV3 extension can authenticate.
 * Trailing slashes are stripped at parse time so an operator typo
 * (`https://app.example.com/`) cannot silently break the SPA.
 */
export function parseTrustedOrigins(value: string | undefined): string[] {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
  if (!origins.includes(EXTENSION_ORIGIN_PATTERN)) {
    origins.push(EXTENSION_ORIGIN_PATTERN);
  }
  return origins;
}

/** Minimum length of `BETTER_AUTH_SECRET` (mirrors `lib/crypto.ts` strictness). */
const MIN_SECRET_LENGTH = 32;

/**
 * Build a Better Auth instance for the current request's environment. Plugins:
 *
 * - `username` lets users sign in with a username and password.
 * - `apiKey` lets the browser extension authenticate with a key. With
 *   `enableSessionForAPIKeys`, `auth.api.getSession` returns a session for a
 *   request carrying the key header, so the rest of the server needs no special
 *   casing. The getter accepts both `x-api-key` and `Authorization: Bearer`.
 *
 * The `apiKey` plugin defaults to 10 requests per 24h, which throttles the
 * extension to a handful of saves per day; we raise it to a generous hourly
 * burst (see `API_KEY_RATE_LIMIT_*`, shared with the `apikey` column defaults).
 */
export function createAuth(env: Env) {
  // Better Auth only console-warns about weak secrets; without this guard a
  // missing secret surfaces later as a cryptic `TypeError` from deep inside
  // the library, so fail fast with an actionable message instead.
  const secret: string | undefined = env.BETTER_AUTH_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(
      "BETTER_AUTH_SECRET is missing or empty. Generate one (e.g. `openssl rand -base64 32`), " +
        "then set it locally via `just env` (writes apps/server/.dev.vars) or for deploys via " +
        "`wrangler secret put BETTER_AUTH_SECRET`.",
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length})`,
    );
  }
  const db = createDb(env.DB);
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: parseTrustedOrigins(env.TRUSTED_ORIGINS),
    emailAndPassword: { enabled: true },
    plugins: [
      username({ displayUsername: false }),
      apiKey({
        enableSessionForAPIKeys: true,
        rateLimit: {
          enabled: true,
          maxRequests: API_KEY_RATE_LIMIT_MAX,
          timeWindow: API_KEY_RATE_LIMIT_WINDOW_MS,
        },
        customAPIKeyGetter: (ctx) => {
          const authorization = ctx.headers?.get("authorization");
          if (authorization?.toLowerCase().startsWith("bearer ")) {
            return authorization.slice("bearer ".length).trim() || null;
          }
          return ctx.headers?.get("x-api-key") ?? null;
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
