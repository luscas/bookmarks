import type { Database } from "@bookmarks/db";
import { bookmarks, imports } from "@bookmarks/db";
import type { CreateImportInput } from "@bookmarks/shared";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env.js";
import { runImport } from "../../src/lib/imports.js";

/** Only `autoTag: false` paths are exercised, so `env` is never read. */
const env = {} as Env;

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
            return Promise.resolve(undefined);
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

  return { db: db as unknown as Database, inserted, updates };
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
