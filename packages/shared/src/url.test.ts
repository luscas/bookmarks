import { describe, expect, it } from "vitest";
import { hostnameOf, normalizeUrl, urlHash } from "./url.js";

describe("normalizeUrl", () => {
  it("adds an https scheme when missing", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
  });

  it("lowercases the host and strips a trailing dot", () => {
    expect(normalizeUrl("HTTPS://Example.COM./Path")).toBe("https://example.com/Path");
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://example.com/a#section")).toBe("https://example.com/a");
  });

  it("removes tracking params and sorts the rest", () => {
    expect(normalizeUrl("https://example.com/?b=2&utm_source=x&a=1&fbclid=abc")).toBe(
      "https://example.com/?a=1&b=2",
    );
  });

  it("removes a trailing slash on non-root paths", () => {
    expect(normalizeUrl("https://example.com/docs/")).toBe("https://example.com/docs");
  });

  it("keeps the root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("removes default ports", () => {
    expect(normalizeUrl("https://example.com:443/x")).toBe("https://example.com/x");
    expect(normalizeUrl("http://example.com:80/x")).toBe("http://example.com/x");
  });

  it("rejects unsupported schemes", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow();
  });

  it("throws on empty input", () => {
    expect(() => normalizeUrl("   ")).toThrow();
  });

  it("is idempotent", () => {
    const once = normalizeUrl("https://Example.com/a/?utm_source=x&b=2&a=1");
    expect(normalizeUrl(once)).toBe(once);
  });
});

describe("urlHash", () => {
  it("is stable for equal normalized urls", async () => {
    const a = await urlHash("https://example.com/x");
    const b = await urlHash("https://example.com/x");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs for different urls", async () => {
    expect(await urlHash("https://example.com/x")).not.toBe(await urlHash("https://example.com/y"));
  });
});

describe("hostnameOf", () => {
  it("extracts a lowercase host", () => {
    expect(hostnameOf("https://Example.com/Path")).toBe("example.com");
  });

  it("returns an empty string on failure", () => {
    expect(hostnameOf("::::")).toBe("");
  });
});
