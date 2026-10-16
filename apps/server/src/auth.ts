import { apiKey } from "@better-auth/api-key";
import { createDb } from "@bookmarks/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import type { Env } from "./env.js";

/** Browser-extension origins are always allowed to talk to the API. */
const EXTENSION_ORIGIN_PATTERN = "chrome-extension://*";

/**
 * Parse the comma-separated `TRUSTED_ORIGINS` variable and always include the
 * extension origin pattern so the Chromium MV3 extension can authenticate.
 */
export function parseTrustedOrigins(value: string | undefined): string[] {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (!origins.includes(EXTENSION_ORIGIN_PATTERN)) {
    origins.push(EXTENSION_ORIGIN_PATTERN);
  }
  return origins;
}

/**
 * Build a Better Auth instance for the current request's environment. Plugins:
 *
 * - `username` lets users sign in with a username and password.
 * - `apiKey` lets the browser extension authenticate with a key. With
 *   `enableSessionForAPIKeys`, `auth.api.getSession` returns a session for a
 *   request carrying the key header, so the rest of the server needs no special
 *   casing. The getter accepts both `x-api-key` and `Authorization: Bearer`.
 */
export function createAuth(env: Env) {
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
