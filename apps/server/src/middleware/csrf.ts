import { createMiddleware } from "hono/factory";
import { isAllowedOrigin, parseTrustedOrigins } from "../auth.js";
import { forbidden } from "../lib/http.js";
import type { AppBindings } from "./session.js";

/** Verbs that can change state; everything else (GET/HEAD/OPTIONS) passes. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function requestUsesApiKey(headers: Headers): boolean {
  if (headers.get("x-api-key")) {
    return true;
  }
  const authorization = headers.get("authorization");
  return authorization !== null && /^bearer /i.test(authorization);
}

/**
 * The deployment's own origin, from `BETTER_AUTH_URL`. Deriving it from the
 * request URL would trust the attacker-controllable `Host` header; the
 * configured origin is the only one the SPA is genuinely served from. A
 * missing or unparseable value skips the own-origin branch entirely
 * (`TRUSTED_ORIGINS` still applies).
 */
function configuredOwnOrigin(betterAuthUrl: string | undefined): string | null {
  if (!betterAuthUrl) {
    return null;
  }
  try {
    return new URL(betterAuthUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Origin check for state-changing `/api/*` requests, closing the CSRF hole
 * that `SameSite=Lax` cookies alone leave open (a sibling subdomain can POST
 * with `credentials: "include"` and a no-preflight content type, and the JSON
 * body still parses).
 *
 * Rules for POST/PUT/PATCH/DELETE:
 *
 * - `/api/auth/*` is skipped: Better Auth enforces its own trusted origins.
 * - API-key requests are skipped: keys are sent deliberately by non-browser
 *   clients, so there is no ambient-cookie CSRF surface.
 * - Everything else must send an `Origin` that is (a) listed in
 *   `TRUSTED_ORIGINS` (exact match, or the always-allowed
 *   `chrome-extension://*` pattern for the extension), or (b) exactly the
 *   origin configured in `BETTER_AUTH_URL` — the SPA is served from that
 *   origin (which may differ from the request's `Host`).
 * - Missing or foreign `Origin` → 403 in the standard error shape.
 */
export const csrfProtection = createMiddleware<AppBindings>(async (c, next) => {
  if (!MUTATING_METHODS.has(c.req.method)) {
    return next();
  }
  if (c.req.path.startsWith("/api/auth/")) {
    return next();
  }
  if (requestUsesApiKey(c.req.raw.headers)) {
    return next();
  }

  const origin = c.req.header("origin");
  if (origin) {
    // `parseTrustedOrigins` always appends the `chrome-extension://*` pattern,
    // which `isAllowedOrigin` matches as a prefix, covering both exact
    // TRUSTED_ORIGINS entries and any extension origin.
    if (isAllowedOrigin(origin, parseTrustedOrigins(c.env.TRUSTED_ORIGINS))) {
      return next();
    }
    const own = configuredOwnOrigin(c.env.BETTER_AUTH_URL);
    if (own !== null && origin === own) {
      return next();
    }
  }

  throw forbidden("Cross-origin request rejected");
});
