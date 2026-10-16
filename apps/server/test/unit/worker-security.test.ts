import { MAX_AUTH_BODY_BYTES } from "@bookmarks/shared";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env.js";
import { app } from "../../src/worker.js";
import { createD1Adapter, createMigratedSqlite } from "../helpers/d1.js";

const API_ORIGIN = "http://localhost:8787";

function base64Key(fill: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

/** Full fake bindings: enough for every middleware to run end to end. */
function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: createD1Adapter(createMigratedSqlite()),
    FAVICONS: { get: async () => null },
    AI_QUEUE: { send: async () => undefined },
    ASSETS: {
      fetch: async () =>
        new Response("<!doctype html><html><body>spa</body></html>", {
          headers: { "content-type": "text/html" },
        }),
    },
    BETTER_AUTH_SECRET: "s".repeat(44),
    BETTER_AUTH_URL: API_ORIGIN,
    AI_KEY_ENCRYPTION_SECRET: base64Key(7),
    TRUSTED_ORIGINS: "http://localhost:3000",
    ...overrides,
  } as Env;
}

/** POST to a state-changing endpoint without credentials. */
async function postBookmarks(
  env: Env,
  headers: Record<string, string>,
  url = `${API_ORIGIN}/api/bookmarks`,
): Promise<Response> {
  return app.request(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ url: "https://a.test" }),
    },
    env,
  );
}

describe("CSRF origin enforcement (state-changing /api endpoints)", () => {
  it("lets a request through when Origin matches the configured BETTER_AUTH_URL (401, not 403)", async () => {
    const response = await postBookmarks(createEnv(), { origin: API_ORIGIN });
    expect(response.status).toBe(401);
  });

  it("lets a trusted origin through", async () => {
    const response = await postBookmarks(createEnv(), { origin: "http://localhost:3000" });
    expect(response.status).toBe(401);
  });

  it("lets a chrome-extension origin through", async () => {
    const response = await postBookmarks(createEnv(), { origin: "chrome-extension://abcdefg" });
    expect(response.status).toBe(401);
  });

  it("rejects a foreign origin with 403 and the standard error body", async () => {
    const response = await postBookmarks(createEnv(), { origin: "https://evil.example" });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Cross-origin request rejected");
  });

  it("rejects a spoofed Host whose Origin matches it (own origin comes from BETTER_AUTH_URL)", async () => {
    // An attacker controls both `Host: evil.example` and `Origin:` on their
    // own request. Inside the Worker the Host header is what shapes the
    // request URL, so the spoof is simulated by posting to an evil URL; the
    // own-origin branch must compare against BETTER_AUTH_URL and reject.
    const response = await postBookmarks(
      createEnv(),
      {
        host: "evil.example",
        origin: "https://evil.example",
      },
      "https://evil.example/api/bookmarks",
    );

    expect(response.status).toBe(403);
  });

  it("rejects a request with no Origin header at all", async () => {
    const response = await postBookmarks(createEnv(), {});
    expect(response.status).toBe(403);
  });

  it("rejects Origin: null (string), which browsers send from opaque contexts", async () => {
    const response = await postBookmarks(createEnv(), { origin: "null" });
    expect(response.status).toBe(403);
  });

  it("skips the check for Bearer-authenticated (API key) requests", async () => {
    const response = await postBookmarks(createEnv(), {
      origin: "https://evil.example",
      authorization: "Bearer bmk_live_notarealkey",
    });
    // The origin check is skipped; the request proceeds to authentication.
    expect(response.status).toBe(401);
  });

  it("skips the check for x-api-key-authenticated requests", async () => {
    const response = await postBookmarks(createEnv(), {
      origin: "https://evil.example",
      "x-api-key": "bmk_live_notarealkey",
    });
    expect(response.status).toBe(401);
  });

  it("does not apply to safe methods", async () => {
    const env = createEnv();
    const response = await app.request(
      `${API_ORIGIN}/api/health`,
      { headers: { origin: "https://evil.example" } },
      env,
    );
    expect(response.status).toBe(200);
  });

  it("does not apply to /api/auth/* (Better Auth checks its own origins)", async () => {
    const response = await app.request(
      `${API_ORIGIN}/api/auth/sign-in/email`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.c", password: "password123" }),
      },
      createEnv(),
    );
    // Any non-403 proves the CSRF middleware did not intercept the route.
    expect(response.status).not.toBe(403);
  });
});

describe("credential endpoint rate limits", () => {
  it("429s the 11th sign-in attempt from one IP within 10 minutes", async () => {
    const env = createEnv();
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const response = await app.request(
        `${API_ORIGIN}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.9",
            origin: API_ORIGIN,
          },
          body: JSON.stringify({ email: "a@b.c", password: "password123" }),
        },
        env,
      );
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });

  it("429s the 11th username sign-in attempt from one IP within 10 minutes", async () => {
    const env = createEnv();
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const response = await app.request(
        `${API_ORIGIN}/api/auth/sign-in/username`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.10",
            origin: API_ORIGIN,
          },
          body: JSON.stringify({ username: "alice", password: "password123" }),
        },
        env,
      );
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});

describe("/api/auth/* request body cap", () => {
  it("413s an auth body over 64 KiB before it reaches Better Auth", async () => {
    const response = await app.request(
      `${API_ORIGIN}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(MAX_AUTH_BODY_BYTES + 1),
      },
      createEnv(),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("retry-after")).toBeNull();
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/exceeds/i);
  });

  it("lets a small auth body through to Better Auth (no 413)", async () => {
    const response = await app.request(
      `${API_ORIGIN}/api/auth/sign-in/email`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.c", password: "password123" }),
      },
      createEnv(),
    );

    // Better Auth answers (401 for bad credentials); only the size cap would
    // answer 413.
    expect(response.status).not.toBe(413);
    expect(response.status).not.toBe(500);
  });

  it("passes auth GET requests through untouched", async () => {
    const response = await app.request(`${API_ORIGIN}/api/auth/ok`, {}, createEnv());

    expect(response.status).not.toBe(413);
  });
});

describe("security headers", () => {
  it("gives API responses a locked-down CSP and the secure header set", async () => {
    const response = await app.request(`${API_ORIGIN}/api/health`, {}, createEnv());

    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("gives SPA responses the SPA CSP with the theme-script hash", async () => {
    const response = await app.request(`${API_ORIGIN}/`, {}, createEnv());

    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'sha256-");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("frame-ancestors 'none'");
    // Frame protections must agree: DENY here, `frame-ancestors 'none'` above.
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("serves the SPA (with SPA CSP) for unknown non-API paths", async () => {
    const response = await app.request(`${API_ORIGIN}/some/client/route`, {}, createEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy") ?? "").toContain("default-src 'self'");
  });
});
