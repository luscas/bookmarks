import { type Database, rateLimits } from "@bookmarks/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/env.js";
import {
  RATE_LIMIT_PURGE_HORIZON_MS,
  type RateLimitResult,
  consumeRateLimit,
  ipRateLimit,
  windowRetryAfterSeconds,
} from "../../src/lib/rate-limit.js";
import type { AppBindings } from "../../src/middleware/session.js";
import { createD1Adapter, createMigratedSqlite } from "../helpers/d1.js";

/** A real (migrated) SQLite database behind the Drizzle better-sqlite3 driver. */
function createSqliteDb(): Database {
  return drizzle(createMigratedSqlite()) as unknown as Database;
}

/** Number of persisted rows for a limiter key. */
async function rowCount(db: Database, key: string): Promise<number> {
  const rows = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  return rows.length;
}

describe("consumeRateLimit", () => {
  it("allows up to max requests in a window, then denies", async () => {
    const db = createSqliteDb();

    for (let i = 0; i < 3; i += 1) {
      const result = await consumeRateLimit(db, "signin:1.2.3.4", 3, 60_000);
      expect(result.allowed).toBe(true);
    }

    const denied = await consumeRateLimit(db, "signin:1.2.3.4", 3, 60_000);
    expect(denied).toEqual({ allowed: false, remaining: 0 });
  });

  it("counts remaining slots down to zero", async () => {
    const db = createSqliteDb();

    const first = await consumeRateLimit(db, "k", 3, 60_000);
    const second = await consumeRateLimit(db, "k", 3, 60_000);

    expect(first.remaining).toBe(2);
    expect(second.remaining).toBe(1);
  });

  it("resets the counter when the window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const db = createSqliteDb();
      const windowMs = 60_000;

      for (let i = 0; i < 2; i += 1) {
        await consumeRateLimit(db, "k", 2, windowMs);
      }
      expect((await consumeRateLimit(db, "k", 2, windowMs)).allowed).toBe(false);

      // One millisecond into the next window the counter starts over.
      vi.setSystemTime(1_000_000 + windowMs + 1);
      const fresh = await consumeRateLimit(db, "k", 2, windowMs);
      expect(fresh).toEqual({ allowed: true, remaining: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets two concurrent consumes each take a distinct slot", async () => {
    const db = createSqliteDb();

    const [a, b] = (await Promise.all([
      consumeRateLimit(db, "k", 5, 60_000),
      consumeRateLimit(db, "k", 5, 60_000),
    ])) as [RateLimitResult, RateLimitResult];

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    // Two slots gone in some order: {4, 3}.
    expect(new Set([a.remaining, b.remaining])).toEqual(new Set([4, 3]));
  });

  it("never lets the counter exceed max, however often it is called", async () => {
    const db = createSqliteDb();
    let allowed = 0;

    for (let i = 0; i < 12; i += 1) {
      const result = await consumeRateLimit(db, "k", 5, 60_000);
      if (result.allowed) {
        allowed += 1;
      }
    }

    expect(allowed).toBe(5);
  });

  it("keeps keys isolated from each other", async () => {
    const db = createSqliteDb();

    expect((await consumeRateLimit(db, "a", 1, 60_000)).allowed).toBe(true);
    expect((await consumeRateLimit(db, "a", 1, 60_000)).allowed).toBe(false);
    expect((await consumeRateLimit(db, "b", 1, 60_000)).allowed).toBe(true);
  });

  it("purges rows whose window closed more than the purge horizon ago", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    try {
      const db = createSqliteDb();

      await consumeRateLimit(db, "signin:old-ip", 2, 60_000);
      expect(await rowCount(db, "signin:old-ip")).toBe(1);

      // Past the 24 h horizon, a consume for a different key inserts a new
      // row and opportunistically purges the stale one.
      vi.setSystemTime(1_000_000_000 + RATE_LIMIT_PURGE_HORIZON_MS + 60_000);
      await consumeRateLimit(db, "signin:new-ip", 2, 60_000);

      expect(await rowCount(db, "signin:old-ip")).toBe(0);
      expect(await rowCount(db, "signin:new-ip")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps rows whose window is still inside the purge horizon", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    try {
      const db = createSqliteDb();

      await consumeRateLimit(db, "signin:recent-ip", 2, 60_000);

      // Well inside the 24 h horizon: nothing is purged.
      vi.setSystemTime(1_000_000_000 + 60 * 60 * 1000);
      await consumeRateLimit(db, "signin:other-ip", 2, 60_000);

      expect(await rowCount(db, "signin:recent-ip")).toBe(1);
      expect(await rowCount(db, "signin:other-ip")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("windowRetryAfterSeconds", () => {
  it("is the full window at a window boundary", () => {
    expect(windowRetryAfterSeconds(60_000, 300_000)).toBe(60);
  });

  it("is clamped to at least one second", () => {
    expect(windowRetryAfterSeconds(60_000, 359_999)).toBe(1);
  });
});

describe("ipRateLimit middleware", () => {
  function createRateLimitedApp(max = 2): { app: Hono<AppBindings>; env: Env } {
    const env = { DB: createD1Adapter(createMigratedSqlite()) } as unknown as Env;
    const app = new Hono<AppBindings>();
    app.use("*", ipRateLimit({ name: "t", max, windowMs: 60_000 }));
    app.get("/limited", (c) => c.json({ ok: true }));
    return { app, env };
  }

  async function requestWithIp(
    app: Hono<AppBindings>,
    env: Env,
    ip: string | null,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (ip) {
      headers["cf-connecting-ip"] = ip;
    }
    return app.request("http://localhost/limited", { headers }, env);
  }

  it("allows requests under the limit and 429s past it with Retry-After", async () => {
    const { app, env } = createRateLimitedApp();

    const first = await requestWithIp(app, env, "203.0.113.9");
    const second = await requestWithIp(app, env, "203.0.113.9");
    const third = await requestWithIp(app, env, "203.0.113.9");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = (await third.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Too many requests/);
  });

  it("is not applied when the connecting IP is unknown (local dev)", async () => {
    const { app, env } = createRateLimitedApp();

    for (let i = 0; i < 5; i += 1) {
      const response = await requestWithIp(app, env, null);
      expect(response.status).toBe(200);
    }
  });

  it("limits each IP independently", async () => {
    const { app, env } = createRateLimitedApp();

    expect((await requestWithIp(app, env, "203.0.113.1")).status).toBe(200);
    expect((await requestWithIp(app, env, "203.0.113.1")).status).toBe(200);
    expect((await requestWithIp(app, env, "203.0.113.1")).status).toBe(429);
    expect((await requestWithIp(app, env, "203.0.113.2")).status).toBe(200);
  });
});
