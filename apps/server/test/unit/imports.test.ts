import type { Database } from "@bookmarks/db";
import { aiJobs, aiSettings, bookmarks, imports } from "@bookmarks/db";
import type { CreateImportInput } from "@bookmarks/shared";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/env.js";
import { runImport } from "../../src/lib/imports.js";

/** Only `autoTag: false` paths are exercised, so `env` is never read. */
const env = {} as Env;

function base64Key(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

/** Dev env with a valid AES key and a queue that swallows the enqueue. */
function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI_KEY_ENCRYPTION_SECRET: base64Key(7),
    AI_QUEUE: { send: async () => undefined },
    ...overrides,
  } as unknown as Env;
}

const input: CreateImportInput = {
  source: "html",
  items: [{ url: "https://example.com/article" }],
  autoTag: false,
};

interface RecordedUpdate {
  table: unknown;
  set: Record<string, unknown>;
}

interface FakeDbHooks {
  onInsertBookmarks?: () => void;
  onUpdate?: () => void;
}

/**
 * Hand-rolled drizzle stand-in. `runImport` only needs: an `imports` insert, a
 * `bookmarks` select, a `bookmarks` insert (via `bulkCreateBookmarks`) and an
 * `imports` update; anything else throws so an unexpected call is loud.
 */
function createFakeDb(hooks: FakeDbHooks = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const updates: RecordedUpdate[] = [];
  const bookmarkInserts: unknown[] = [];
  const aiSettingsInserts: Array<Record<string, unknown>> = [];
  const aiJobInserts: Array<Record<string, unknown>> = [];

  const db = {
    insert(table: unknown) {
      return {
        values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
          if (table === imports) {
            inserted.push(values as Record<string, unknown>);
            return Promise.resolve(undefined);
          }
          if (table === bookmarks) {
            hooks.onInsertBookmarks?.();
            bookmarkInserts.push(values);
            return Promise.resolve(undefined);
          }
          if (table === aiJobs) {
            aiJobInserts.push(values as Record<string, unknown>);
            return Promise.resolve(undefined);
          }
          if (table === aiSettings) {
            aiSettingsInserts.push(values as Record<string, unknown>);
            return { onConflictDoNothing: async () => undefined };
          }
          throw new Error("unexpected insert target");
        },
      };
    },
    update(table: unknown) {
      return {
        set: (set: Record<string, unknown>) => {
          hooks.onUpdate?.();
          updates.push({ table, set });
          return { where: () => Promise.resolve(undefined) };
        },
      };
    },
    select() {
      return { from: () => ({ where: () => Promise.resolve([]) }) };
    },
  };

  return {
    db: db as unknown as Database,
    inserted,
    updates,
    bookmarkInserts,
    aiSettingsInserts,
    aiJobInserts,
  };
}

function failedUpdate(updates: RecordedUpdate[]): RecordedUpdate | undefined {
  return updates.find((update) => update.set.status === "failed");
}

describe("runImport failure handling", () => {
  it("marks the import failed with the reason instead of leaving it running", async () => {
    const boom = new Error("d1 write failed");
    const { db, inserted, updates } = createFakeDb({
      onInsertBookmarks: () => {
        throw boom;
      },
    });

    await expect(runImport(env, db, "u1", input)).rejects.toBe(boom);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.status).toBe("running");

    const failed = failedUpdate(updates);
    expect(failed?.table).toBe(imports);
    expect(failed?.set.error).toBe("d1 write failed");
    expect(failed?.set.finishedAt).toBeInstanceOf(Date);
    expect(updates.some((update) => update.set.status === "done")).toBe(false);
  });

  it("truncates an overlong failure reason", async () => {
    const { db, updates } = createFakeDb({
      onInsertBookmarks: () => {
        throw new Error("x".repeat(900));
      },
    });

    await expect(runImport(env, db, "u1", input)).rejects.toThrow();

    expect((failedUpdate(updates)?.set.error as string).length).toBe(500);
  });

  it("still rethrows the original error when recording the failure itself fails", async () => {
    const boom = new Error("insert failed");
    const { db } = createFakeDb({
      onInsertBookmarks: () => {
        throw boom;
      },
      onUpdate: () => {
        throw new Error("update failed");
      },
    });

    await expect(runImport(env, db, "u1", input)).rejects.toBe(boom);
  });

  it("records a successful run as done", async () => {
    const { db, updates } = createFakeDb();

    const summary = await runImport(env, db, "u1", input);

    expect(summary.status).toBe("done");
    expect(summary.error).toBeNull();
    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.finishedAt).not.toBeNull();

    const done = updates.find((update) => update.set.status === "done");
    expect(done?.table).toBe(imports);
    expect(done?.set.total).toBe(1);
    expect(done?.set.imported).toBe(1);
    expect(updates.some((update) => update.set.status === "failed")).toBe(false);
  });
});

describe("runImport autoTag default", () => {
  const devEnv = () => createEnv({ NODE_ENV: "development" });

  function omittedInput(): CreateImportInput {
    return { source: "html", items: [{ url: "https://example.com/article" }] };
  }

  it("provisions dev settings and enqueues tagging when autoTag is omitted in development", async () => {
    const { db, bookmarkInserts, aiSettingsInserts, aiJobInserts } = createFakeDb();

    const summary = await runImport(devEnv(), db, "u1", omittedInput());

    expect(summary.imported).toBe(1);
    expect(aiSettingsInserts).toHaveLength(1);
    expect(aiJobInserts).toHaveLength(1);
    expect(aiJobInserts[0]?.type).toBe("tag_bookmarks");

    const payload = JSON.parse(aiJobInserts[0]?.payload as string) as { bookmarkIds: string[] };
    const importedIds = (bookmarkInserts[0] as Array<{ id: string }>).map((row) => row.id);
    expect(payload.bookmarkIds).toEqual(importedIds);
  });

  it("does nothing in production when autoTag is omitted", async () => {
    const { db, aiSettingsInserts, aiJobInserts } = createFakeDb();

    const summary = await runImport(createEnv(), db, "u1", omittedInput());

    expect(summary.imported).toBe(1);
    expect(aiSettingsInserts).toHaveLength(0);
    expect(aiJobInserts).toHaveLength(0);
  });

  it("honours an explicit autoTag:false in development", async () => {
    const { db, aiSettingsInserts, aiJobInserts } = createFakeDb();

    await runImport(devEnv(), db, "u1", { ...omittedInput(), autoTag: false });

    expect(aiSettingsInserts).toHaveLength(0);
    expect(aiJobInserts).toHaveLength(0);
  });

  it("keeps the import done when the dev AI setup fails (missing encryption secret)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { db, bookmarkInserts, aiSettingsInserts, aiJobInserts, updates } = createFakeDb();
      const brokenEnv = createEnv({
        NODE_ENV: "development",
        AI_KEY_ENCRYPTION_SECRET: undefined,
      });

      const summary = await runImport(brokenEnv, db, "u1", omittedInput());

      // The bookmarks were persisted, so the run is a success: no `failed`
      // rewrite, no rethrow, and the AI job is simply not enqueued.
      expect(summary.status).toBe("done");
      expect(summary.imported).toBe(1);
      expect(summary.error).toBeNull();
      expect(bookmarkInserts).toHaveLength(1);
      expect(aiSettingsInserts).toHaveLength(0);
      expect(aiJobInserts).toHaveLength(0);
      expect(updates.some((update) => update.set.status === "failed")).toBe(false);
      expect(errorSpy).toHaveBeenCalledOnce();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
