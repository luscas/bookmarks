import { describe, expect, it, vi } from "vitest";

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

import type { AiSettingsRow, Database } from "@bookmarks/db";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { Db } from "../../src/db.js";
import type { Env } from "../../src/env.js";
import type { AppBindings, SessionUser } from "../../src/middleware/session.js";
import { aiRoutes } from "../../src/routes/ai.js";

interface Upsert {
  values: Record<string, unknown>;
  set: Record<string, unknown>;
}

/** Minimal drizzle stand-in: one existing settings row plus captured upserts. */
function createFakeDb(existing: AiSettingsRow | null) {
  const upserts: Upsert[] = [];
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ get: async () => existing }) }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async (config: { set: Record<string, unknown> }) => {
          upserts.push({ values, set: config.set });
        },
      }),
    }),
  };
  return { db: db as unknown as Database, upserts };
}

function createApp(db: unknown): Hono<AppBindings> {
  state.db = db;
  const app = new Hono<AppBindings>();
  app.route("/api/ai", aiRoutes);
  return app;
}

/**
 * Minimal bindings passed to `app.request` as its third argument. Without
 * `NODE_ENV` this is the production-ish path, so dev provisioning never runs
 * and only `isDevelopment(c.env)` ever reads the object.
 */
function createEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides } as Env;
}

function settingsRow(reasoningEffort: AiSettingsRow["reasoningEffort"]): AiSettingsRow {
  return {
    userId: "user_1",
    provider: "openai-compatible",
    model: "qwen3.5:4b",
    baseUrl: null,
    reasoningEffort,
    apiKeyCiphertext: "cipher",
    apiKeyIv: "iv",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("GET /api/ai/settings", () => {
  it("returns the stored reasoningEffort (production-ish: no NODE_ENV)", async () => {
    const { db } = createFakeDb(settingsRow("none"));
    const app = createApp(db);

    const response = await app.request("/api/ai/settings", undefined, createEnv());

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      settings: { reasoningEffort: string | null };
      autoTagByDefault: boolean;
    };
    expect(body.settings.reasoningEffort).toBe("none");
    expect(body.autoTagByDefault).toBe(false);
  });

  it("reports autoTagByDefault in development", async () => {
    const { db } = createFakeDb(settingsRow("none"));
    const app = createApp(db);

    const response = await app.request(
      "/api/ai/settings",
      undefined,
      createEnv({ NODE_ENV: "development" }),
    );

    const body = (await response.json()) as { autoTagByDefault: boolean };
    expect(body.autoTagByDefault).toBe(true);
  });

  it("returns null when the row has no reasoningEffort", async () => {
    const { db } = createFakeDb(settingsRow(null));
    const app = createApp(db);

    const response = await app.request("/api/ai/settings", undefined, createEnv());

    const body = (await response.json()) as { settings: { reasoningEffort: string | null } };
    expect(body.settings.reasoningEffort).toBeNull();
  });
});

describe("PUT /api/ai/settings", () => {
  it("persists a provided reasoningEffort", async () => {
    const { db, upserts } = createFakeDb(null);
    const app = createApp(db);

    const response = await app.request(
      "/api/ai/settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "openai-compatible",
          model: "qwen3.5:4b",
          reasoningEffort: "low",
        }),
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { settings: { reasoningEffort: string | null } };
    expect(body.settings.reasoningEffort).toBe("low");
    expect(upserts[0]?.set.reasoningEffort).toBe("low");
    expect(upserts[0]?.values.reasoningEffort).toBe("low");
  });

  it("clears reasoningEffort when the field is omitted", async () => {
    const { db, upserts } = createFakeDb(settingsRow("high"));
    const app = createApp(db);

    const response = await app.request(
      "/api/ai/settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai-compatible", model: "qwen3.5:4b" }),
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { settings: { reasoningEffort: string | null } };
    expect(body.settings.reasoningEffort).toBeNull();
    expect(upserts[0]?.set.reasoningEffort).toBeNull();
  });

  it("rejects an unknown reasoningEffort", async () => {
    const { db, upserts } = createFakeDb(null);
    const app = createApp(db);

    const response = await app.request(
      "/api/ai/settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "openai-compatible",
          model: "qwen3.5:4b",
          reasoningEffort: "ultra",
        }),
      },
      createEnv(),
    );

    expect(response.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });
});
