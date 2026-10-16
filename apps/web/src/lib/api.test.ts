import { pageSchema } from "@bookmarks/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiRequest } from "./api";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("sends credentials and returns parsed JSON", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const result = await apiRequest<{ ok: boolean }>("/health");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/health");
    expect(init.credentials).toBe("include");
  });

  it("serializes a JSON body and sets the content type", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ created: true }));

    await apiRequest("/bookmarks", { method: "POST", body: { url: "https://x.test" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ url: "https://x.test" }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("maps a 401 to an unauthorized ApiError with the server message", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "Authentication required" } }, { status: 401 }),
    );

    const error = await apiRequest("/me").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: "Authentication required" });
    expect((error as ApiError).isUnauthorized).toBe(true);
  });

  it("keeps field issues from validation errors", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "Invalid request body",
            issues: [{ path: "url", message: "Required" }],
          },
        },
        { status: 400 },
      ),
    );

    const error = (await apiRequest("/bookmarks", { method: "POST", body: {} }).catch(
      (reason: unknown) => reason,
    )) as ApiError;

    expect(error.issues).toEqual([{ path: "url", message: "Required" }]);
    expect(error.isUnauthorized).toBe(false);
  });

  it("understands the Better Auth flat error shape", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse({ message: "Invalid email or password" }, { status: 401 }),
    );

    const error = (await apiRequest("/auth/sign-in/email", { method: "POST", body: {} }).catch(
      (reason: unknown) => reason,
    )) as ApiError;

    expect(error.message).toBe("Invalid email or password");
    expect(error.isUnauthorized).toBe(true);
  });

  it("falls back to a status message when the body is not JSON", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));

    const error = (await apiRequest("/missing").catch((reason: unknown) => reason)) as ApiError;

    expect(error.status).toBe(404);
    expect(error.isNotFound).toBe(true);
    expect(error.message).toBe("Não encontrado.");
  });

  it("returns undefined for 204 responses", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiRequest("/bookmarks/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("validates responses against a zod schema", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));

    const page = await apiRequest("/bookmarks", { schema: pageSchema });
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it("throws a 502 ApiError when the response does not match the schema", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));

    const error = (await apiRequest("/bookmarks", { schema: pageSchema }).catch(
      (reason: unknown) => reason,
    )) as ApiError;

    expect(error.status).toBe(502);
  });

  it("wraps transport failures in an ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = (await apiRequest("/health").catch((reason: unknown) => reason)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it("builds array query parameters as repeated keys", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));

    await apiRequest("/bookmarks", { query: { tag: ["dev", "react"], sort: "title" } });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/bookmarks?tag=dev&tag=react&sort=title");
  });
});

describe("api.imports", () => {
  const base = {
    id: "i1",
    source: "html",
    total: 0,
    imported: 0,
    skipped: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("parses a failed import and its reason", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          {
            ...base,
            status: "failed",
            finishedAt: "2026-01-01T00:00:01.000Z",
            error: "d1 write failed",
          },
        ],
      }),
    );

    const [item] = await api.imports.list();

    expect(item?.status).toBe("failed");
    expect(item?.error).toBe("d1 write failed");
  });

  it("treats an absent error field as null", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [{ ...base, status: "running", finishedAt: null }] }),
    );

    const [item] = await api.imports.list();

    expect(item?.error).toBeNull();
  });
});
