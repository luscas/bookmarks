import { describe, expect, it } from "vitest";
import { bookmarkIdBatches, selectBookmarks } from "../../src/lib/bookmarks.js";

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
