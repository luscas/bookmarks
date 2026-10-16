import { describe, expect, it } from "vitest";
import {
  MAX_AI_API_KEY_LENGTH,
  MAX_CURSOR_LENGTH,
  MAX_FOLDER_PATH_DEPTH,
  MAX_IMPORT_HTML_BYTES,
  MAX_IMPORT_ITEMS,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_URL_LENGTH,
} from "./constants.js";
import {
  aiSettingsInputSchema,
  bulkBookmarkItemSchema,
  bulkBookmarksSchema,
  createImportSchema,
  listBookmarksQuerySchema,
} from "./schemas.js";

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

  it("leaves autoTag absent by default so the server can decide", () => {
    const result = createImportSchema.parse({
      source: "chrome-json",
      items: [{ url: "https://a.test" }],
    });
    expect(result.autoTag).toBeUndefined();
    expect("autoTag" in result).toBe(false);
  });

  it("keeps an explicit autoTag value", () => {
    const on = createImportSchema.parse({
      source: "chrome-json",
      items: [{ url: "https://a.test" }],
      autoTag: true,
    });
    expect(on.autoTag).toBe(true);

    const off = createImportSchema.parse({
      source: "chrome-json",
      items: [{ url: "https://a.test" }],
      autoTag: false,
    });
    expect(off.autoTag).toBe(false);
  });

  it("rejects HTML larger than the import cap (cheap pre-filter)", () => {
    const result = createImportSchema.safeParse({
      source: "html",
      html: "x".repeat(MAX_IMPORT_HTML_BYTES + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts HTML exactly at the import cap", () => {
    const result = createImportSchema.safeParse({
      source: "html",
      html: "x".repeat(MAX_IMPORT_HTML_BYTES),
    });
    expect(result.success).toBe(true);
  });
});

describe("listBookmarksQuerySchema length caps", () => {
  it("rejects an over-long search query", () => {
    const result = listBookmarksQuerySchema.safeParse({
      q: "x".repeat(MAX_SEARCH_QUERY_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a search query exactly at the cap", () => {
    const result = listBookmarksQuerySchema.safeParse({ q: "x".repeat(MAX_SEARCH_QUERY_LENGTH) });
    expect(result.success).toBe(true);
  });

  it("rejects an over-long cursor", () => {
    const result = listBookmarksQuerySchema.safeParse({
      cursor: "x".repeat(MAX_CURSOR_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a cursor exactly at the cap", () => {
    const result = listBookmarksQuerySchema.safeParse({ cursor: "x".repeat(MAX_CURSOR_LENGTH) });
    expect(result.success).toBe(true);
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

describe("aiSettingsInputSchema reasoningEffort", () => {
  const base = { provider: "openai-compatible", model: "gpt-4o-mini" } as const;

  it("accepts each configured effort value", () => {
    for (const effort of ["none", "low", "medium", "high"] as const) {
      const parsed = aiSettingsInputSchema.parse({ ...base, reasoningEffort: effort });
      expect(parsed.reasoningEffort).toBe(effort);
    }
  });

  it("accepts an explicit null and an omitted value", () => {
    expect(
      aiSettingsInputSchema.parse({ ...base, reasoningEffort: null }).reasoningEffort,
    ).toBeNull();
    expect("reasoningEffort" in aiSettingsInputSchema.parse(base)).toBe(false);
  });

  it("rejects an unknown effort value", () => {
    expect(aiSettingsInputSchema.safeParse({ ...base, reasoningEffort: "ultra" }).success).toBe(
      false,
    );
  });

  it("rejects an over-long provider API key", () => {
    const result = aiSettingsInputSchema.safeParse({
      ...base,
      apiKey: "k".repeat(MAX_AI_API_KEY_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a provider API key exactly at the cap", () => {
    const result = aiSettingsInputSchema.safeParse({
      ...base,
      apiKey: "k".repeat(MAX_AI_API_KEY_LENGTH),
    });
    expect(result.success).toBe(true);
  });
});
