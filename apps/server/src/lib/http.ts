import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** A single validation failure, shaped for API consumers. */
export interface FieldIssue {
  path: string;
  message: string;
}

function errorResponse(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: { message, ...extra } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Build an `HTTPException` whose response body is the shared JSON error shape. */
export function apiError(
  status: ContentfulStatusCode,
  message: string,
  extra?: Record<string, unknown>,
): HTTPException {
  return new HTTPException(status, {
    message,
    res: errorResponse(status, message, extra),
  });
}

export function badRequest(message: string, issues?: FieldIssue[]): HTTPException {
  return apiError(400, message, issues ? { issues } : undefined);
}

export function unauthorized(message = "Authentication required"): HTTPException {
  return apiError(401, message);
}

export function forbidden(message = "Forbidden"): HTTPException {
  return apiError(403, message);
}

export function notFound(message = "Not found"): HTTPException {
  return apiError(404, message);
}

export function conflict(message: string): HTTPException {
  return apiError(409, message);
}

export function payloadTooLarge(message: string): HTTPException {
  return apiError(413, message);
}

/**
 * A 429 in the standard error shape, carrying the `Retry-After` header (in
 * seconds) so well-behaved clients know when to come back.
 */
export function tooManyRequests(message: string, retryAfterSeconds: number): HTTPException {
  const status = 429;
  return new HTTPException(status, {
    message,
    res: errorResponse(status, message, undefined, { "retry-after": String(retryAfterSeconds) }),
  });
}
