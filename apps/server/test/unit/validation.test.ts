import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readCappedBody } from "../../src/lib/validation.js";
import { parseJsonBody } from "../../src/lib/validation.js";
import type { AppBindings } from "../../src/middleware/session.js";

/** Mini app so `parseJsonBody` runs against a real Hono context. */
const app = new Hono<AppBindings>();
app.post("/json", async (c) => {
  const parsed = await parseJsonBody(c, z.object({ url: z.string() }), 16);
  return c.json(parsed);
});

/** RequestInit extended with `duplex`, which workers-types does not declare. */
type NodeRequestInit = RequestInit & { duplex?: "half" };

function jsonRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
  const init: NodeRequestInit = {
    method: "POST",
    body,
    // Required by undici when the body is a stream; also keeps a manually
    // provided content-length header intact, which is what the tests need.
    duplex: "half",
    headers: { "content-type": "application/json", ...headers },
  };
  return new Request("http://localhost/json", init as RequestInit);
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("parseJsonBody byte cap", () => {
  it("rejects an oversized Content-Length with 413 before reading the body", async () => {
    // The body never produces a chunk: if the cap ran after (or instead of)
    // the Content-Length check, this request would hang until timeout.
    const hanging = new ReadableStream({ start() {} });
    const response = await app.request(jsonRequest(hanging, { "content-length": "999999999" }));

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/exceeds/i);
  });

  it("rejects a lying Content-Length by capping the actual stream", async () => {
    // Declared as 3 bytes, actually 64 KiB: the reader loop must catch it.
    const response = await app.request(
      jsonRequest(streamOf("x".repeat(64 * 1024)), { "content-length": "3" }),
    );

    expect(response.status).toBe(413);
  });

  it("parses a body exactly at the cap", async () => {
    // `{"url":"a"}` is 11 bytes, one under the 16-byte cap used above.
    const response = await app.request(jsonRequest('{"url":"a"}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "a" });
  });

  it("rejects a body over the cap (18 bytes against a 16-byte cap)", async () => {
    const response = await app.request(jsonRequest('{"url":"xxxxxxx"}'));

    expect(response.status).toBe(413);
  });

  it("keeps returning 400 for invalid JSON", async () => {
    const response = await app.request(jsonRequest("not json"));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Request body must be valid JSON");
  });

  it("keeps returning 400 with issues for schema violations", async () => {
    const response = await app.request(jsonRequest("{}"));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { issues: unknown[] } };
    expect(body.error.issues).toHaveLength(1);
  });
});

describe("readCappedBody", () => {
  function streamRequest(chunks: string[], headers: Record<string, string> = {}): Request {
    const init: NodeRequestInit = {
      method: "POST",
      body: streamOf(...chunks),
      duplex: "half",
      headers,
    };
    return new Request("http://localhost/x", init as RequestInit);
  }

  it("returns the exact bytes of an in-cap body without a Content-Length", async () => {
    const request = streamRequest(['{"a"', ":1}"]);
    // No content-length header at all: the stream cap is the only guard.
    expect(request.headers.get("content-length")).toBeNull();

    const bytes = await readCappedBody(request, 1024);

    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
  });

  it("rejects an over-cap stream with no Content-Length (missing header case)", async () => {
    const request = streamRequest(["x".repeat(2048)]);

    await expect(readCappedBody(request, 1024)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("treats a non-numeric Content-Length as absent and relies on the stream cap", async () => {
    const request = streamRequest(["{}"], { "content-length": "not-a-number" });

    const bytes = await readCappedBody(request, 8);
    expect(new TextDecoder().decode(bytes)).toBe("{}");
  });

  it("returns an empty buffer for a bodyless request", async () => {
    const request = new Request("http://localhost/x", { method: "POST" });
    expect(await readCappedBody(request, 8)).toEqual(new Uint8Array(0));
  });
});
