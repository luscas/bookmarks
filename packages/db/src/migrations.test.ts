import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  MIGRATION_FILES,
  makeIdempotent,
  runMigrations,
  splitStatements,
} from "./migrations.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Collapse whitespace so the comparison ignores tab/space formatting only. */
function canonical(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("migration metadata", () => {
  it("keeps the embedded SQL in sync with the files on disk", () => {
    for (const migration of MIGRATIONS) {
      const onDisk = readFileSync(join(migrationsDir, migration.name), "utf8");
      expect(canonical(migration.sql)).toBe(canonical(onDisk));
    }
  });

  it("exposes an ordered list of file names", () => {
    expect(MIGRATION_FILES).toEqual(["0000_dusty_meggan.sql", "0001_fts5.sql"]);
  });
});

describe("splitStatements", () => {
  it("splits on the drizzle breakpoint and drops empties", () => {
    const statements = splitStatements(
      "A;--> statement-breakpoint\nB;--> statement-breakpoint\nC;",
    );
    expect(statements).toEqual(["A;", "B;", "C;"]);
  });
});

describe("makeIdempotent", () => {
  it("adds IF NOT EXISTS to CREATE statements", () => {
    expect(makeIdempotent("CREATE TABLE `x` (a text);")).toBe(
      "CREATE TABLE IF NOT EXISTS `x` (a text);",
    );
    expect(makeIdempotent("CREATE UNIQUE INDEX `i` ON `x` (a);")).toBe(
      "CREATE UNIQUE INDEX IF NOT EXISTS `i` ON `x` (a);",
    );
    expect(makeIdempotent("CREATE VIRTUAL TABLE `v` USING fts5(a);")).toBe(
      "CREATE VIRTUAL TABLE IF NOT EXISTS `v` USING fts5(a);",
    );
  });

  it("does not double the clause", () => {
    const once = makeIdempotent("CREATE TABLE `x` (a text);");
    expect(makeIdempotent(once)).toBe(once);
  });

  it("leaves non-CREATE statements unchanged", () => {
    expect(makeIdempotent("INSERT INTO `x` VALUES (1);")).toBe("INSERT INTO `x` VALUES (1);");
  });
});

describe("runMigrations", () => {
  it("applies migrations and is safe to run twice", async () => {
    const db = new Database(":memory:");
    try {
      await runMigrations(db);
      // A second run must not throw: every CREATE is rewritten to IF NOT EXISTS.
      await runMigrations(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);

      expect(names).toContain("bookmarks");
      expect(names).toContain("bookmarks_fts");
      expect(names).toContain("user");
    } finally {
      db.close();
    }
  });
});
