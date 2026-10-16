import type { BookmarkRow } from "@bookmarks/db";
import { describe, expect, it } from "vitest";
import {
  bookmarkIdBatches,
  bulkCreateBookmarks,
  createBookmark,
  selectBookmarks,
} from "../../src/lib/bookmarks.js";

/** Minimal Drizzle stand-in that records how many `WHERE` clauses were run. */
function createReadDb(rows: unknown[]): { db: unknown; whereCalls: number } {
  const state = { whereCalls: 0 };
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          state.whereCalls += 1;
          return Promise.resolve(rows);
        },
      }),
    }),
  };
  return {
    db,
    get whereCalls() {
      return state.whereCalls;
    },
  } as unknown as { db: unknown; whereCalls: number };
}

describe("bookmarkIdBatches", () => {
  it("splits ids into parameter-safe batches", () => {
    const ids = Array.from({ length: 1000 }, (_, index) => `bm_${index}`);
    const batches = bookmarkIdBatches(ids);

    expect(batches.length).toBe(20);
    expect(batches.every((batch) => batch.length <= 50)).toBe(true);
    expect(batches.flat()).toEqual(ids);
  });

  it("returns no batches for an empty list", () => {
    expect(bookmarkIdBatches([])).toEqual([]);
  });
});

describe("selectBookmarks with an id list", () => {
  it("issues one statement per batch instead of a single oversized IN (...)", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `bm_${index}`);
    const harness = createReadDb([{ id: "bm_0" }]);

    await selectBookmarks(harness.db as never, { userId: "user_1", bookmarkIds: ids });

    // 120 ids / 50 per query = 3 statements, none of them near D1's 100-param cap.
    expect(harness.whereCalls).toBe(3);
  });

  it("applies the limit to the collected rows", async () => {
    const harness = createReadDb([{ id: "a" }, { id: "b" }, { id: "c" }]);

    const rows = await selectBookmarks(harness.db as never, {
      userId: "user_1",
      bookmarkIds: ["a", "b", "c"],
      limit: 2,
    });

    expect(rows).toHaveLength(2);
  });

  it("short-circuits an empty id list without querying", async () => {
    const harness = createReadDb([]);

    const rows = await selectBookmarks(harness.db as never, { userId: "user_1", bookmarkIds: [] });

    expect(rows).toEqual([]);
    expect(harness.whereCalls).toBe(0);
  });
});

/**
 * Minimal write-side Drizzle stand-in: reads see no existing rows, inserts are
 * recorded. Enough for `createBookmark`/`bulkCreateBookmarks` happy paths.
 */
class EmptyResult extends Promise<unknown[]> {
  /** Drizzle's single-row accessor; nothing pre-exists in this fake. */
  get(): Promise<null> {
    return Promise.resolve(null);
  }
}

function createWriteDb() {
  const inserted: BookmarkRow[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => EmptyResult.resolve([]) }) }),
    insert: () => ({
      values: (rows: BookmarkRow | BookmarkRow[]) => {
        inserted.push(...(Array.isArray(rows) ? rows : [rows]));
        return Promise.resolve(undefined);
      },
    }),
  };
  return { db: db as never, inserted };
}

describe("bookmark URL persistence", () => {
  it("stores the normalized URL on the single-create path, not the raw input", async () => {
    const harness = createWriteDb();

    const { bookmark, created } = await createBookmark(harness.db as never, "user_1", {
      url: "HTTP://Example.com/x",
    });

    expect(created).toBe(true);
    expect(bookmark.url).toBe("http://example.com/x");
    expect(bookmark.url).toBe(bookmark.normalizedUrl);
    expect(harness.inserted).toHaveLength(1);
    expect(harness.inserted[0]?.url).toBe("http://example.com/x");
    expect(harness.inserted[0]?.normalizedUrl).toBe("http://example.com/x");
  });

  it("stores the normalized URL on the bulk path", async () => {
    const harness = createWriteDb();

    const result = await bulkCreateBookmarks(harness.db as never, "user_1", {
      source: "import",
      items: [{ url: "HTTP://Example.com/x" }, { url: "HTTPS://Other.COM/y/" }],
    });

    expect(result.imported).toBe(2);
    expect(harness.inserted.map((row) => row.url)).toEqual([
      "http://example.com/x",
      "https://other.com/y",
    ]);
    for (const row of harness.inserted) {
      // The rendered `url` and the dedupe key are derived from the same value.
      expect(row.url).toBe(row.normalizedUrl);
    }
  });

  it("still skips a smuggled javascript: URL instead of persisting it", async () => {
    const harness = createWriteDb();

    const result = await bulkCreateBookmarks(harness.db as never, "user_1", {
      source: "import",
      items: [{ url: "java\tscript://x%0Aalert(1)" }],
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(harness.inserted).toHaveLength(0);
  });
});
