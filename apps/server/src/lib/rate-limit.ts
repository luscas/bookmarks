import { type Database, rateLimits } from "@bookmarks/db";
import { and, eq, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getDb } from "../db.js";
import type { AppBindings } from "../middleware/session.js";
import { tooManyRequests } from "./http.js";

/**
 * Fixed-window rate limiting backed by D1, so every Worker isolate sees the
 * same counters. Better Auth's built-in limiter keeps state in memory, which
 * resets per isolate and lets a distributed brute force run unthrottled.
 *
 * Concurrency follows the apikey plugin's guarded compare-and-swap pattern:
 * every mutation is a single guarded `UPDATE`, and a request that loses a race
 * retries against the winner's row instead of overwriting it.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Slots left in the current window; `0` once the window is exhausted. */
  remaining: number;
}

export interface RateLimitConfig {
  /** Prefix of the counter key; the caller IP is appended. */
  name: string;
  max: number;
  windowMs: number;
}

/** Attempts before a perpetually losing compare-and-swap gives up (denies). */
const CAS_ATTEMPTS = 3;

/**
 * How long a row may outlive its window before it is purged (24 h). Keys are
 * `name:IP`, so IPv6 rotation can otherwise inflate the table silently.
 */
export const RATE_LIMIT_PURGE_HORIZON_MS = 24 * 60 * 60 * 1000;

/**
 * Opportunistically delete rows whose window closed more than
 * `RATE_LIMIT_PURGE_HORIZON_MS` ago. Deliberately unindexed: the table stays
 * small (bounded by recent IPs) because every purge trims it to the horizon,
 * and a tiny full scan is cheaper than maintaining an index on every write.
 */
async function purgeExpiredRows(db: Database, now: number): Promise<void> {
  await db
    .delete(rateLimits)
    .where(sql`${rateLimits.windowStart} < ${now - RATE_LIMIT_PURGE_HORIZON_MS}`);
}

/**
 * Consume one slot from the fixed window identified by `key`. The window is
 * aligned to epoch time (`floor(now / windowMs)`), so `Retry-After` can be
 * derived from the window boundary.
 */
export async function consumeRateLimit(
  db: Database,
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    // Fast path: guarded in-window increment. SQLite evaluates the
    // `count < max` predicate atomically with the increment, so concurrent
    // requests can never push the counter past `max`.
    const incremented = await db
      .update(rateLimits)
      .set({ count: sql`${rateLimits.count} + 1` })
      .where(
        and(
          eq(rateLimits.key, key),
          eq(rateLimits.windowStart, windowStart),
          sql`${rateLimits.count} < ${max}`,
        ),
      )
      .returning({ count: rateLimits.count });
    const hit = incremented[0];
    if (hit) {
      return { allowed: true, remaining: Math.max(0, max - hit.count) };
    }

    // No row, an expired window, or a full window: read and disambiguate.
    const row = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
    if (!row) {
      // First hit in this window. `ON CONFLICT DO NOTHING` makes exactly one
      // concurrent insert win; losers retry against the winner's row.
      const inserted = await db
        .insert(rateLimits)
        .values({ key, count: 1, windowStart })
        .onConflictDoNothing()
        .returning({ count: rateLimits.count });
      if (inserted[0]) {
        await purgeExpiredRows(db, now);
        return { allowed: true, remaining: max - 1 };
      }
      continue;
    }
    if (row.windowStart === windowStart) {
      // Row is current and the guarded increment missed: the window is full.
      return { allowed: false, remaining: 0 };
    }
    // Expired window: reset, guarded on the observed `windowStart` so exactly
    // one concurrent request wins the reset; losers retry the increment.
    const reset = await db
      .update(rateLimits)
      .set({ count: 1, windowStart })
      .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, row.windowStart)))
      .returning({ count: rateLimits.count });
    if (reset[0]) {
      await purgeExpiredRows(db, now);
      return { allowed: true, remaining: max - 1 };
    }
  }

  // Still racing after several attempts: fail closed. A key hot enough to lose
  // every compare-and-swap is itself abnormal traffic.
  return { allowed: false, remaining: 0 };
}

/** Seconds until the current window resets, for the `Retry-After` header. */
export function windowRetryAfterSeconds(windowMs: number, now = Date.now()): number {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
}

/** 10 sign-in attempts per 10 minutes per IP. */
export const SIGN_IN_RATE_LIMIT: RateLimitConfig = {
  name: "signin",
  max: 10,
  windowMs: 10 * 60 * 1000,
};

/** 5 sign-up attempts per hour per IP. */
export const SIGN_UP_RATE_LIMIT: RateLimitConfig = {
  name: "signup",
  max: 5,
  windowMs: 60 * 60 * 1000,
};

/** 60 favicon proxy lookups per minute per IP. */
export const FAVICON_RATE_LIMIT: RateLimitConfig = {
  name: "favicon",
  max: 60,
  windowMs: 60 * 1000,
};

/**
 * Resolve the request's Drizzle client: reuse the one a router middleware
 * already created, or build one (the auth endpoints run before
 * `sessionMiddleware`, which is where `db` is normally set).
 */
function requestDb(c: { env: AppBindings["Bindings"]; get: (key: "db") => Database }): Database {
  const existing = c.get("db");
  if (existing) {
    return existing;
  }
  return getDb(c.env);
}

/**
 * Per-IP fixed-window rate limit keyed on `CF-Connecting-IP`. Requests
 * without the header (local dev, non-Cloudflare hosting) are allowed through:
 * there is no stable identity to limit on.
 */
export function ipRateLimit(config: RateLimitConfig) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const ip = c.req.header("cf-connecting-ip");
    if (!ip) {
      await next();
      return;
    }
    const { allowed } = await consumeRateLimit(
      requestDb(c),
      `${config.name}:${ip}`,
      config.max,
      config.windowMs,
    );
    if (!allowed) {
      const retryAfter = windowRetryAfterSeconds(config.windowMs);
      throw tooManyRequests(`Too many requests; retry in ${retryAfter} seconds`, retryAfter);
    }
    await next();
  });
}
