import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env.js";
import { faviconRoutes } from "../../src/routes/favicon.js";

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
