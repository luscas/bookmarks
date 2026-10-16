import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env.js";
import { FAVICON_RATE_LIMIT } from "../../src/lib/rate-limit.js";
import { faviconRoutes } from "../../src/routes/favicon.js";
import { createD1Adapter, createMigratedSqlite } from "../helpers/d1.js";

function createEnv(object: unknown): Env {
  return { FAVICONS: { get: async () => object } } as unknown as Env;
}

describe("GET /api/favicon/:key", () => {
  it("serves a raster icon with nosniff", async () => {
    const env = createEnv({
      arrayBuffer: async () => new Uint8Array([0x89, 0x50]).buffer,
      httpMetadata: { contentType: "image/png" },
    });

    const response = await faviconRoutes.request("http://localhost/example.com", {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("never echoes a stored image/svg+xml type", async () => {
    const env = createEnv({
      arrayBuffer: async () => new TextEncoder().encode("<svg onload='alert(1)'></svg>").buffer,
      httpMetadata: { contentType: "image/svg+xml" },
    });

    const response = await faviconRoutes.request("http://localhost/example.com", {}, env);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type") ?? "").not.toContain("svg");
  });

  it("returns 404 (never 500) when the R2 read fails", async () => {
    const env = {
      FAVICONS: {
        get: async () => {
          throw new Error("r2 unavailable");
        },
      },
    } as unknown as Env;

    const response = await faviconRoutes.request("http://localhost/example.com", {}, env);

    expect(response.status).toBe(404);
  });
});

describe("GET /api/favicon?url= rate limit", () => {
  function rateLimitEnv(): Env {
    return {
      // A cached icon makes every allowed lookup a cache hit: no network.
      FAVICONS: {
        get: async () => ({
          arrayBuffer: async () => new Uint8Array([0x89, 0x50]).buffer,
          httpMetadata: { contentType: "image/png" },
        }),
      },
      DB: createD1Adapter(createMigratedSqlite()),
    } as unknown as Env;
  }

  async function proxyRequest(env: Env, ip: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (ip) {
      headers["cf-connecting-ip"] = ip;
    }
    return faviconRoutes.request(
      `http://localhost/?url=${encodeURIComponent("https://cache-miss.example.com/x")}`,
      { headers },
      env,
    );
  }

  it("429s the 61st lookup from one IP within a minute, with Retry-After", async () => {
    const env = rateLimitEnv();
    const ip = "203.0.113.9";

    for (let i = 0; i < FAVICON_RATE_LIMIT.max; i += 1) {
      const response = await proxyRequest(env, ip);
      expect(response.status).toBe(200);
    }

    const blocked = await proxyRequest(env, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);

    // Another IP is unaffected, and no-IP (local dev) requests are unlimited.
    expect((await proxyRequest(env, "198.51.100.7")).status).toBe(200);
    expect((await proxyRequest(env, null)).status).toBe(200);
  });
});
