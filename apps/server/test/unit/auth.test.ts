import { API_KEY_RATE_LIMIT_MAX, API_KEY_RATE_LIMIT_WINDOW_MS } from "@bookmarks/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiKeyMock, betterAuthMock } = vi.hoisted(() => ({
  apiKeyMock: vi.fn((options: Record<string, unknown>) => ({ id: "api-key", options })),
  betterAuthMock: vi.fn((options: Record<string, unknown>) => ({ options })),
}));

vi.mock("@better-auth/api-key", () => ({ apiKey: apiKeyMock }));
vi.mock("better-auth", () => ({ betterAuth: betterAuthMock }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: vi.fn(() => ({})) }));
vi.mock("better-auth/plugins", () => ({ username: vi.fn(() => ({})) }));
vi.mock("@bookmarks/db", () => ({ createDb: vi.fn(() => ({})) }));

import { createAuth, isAllowedOrigin, parseTrustedOrigins } from "../../src/auth.js";
import type { Env } from "../../src/env.js";

interface ApiKeyOptions {
  rateLimit?: { enabled?: boolean; maxRequests?: number; timeWindow?: number };
  enableSessionForAPIKeys?: boolean;
  customAPIKeyGetter?: unknown;
}

/** Valid env fixture: only the fields `createAuth` reads. */
function createEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    BETTER_AUTH_SECRET: "s".repeat(44),
    BETTER_AUTH_URL: "http://localhost:8787",
    TRUSTED_ORIGINS: "http://localhost:3000",
    DB: {},
    ...overrides,
  } as unknown as Env;
}

describe("createAuth", () => {
  beforeEach(() => {
    apiKeyMock.mockClear();
  });

  it("throws a friendly error when BETTER_AUTH_SECRET is missing", () => {
    expect(() => createAuth(createEnv({ BETTER_AUTH_SECRET: undefined }))).toThrow(
      /missing or empty[\s\S]*just env[\s\S]*wrangler secret put BETTER_AUTH_SECRET/,
    );
  });

  it("throws a friendly error when BETTER_AUTH_SECRET is empty", () => {
    expect(() => createAuth(createEnv({ BETTER_AUTH_SECRET: "" }))).toThrow(
      /BETTER_AUTH_SECRET is missing or empty/,
    );
  });

  it("throws on a BETTER_AUTH_SECRET shorter than 32 characters", () => {
    expect(() => createAuth(createEnv({ BETTER_AUTH_SECRET: "short" }))).toThrow(
      /BETTER_AUTH_SECRET must be at least 32 characters/,
    );
  });

  it("accepts a 32-character secret", () => {
    expect(() => createAuth(createEnv({ BETTER_AUTH_SECRET: "a".repeat(32) }))).not.toThrow();
  });

  it("configures an extension-friendly API-key rate limit (not the 10/day default)", () => {
    createAuth(createEnv());
    const [options] = apiKeyMock.mock.calls[0] ?? [];
    const rateLimit = (options as ApiKeyOptions | undefined)?.rateLimit;

    expect(rateLimit).toEqual({
      enabled: true,
      maxRequests: API_KEY_RATE_LIMIT_MAX,
      timeWindow: API_KEY_RATE_LIMIT_WINDOW_MS,
    });
    // Guard against regressing to the plugin's 10-requests-per-24h default.
    expect(rateLimit?.maxRequests).toBeGreaterThan(10);
    expect(rateLimit?.timeWindow).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("keeps the custom API-key getter and session bridging", () => {
    createAuth(createEnv());
    const [options] = apiKeyMock.mock.calls[0] ?? [];
    expect((options as ApiKeyOptions | undefined)?.enableSessionForAPIKeys).toBe(true);
    expect((options as ApiKeyOptions | undefined)?.customAPIKeyGetter).toBeTypeOf("function");
  });
});

describe("parseTrustedOrigins", () => {
  it("always appends the extension origin pattern", () => {
    expect(parseTrustedOrigins("http://localhost:3000")).toEqual([
      "http://localhost:3000",
      "chrome-extension://*",
    ]);
  });

  it("does not duplicate the extension origin pattern", () => {
    expect(parseTrustedOrigins("chrome-extension://*")).toEqual(["chrome-extension://*"]);
  });

  it("tolerates an empty value", () => {
    expect(parseTrustedOrigins(undefined)).toEqual(["chrome-extension://*"]);
  });

  it("strips a trailing slash so the typo'd form still matches", () => {
    expect(parseTrustedOrigins("https://app.example.com/")).toEqual([
      "https://app.example.com",
      "chrome-extension://*",
    ]);
  });

  it("normalizes trailing slashes in a multi-origin list", () => {
    expect(parseTrustedOrigins("http://localhost:3000/, https://app.example.com/")).toEqual([
      "http://localhost:3000",
      "https://app.example.com",
      "chrome-extension://*",
    ]);
  });
});

describe("isAllowedOrigin", () => {
  const patterns = ["https://app.example.com", "chrome-extension://*"];

  it("matches a trusted origin exactly", () => {
    expect(isAllowedOrigin("https://app.example.com", patterns)).toBe(true);
    // A sibling subdomain must NOT match.
    expect(isAllowedOrigin("https://evil.example.com", patterns)).toBe(false);
  });

  it("matches extension origins via the wildcard pattern", () => {
    expect(isAllowedOrigin("chrome-extension://abcdefg", patterns)).toBe(true);
  });
});
