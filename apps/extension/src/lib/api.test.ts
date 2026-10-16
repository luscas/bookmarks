import type { Bookmark } from "@bookmarks/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiUrl, createApiClient, mapApiError } from "./api";

const settings = { serverUrl: "https://favoritos.exemplo.com/", apiKey: "bk_secret" };

const fetchMock = vi.fn();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function sampleBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "bm_1",
    url: "https://example.com",
    normalizedUrl: "https://example.com/",
    title: "Example",
    description: null,
    notes: null,
    faviconUrl: null,
    source: "manual",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("apiUrl", () => {
  it("joins the server URL with the /api prefix", () => {
    expect(apiUrl("https://favoritos.exemplo.com", "/me")).toBe(
      "https://favoritos.exemplo.com/api/me",
    );
  });

  it("trims trailing slashes and adds a leading slash", () => {
    expect(apiUrl("https://favoritos.exemplo.com/", "bookmarks")).toBe(
      "https://favoritos.exemplo.com/api/bookmarks",
    );
  });

  it("keeps a base path when the server is mounted on a subpath", () => {
    expect(apiUrl("https://exemplo.com/favoritos/", "/me")).toBe(
      "https://exemplo.com/favoritos/api/me",
    );
  });
});

describe("mapApiError", () => {
  it("reads the server error shape and field issues", () => {
    const error = mapApiError(400, {
      error: {
        message: "Invalid request",
        issues: [{ path: "url", message: "Required" }],
      },
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("Invalid request");
    expect(error.issues).toEqual([{ path: "url", message: "Required" }]);
  });

  it("understands the Better Auth flat shape", () => {
    const error = mapApiError(401, { message: "Invalid API key" });
    expect(error.message).toBe("Invalid API key");
    expect(error.isUnauthorized).toBe(true);
  });

  it("falls back to a status message when the body is not usable", () => {
    const error = mapApiError(404, null);
    expect(error.message).toBe("Não encontrado.");
    expect(error.isNotFound).toBe(true);
  });
});

describe("createApiClient", () => {
  it("sends the Bearer token and a JSON body", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ bookmark: sampleBookmark(), created: true }));

    const result = await createApiClient(settings).saveBookmark({
      url: "https://x.test",
      tags: ["dev"],
    });

    expect(result.created).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://favoritos.exemplo.com/api/bookmarks");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer bk_secret");
    expect(init.body).toBe(JSON.stringify({ url: "https://x.test", tags: ["dev"] }));
  });

  it("maps a 401 to an ApiError without leaking the key", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "Authentication required" } }, { status: 401 }),
    );

    const error = (await createApiClient(settings)
      .getMe()
      .catch((reason: unknown) => reason)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Authentication required");
    expect(error.message).not.toContain("bk_secret");
  });

  it("wraps transport failures in an ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = (await createApiClient(settings)
      .getMe()
      .catch((reason: unknown) => reason)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it("surfaces the duplicate signal through `created`", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ bookmark: sampleBookmark(), created: false }));

    const result = await createApiClient(settings).saveBookmark({ url: "https://example.com" });
    expect(result.created).toBe(false);
  });

  it("posts bulk items to /bookmarks/bulk", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ imported: 2, skipped: 1, bookmarkIds: ["a", "b"] }));

    const result = await createApiClient(settings).bulkImport([
      { url: "https://a.test", folderPath: ["Bookmarks Bar", "Dev"] },
      { url: "https://b.test", folderPath: [] },
    ]);

    expect(result).toEqual({ imported: 2, skipped: 1, bookmarkIds: ["a", "b"] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://favoritos.exemplo.com/api/bookmarks/bulk");
    expect(JSON.parse(init.body as string)).toEqual({
      source: "import",
      items: [
        { url: "https://a.test", folderPath: ["Bookmarks Bar", "Dev"] },
        { url: "https://b.test", folderPath: [] },
      ],
    });
  });

  it("rejects a malformed success response", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));

    const error = (await createApiClient(settings)
      .getMe()
      .catch((reason: unknown) => reason)) as ApiError;

    expect(error.status).toBe(502);
  });
});
