import { describe, expect, it } from "vitest";
import { buildFtsQuery } from "../../src/lib/fts.js";

describe("buildFtsQuery", () => {
  it("quotes each term and joins with spaces (implicit AND)", () => {
    expect(buildFtsQuery("hello world")).toBe('"hello" "world"');
  });

  it("collapses whitespace", () => {
    expect(buildFtsQuery("  spaced   out  ")).toBe('"spaced" "out"');
  });

  it("removes quotes that would break the MATCH expression", () => {
    expect(buildFtsQuery('say "hi"')).toBe('"say" "hi"');
  });

  it("returns an empty string when nothing is usable", () => {
    expect(buildFtsQuery("   ")).toBe("");
  });

  it("strips NUL and other control characters that break FTS5 MATCH", () => {
    expect(buildFtsQuery("hello\u0000world")).toBe('"hello" "world"');
    expect(buildFtsQuery("\u0000")).toBe("");
    expect(buildFtsQuery("a\u0007b\u001fc")).toBe('"a" "b" "c"');
  });
});
