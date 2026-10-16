import { describe, expect, it } from "vitest";
import { chunk } from "../../src/lib/chunk.js";

describe("chunk", () => {
  it("splits an array into fixed-size groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single group when the size exceeds the length", () => {
    expect(chunk(["a", "b"], 10)).toEqual([["a", "b"]]);
  });

  it("returns no groups for an empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow(/greater than zero/);
  });
});
