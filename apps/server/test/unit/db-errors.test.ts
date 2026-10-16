import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "../../src/lib/db-errors.js";

describe("isUniqueViolation", () => {
  it("detects a SQLite UNIQUE constraint error", () => {
    expect(isUniqueViolation(new Error("UNIQUE constraint failed: tags.user_id, tags.slug"))).toBe(
      true,
    );
  });

  it("detects the D1 SQLITE_CONSTRAINT form", () => {
    expect(
      isUniqueViolation(
        new Error("D1_ERROR: UNIQUE constraint failed: tags.slug: SQLITE_CONSTRAINT_UNIQUE"),
      ),
    ).toBe(true);
  });

  it("ignores unrelated errors and non-errors", () => {
    expect(isUniqueViolation(new Error("network failure"))).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
