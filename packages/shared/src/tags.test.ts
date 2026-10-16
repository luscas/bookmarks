import { describe, expect, it } from "vitest";
import { isHierarchicalTag, normalizeTagName, slugifyTag, tagAncestors } from "./tags.js";

describe("normalizeTagName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeTagName("  Web   Design ")).toBe("Web Design");
  });
});

describe("slugifyTag", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyTag("Web Design")).toBe("web-design");
  });

  it("strips diacritics", () => {
    expect(slugifyTag("Programação")).toBe("programacao");
  });

  it("preserves hierarchy slashes", () => {
    expect(slugifyTag("Dev / React")).toBe("dev/react");
  });

  it("is stable for already-slug input", () => {
    expect(slugifyTag("dev/react")).toBe("dev/react");
  });

  it("falls back to a stable, non-empty slug for non-Latin names", () => {
    const slug = slugifyTag("\u6771\u4EAC"); // 東京
    expect(slug).not.toBe("");
    expect(slug).toBe(encodeURIComponent("\u6771\u4EAC"));
    expect(slugifyTag("\u6771\u4EAC")).toBe(slug);
    expect(slugifyTag("\u5927\u962A")).not.toBe(slug); // 大阪
  });

  it("keeps hierarchy when a segment is non-Latin", () => {
    expect(slugifyTag("Dev / \u6771\u4EAC")).toBe(`dev/${encodeURIComponent("\u6771\u4EAC")}`);
  });

  it("still collapses a separator-only name to an empty slug", () => {
    expect(slugifyTag(" / ")).toBe("");
  });
});

describe("isHierarchicalTag", () => {
  it("detects the separator", () => {
    expect(isHierarchicalTag("dev/react")).toBe(true);
    expect(isHierarchicalTag("react")).toBe(false);
  });
});

describe("tagAncestors", () => {
  it("returns every ancestor level", () => {
    expect(tagAncestors("Dev/React/Hooks")).toEqual(["Dev", "Dev/React", "Dev/React/Hooks"]);
  });

  it("handles a flat tag", () => {
    expect(tagAncestors("React")).toEqual(["React"]);
  });
});
