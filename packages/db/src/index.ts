import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

export * from "./migrations.js";
export * from "./owned-scope.js";
export * from "./schema.js";

/** Drizzle client bound to a D1 database, used across the server. */
export type Database = ReturnType<typeof createDb>;

/**
 * Create a Drizzle client for a Cloudflare D1 binding. Call this per request
 * with `env.DB`; D1 bindings are cheap wrappers and must not be cached globally.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
