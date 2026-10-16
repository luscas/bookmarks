import { describe, expect, it } from "vitest";
import {
  MAX_TAGS_PER_BOOKMARK,
  MIN_TAGS_PER_BOOKMARK,
  buildProposeTaxonomyPrompt,
  buildSuggestTagsPrompt,
} from "./prompts.js";

describe("buildSuggestTagsPrompt", () => {
  it("includes existing tags so the model can reuse them", () => {
    const prompt = buildSuggestTagsPrompt(
      [{ id: "b1", url: "https://example.com", title: "Example" }],
      ["react", "dev/tools"],
    );

    expect(prompt.user).toContain("react");
    expect(prompt.user).toContain("dev/tools");
    expect(prompt.user).toContain("https://example.com");
    expect(prompt.system.toLowerCase()).toContain("reuse");
  });

  it("states the 1-5 tags-per-bookmark limit and the hierarchy separator", () => {
    const prompt = buildSuggestTagsPrompt([], []);

    expect(MIN_TAGS_PER_BOOKMARK).toBe(1);
    expect(MAX_TAGS_PER_BOOKMARK).toBe(5);
    expect(prompt.system).toContain("between 1 and 5 tags per bookmark");
    expect(prompt.system).toContain('"/"');
  });
});

describe("buildProposeTaxonomyPrompt", () => {
  it("includes existing tags and the assignment guidance", () => {
    const prompt = buildProposeTaxonomyPrompt(
      [{ id: "b1", url: "https://example.com" }],
      ["design"],
    );

    expect(prompt.user).toContain("design");
    expect(prompt.system.toLowerCase()).toContain("reuse");
    expect(prompt.system).toContain("assignments");
  });
});
