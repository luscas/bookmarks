import { Hono } from "hono";
import type { Context, Next } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../src/db.js";
import type { AppBindings, SessionUser } from "../../src/middleware/session.js";

const { fakeUser, state } = vi.hoisted(() => ({
  fakeUser: { id: "user_1", email: "ada@example.com", name: "Ada", username: null, image: null },
  state: { db: null as unknown },
}));

vi.mock("../../src/middleware/session.js", () => ({
  sessionMiddleware: async (c: Context<AppBindings>, next: Next) => {
    c.set("db", state.db as Db);
    c.set("user", fakeUser as SessionUser);
    c.set("viaApiKey", false);
    await next();
  },
  requireUser: () => fakeUser as SessionUser,
  requireBrowserSession: () => {},
}));

import { bookmarks, tags } from "@bookmarks/db";
import { meRoutes } from "../../src/routes/me.js";

interface Counts {
  bookmarks: number;
  tags: number;
}

function createFakeDb(counts: Counts) {
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          get: async () => {
            if (table === bookmarks) {
              return { count: counts.bookmarks };
            }
            if (table === tags) {
              return { count: counts.tags };
            }
            throw new Error("unexpected table");
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return db;
}

function createApp(db: unknown): Hono<AppBindings> {
  state.db = db;
  const app = new Hono<AppBindings>();
  app.route("/api/me", meRoutes);
  return app;
}

describe("GET /api/me", () => {
  it("returns the user with bookmark and tag counts", async () => {
    const app = createApp(createFakeDb({ bookmarks: 7, tags: 3 }));

    const response = await app.request("/api/me");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { id: string };
      counts: Counts;
    };
    expect(body.user.id).toBe("user_1");
    expect(body.counts).toEqual({ bookmarks: 7, tags: 3 });
  });
});

describe("PATCH /api/me", () => {
  it("returns the updated user together with counts (same shape as GET)", async () => {
    const app = createApp(createFakeDb({ bookmarks: 2, tags: 5 }));

    const response = await app.request("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Grace" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { name: string };
      counts: Counts;
    };
    expect(body.user.name).toBe("Grace");
    expect(body.counts).toEqual({ bookmarks: 2, tags: 5 });
  });

  it("rejects an empty name", async () => {
    const app = createApp(createFakeDb({ bookmarks: 0, tags: 0 }));

    const response = await app.request("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  " }),
    });

    expect(response.status).toBe(400);
  });
});
