import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/env.js";
import {
  faviconKeyFor,
  fetchPublicUrl,
  isAllowedIconContentType,
  isPublicHostname,
  resolveFavicon,
  safeUrl,
} from "../../src/lib/favicon.js";

describe("isPublicHostname", () => {
  it.each(["example.com", "sub.example.com", "8.8.8.8", "1.1.1.1", "2606:4700::1111"])(
    "allows the public host %s",
    (host) => {
      expect(isPublicHostname(host)).toBe(true);
    },
  );

  it.each([
    "localhost",
    "localhost.",
    "foo.local",
    "foo.local.",
    "svc.internal",
    "metadata",
    "metadata.google.internal",
    "169.254.169.254",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "192.0.0.1",
    "198.18.0.1",
    "0.0.0.0",
    "2130706433",
    "[::1]",
    "[::]",
    "[::ffff:7f00:1]",
    "[fc00::1]",
    "[fe80::1]",
  ])("blocks the private/metadata host %s", (host) => {
    expect(isPublicHostname(host)).toBe(false);
  });
});

describe("safeUrl", () => {
  it("accepts a public https url", () => {
    expect(safeUrl("https://example.com/x")?.hostname).toBe("example.com");
  });

  it("rejects credentials embedded in the url", () => {
    expect(safeUrl("https://user:pass@example.com/x")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(safeUrl("ftp://example.com/x")).toBeNull();
    expect(safeUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects loopback and metadata hosts", () => {
    expect(safeUrl("http://127.0.0.1/")).toBeNull();
    expect(safeUrl("http://169.254.169.254/latest/meta-data/")).toBeNull();
  });
});

describe("faviconKeyFor", () => {
  it("returns the normalized host for a public url", () => {
    expect(faviconKeyFor("HTTPS://Example.COM./Path")).toBe("example.com");
  });

  it("returns null for the metadata IP", () => {
    expect(faviconKeyFor("http://169.254.169.254/")).toBeNull();
  });

  it("returns null for a non-http scheme", () => {
    expect(faviconKeyFor("ftp://example.com/x")).toBeNull();
  });
});

describe("fetchPublicUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows a redirect to another public host", async () => {
    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      if (String(input) === "https://example.com/favicon.ico") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/icon.png" },
        });
      }
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchPublicUrl("https://example.com/favicon.ico", "image/*");
    expect(response?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://cdn.example/icon.png");
  });

  it("refuses to follow a redirect to the metadata IP", async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchPublicUrl("https://example.com/favicon.ico", "image/*");
    expect(response).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to follow a redirect to localhost", async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Response(null, { status: 302, headers: { location: "http://localhost:8080/admin" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchPublicUrl("https://example.com/favicon.ico", "image/*");
    expect(response).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never fetches an initially-blocked url", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchPublicUrl("http://127.0.0.1/favicon.ico", "image/*");
    expect(response).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up after too many redirects", async () => {
    let hops = 0;
    const fetchMock = vi.fn(async (): Promise<Response> => {
      hops += 1;
      return new Response(null, { status: 302, headers: { location: `/hop-${hops}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchPublicUrl("https://example.com/start", "text/html");
    expect(response).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("isAllowedIconContentType", () => {
  it("allows raster/icon types, with or without parameters", () => {
    for (const type of [
      "image/png",
      "image/x-icon",
      "image/vnd.microsoft.icon",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]) {
      expect(isAllowedIconContentType(type)).toBe(true);
    }
    expect(isAllowedIconContentType("IMAGE/PNG; charset=binary")).toBe(true);
  });

  it("rejects SVG and any other host-controlled type", () => {
    expect(isAllowedIconContentType("image/svg+xml")).toBe(false);
    expect(isAllowedIconContentType("image/svg+xml; charset=utf-8")).toBe(false);
    expect(isAllowedIconContentType("text/html")).toBe(false);
    expect(isAllowedIconContentType("application/octet-stream")).toBe(false);
    expect(isAllowedIconContentType("")).toBe(false);
  });
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

interface StoredObject {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}

function createEnv(stored: StoredObject | null = null) {
  const get = vi.fn(async () => stored);
  const put = vi.fn(async () => undefined);
  return { env: { FAVICONS: { get, put } } as unknown as Env, get, put };
}

/** Host page with no `<link rel="icon">`, plus a favicon.ico with `iconType`. */
function createHostFetch(iconType: string, iconBody: BodyInit): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL): Promise<Response> => {
    const href = typeof input === "string" ? input : input.toString();
    if (href === "https://example.com/") {
      return new Response("<html><head></head></html>", {
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(iconBody, { headers: { "content-type": iconType } });
  });
}

describe("resolveFavicon icon content types", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops a host that declares image/svg+xml and caches nothing", async () => {
    const fetchMock = createHostFetch("image/svg+xml", SVG);
    vi.stubGlobal("fetch", fetchMock);
    const { env, put } = createEnv();

    const icon = await resolveFavicon(env, "example.com");

    expect(icon).toBeNull();
    expect(put).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/favicon.ico",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("normalizes and serves a raster icon", async () => {
    vi.stubGlobal("fetch", createHostFetch("image/png; charset=binary", PNG));
    const { env, put } = createEnv();

    const icon = await resolveFavicon(env, "example.com");

    expect(icon?.contentType).toBe("image/png");
    expect(put).toHaveBeenCalledWith(
      "favicons/example.com",
      expect.anything(),
      expect.objectContaining({ httpMetadata: { contentType: "image/png" } }),
    );
  });

  it("bypasses a cached entry whose stored type is not allowed", async () => {
    const fetchMock = createHostFetch("image/png", PNG);
    vi.stubGlobal("fetch", fetchMock);
    const cached: StoredObject = {
      // `TextEncoder#encode` widens to `ArrayBufferLike`; R2 hands back an `ArrayBuffer`.
      arrayBuffer: async () => new TextEncoder().encode(SVG).buffer as ArrayBuffer,
      httpMetadata: { contentType: "image/svg+xml" },
    };
    const { env } = createEnv(cached);

    const icon = await resolveFavicon(env, "example.com");

    expect(icon?.contentType).toBe("image/png");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("serves a cached raster icon without refetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createEnv({
      arrayBuffer: async () => PNG.buffer,
      httpMetadata: { contentType: "image/x-icon" },
    });

    const icon = await resolveFavicon(env, "example.com");

    expect(icon?.contentType).toBe("image/x-icon");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
