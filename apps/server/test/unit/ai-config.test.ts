import type { AiSettingsRow, Database } from "@bookmarks/db";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env.js";
import {
  devAiDefaults,
  ensureDevAiSettings,
  getOrProvisionAiSettings,
  isDevelopment,
} from "../../src/lib/ai-config.js";
import { decryptApiKey } from "../../src/lib/crypto.js";

function base64Key(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

const KEY = base64Key(7);

function createEnv(overrides: Partial<Env> = {}): Env {
  return { AI_KEY_ENCRYPTION_SECRET: KEY, ...overrides } as unknown as Env;
}

interface FakeDb {
  db: Database;
  getRow(): AiSettingsRow | null;
}

/**
 * Minimal drizzle stand-in for `ai_settings`: one row addressed by user, with
 * insert-iff-absent semantics matching `onConflictDoNothing` on the `userId` PK.
 */
function createFakeDb(initial: AiSettingsRow | null = null): FakeDb {
  let row = initial;
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ get: async () => row }) }),
    }),
    insert: () => ({
      values: (values: AiSettingsRow) => ({
        onConflictDoNothing: async () => {
          if (row === null) {
            row = values;
          }
        },
      }),
    }),
  };
  return { db: db as unknown as Database, getRow: () => row };
}

const existingRow: AiSettingsRow = {
  userId: "u1",
  provider: "openai-compatible",
  model: "keep-me",
  baseUrl: "https://example.test/v1",
  apiKeyCiphertext: "cipher",
  apiKeyIv: "iv",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("isDevelopment", () => {
  it("is true only for NODE_ENV=development", () => {
    expect(isDevelopment(createEnv({ NODE_ENV: "development" }))).toBe(true);
  });

  it("is false when NODE_ENV is unset or something else (production path)", () => {
    expect(isDevelopment(createEnv())).toBe(false);
    expect(isDevelopment(createEnv({ NODE_ENV: "production" }))).toBe(false);
  });
});

describe("devAiDefaults", () => {
  it("defaults to the local Ollama", () => {
    expect(devAiDefaults(createEnv())).toEqual({
      provider: "openai-compatible",
      model: "qwen3.5:4b",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
    });
  });

  it("lets DEV_AI_* env vars win", () => {
    expect(
      devAiDefaults(
        createEnv({
          DEV_AI_MODEL: "custom:1b",
          DEV_AI_BASE_URL: "http://ollama.test/v1",
          DEV_AI_API_KEY: "secret",
        }),
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "custom:1b",
      baseUrl: "http://ollama.test/v1",
      apiKey: "secret",
    });
  });
});

describe("ensureDevAiSettings", () => {
  it("provisions the dev Ollama when no row exists, encrypting the key", async () => {
    const { db, getRow } = createFakeDb();

    await ensureDevAiSettings(createEnv({ NODE_ENV: "development" }), db, "u1");

    const row = getRow();
    expect(row).not.toBeNull();
    expect(row?.provider).toBe("openai-compatible");
    expect(row?.model).toBe("qwen3.5:4b");
    expect(row?.baseUrl).toBe("http://localhost:11434/v1");
    expect(row?.updatedAt).toBeInstanceOf(Date);
    expect(row?.apiKeyCiphertext).toBeTruthy();
    expect(row?.apiKeyIv).toBeTruthy();

    const decrypted = await decryptApiKey(
      { ciphertext: row?.apiKeyCiphertext as string, iv: row?.apiKeyIv as string },
      KEY,
    );
    expect(decrypted).toBe("ollama");
  });

  it("is a no-op in production", async () => {
    const { db, getRow } = createFakeDb();

    await ensureDevAiSettings(createEnv(), db, "u1");

    expect(getRow()).toBeNull();
  });

  it("does not overwrite an existing row", async () => {
    const { db, getRow } = createFakeDb(existingRow);

    await ensureDevAiSettings(createEnv({ NODE_ENV: "development" }), db, "u1");

    expect(getRow()).toEqual(existingRow);
  });
});

describe("getOrProvisionAiSettings", () => {
  it("returns null in production when nothing is configured", async () => {
    const { db } = createFakeDb();

    await expect(getOrProvisionAiSettings(createEnv(), db, "u1")).resolves.toBeNull();
  });

  it("provisions and returns the dev defaults when none exist", async () => {
    const { db } = createFakeDb();

    const row = await getOrProvisionAiSettings(createEnv({ NODE_ENV: "development" }), db, "u1");

    expect(row?.model).toBe("qwen3.5:4b");
    expect(row?.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("returns the user's existing row untouched", async () => {
    const { db } = createFakeDb(existingRow);

    await expect(
      getOrProvisionAiSettings(createEnv({ NODE_ENV: "development" }), db, "u1"),
    ).resolves.toEqual(existingRow);
  });
});
