import type { Context } from "hono";
import type { z } from "zod";
import type { AppBindings } from "../middleware/session.js";
import { badRequest } from "./http.js";

/** Turn a Zod error into the API's flat issue list. */
function zodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
}

/** Read and validate a JSON request body, throwing a 400 on failure. */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context<AppBindings>,
  schema: S,
): Promise<z.output<S>> {
  let payload: unknown;
  try {
    payload = await c.req.json();
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
