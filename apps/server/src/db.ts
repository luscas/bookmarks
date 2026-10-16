import { createDb } from "@bookmarks/db";
import type { Env } from "./env.js";

/** Drizzle client type used across the server. */
export type Db = ReturnType<typeof createDb>;

/**
 * Build a Drizzle client bound to the request's D1 binding. D1 bindings are
 * cheap wrappers and must not be cached across requests, so call this per
 * request (or per handler) rather than at module scope.
 */
export function getDb(env: Env): Db {
  return createDb(env.DB);
}
