import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is only used here to generate the baseline SQL from `src/schema.ts`
 * into `migrations/`. Cloudflare D1 cannot be reached from the CLI, so applying
 * migrations happens at runtime through `runMigrations` (see `src/migrations.ts`).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
