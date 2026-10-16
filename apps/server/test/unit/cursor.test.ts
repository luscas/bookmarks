import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/lib/cursor.js";

describe("cursor", () => {
  it("round-trips numeric sort values", () => {
    const encoded = encodeCursor({ v: 1_700_000_000_000, id: "018f" });
    expect(decodeCursor(encoded)).toEqual({ v: 1_700_000_000_000, id: "018f" });
  });

  it("round-trips unicode titles", () => {
    const encoded = encodeCursor({ v: "Café ☕", id: "id-1" });
    expect(decodeCursor(encoded)).toEqual({ v: "Café ☕", id: "id-1" });
  });

  it("returns null for malformed cursors", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ id: 1 })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ v: 1 })))).toBeNull();
  });
});
