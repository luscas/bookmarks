import { describe, expect, it } from "vitest";
import { MAX_FOLDER_PATH_DEPTH, MAX_IMPORT_ITEMS, MAX_URL_LENGTH } from "./constants.js";
import { bulkBookmarkItemSchema, bulkBookmarksSchema, createImportSchema } from "./schemas.js";

describe("createImportSchema", () => {
  it("accepts an item list within the cap", () => {
    const result = createImportSchema.safeParse({
      source: "chrome-json",
      items: [{ url: "https://a.test" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more items than the cap", () => {
    const items = Array.from({ length: MAX_IMPORT_ITEMS + 1 }, () => ({ url: "https://a.test" }));
    const result = createImportSchema.safeParse({ source: "chrome-json", items });
    expect(result.success).toBe(false);
  });
});

describe("bulkBookmarkItemSchema", () => {
  it("rejects an over-long URL", () => {
    const result = bulkBookmarkItemSchema.safeParse({
      url: `https://a.test/${"x".repeat(MAX_URL_LENGTH)}`,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a folder path deeper than the cap", () => {
    const result = bulkBookmarkItemSchema.safeParse({
      url: "https://a.test",
      folderPath: Array.from({ length: MAX_FOLDER_PATH_DEPTH + 1 }, () => "d"),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a normal folder path", () => {
    const result = bulkBookmarkItemSchema.safeParse({
      url: "https://a.test",
      folderPath: ["Bookmarks Bar", "Dev"],
    });
    expect(result.success).toBe(true);
  });
});

describe("bulkBookmarksSchema", () => {
  it("keeps the extension's 1000-item bulk cap", () => {
    const items = Array.from({ length: 1001 }, () => ({ url: "https://a.test" }));
    expect(bulkBookmarksSchema.safeParse({ items }).success).toBe(false);
  });
});
