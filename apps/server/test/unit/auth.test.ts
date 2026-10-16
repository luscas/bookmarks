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

import { createAuth, parseTrustedOrigins } from "../../src/auth.js";

interface ApiKeyOptions {
  rateLimit?: { enabled?: boolean; maxRequests?: number; timeWindow?: number };
  enableSessionForAPIKeys?: boolean;
  customAPIKeyGetter?: unknown;
}

describe("createAuth", () => {
  beforeEach(() => {
    apiKeyMock.mockClear();
  });

  it("configures an extension-friendly API-key rate limit (not the 10/day default)", () => {
    createAuth({} as never);
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
    createAuth({} as never);
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
});
