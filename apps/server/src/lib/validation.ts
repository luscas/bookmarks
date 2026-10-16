import { MAX_JSON_BODY_BYTES } from "@bookmarks/shared";
import type { Context } from "hono";
import type { z } from "zod";
import type { AppBindings } from "../middleware/session.js";
import { badRequest, payloadTooLarge } from "./http.js";

/** Turn a Zod error into the API's flat issue list. */
function zodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
}

function bodyTooLarge(maxBytes: number): never {
  throw payloadTooLarge(`Request body exceeds the ${maxBytes}-byte limit`);
}

/**
 * Read a request body as bytes, enforcing `maxBytes` twice:
 *
 * 1. up front, when a numeric `Content-Length` is present, so the body is
 *    never even read;
 * 2. while streaming, reading at most `maxBytes + 1` bytes, so a lying or
 *    missing `Content-Length` cannot bypass the cap.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    bodyTooLarge(maxBytes);
  }

  if (!request.body) {
    return new Uint8Array(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let oversized = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value.length === 0) {
      continue;
    }
    total += value.length;
    if (total > maxBytes) {
      oversized = true;
      break;
    }
    chunks.push(value);
  }
  if (oversized) {
    // Stop the producer instead of draining an oversized body.
    await reader.cancel().catch(() => {});
    bodyTooLarge(maxBytes);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

/**
 * Read and validate a JSON request body, throwing a 400 on invalid JSON and a
 * 413 when the body exceeds `maxBytes` (default 1 MiB). Routes that
 * legitimately accept larger payloads (the HTML import) pass their own cap.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context<AppBindings>,
  schema: S,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<z.output<S>> {
  const buffer = await readCappedBody(c.req.raw, maxBytes);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw badRequest("Invalid request body", zodIssues(result.error));
  }
  return result.data;
}

/**
 * Collapse a query string into an object where repeated keys become arrays,
 * which is what the shared list schemas expect.
 */
export function queryObject(c: Context<AppBindings>): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, values] of Object.entries(c.req.queries())) {
    if (values.length === 1) {
      const first = values[0];
      if (first !== undefined) {
        result[key] = first;
      }
    } else if (values.length > 1) {
      result[key] = values;
    }
  }
  return result;
}

/** Validate the query string, throwing a 400 on failure. */
export function parseQuery<S extends z.ZodTypeAny>(
  c: Context<AppBindings>,
  schema: S,
): z.output<S> {
  const result = schema.safeParse(queryObject(c));
  if (!result.success) {
    throw badRequest("Invalid query parameters", zodIssues(result.error));
  }
  return result.data;
}
