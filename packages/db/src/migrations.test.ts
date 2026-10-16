import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  MIGRATIONS_TABLE,
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

type Sqlite = InstanceType<typeof Database>;

/** Adapter letting `runMigrations` drive better-sqlite3. */
function createExecutor(db: Sqlite) {
  return {
    exec: (sql: string) => db.exec(sql),
    all: (sql: string) => db.prepare(sql).all(),
  };
}

function tableNames(db: Sqlite): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}

function columnNames(db: Sqlite, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(\`${table}\`)`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function countRows(db: Sqlite, table: string): number {
  const row = db.prepare(`SELECT count(*) AS count FROM \`${table}\``).get() as
    | { count: number }
    | undefined;
  return row?.count ?? -1;
}

describe("migration metadata", () => {
  it("keeps the embedded SQL in sync with the files on disk", () => {
    for (const migration of MIGRATIONS) {
      const onDisk = readFileSync(join(migrationsDir, migration.name), "utf8");
      expect(canonical(migration.sql)).toBe(canonical(onDisk));
    }
  });

  it("accounts for every .sql file in the migrations directory, in order", () => {
    const onDisk = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    // Detects drift automatically: a new drizzle-kit migration that is not
    // embedded above (or an embedded migration with no file) fails here.
    expect(MIGRATION_FILES).toEqual(onDisk);
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
  it("applies every migration and is a no-op on the second run", async () => {
    const db = new Database(":memory:");
    try {
      const executor = createExecutor(db);
      await runMigrations(executor);

      const names = tableNames(db);
      expect(names).toContain("bookmarks");
      expect(names).toContain("bookmarks_fts");
      expect(names).toContain("user");
      expect(names).toContain(MIGRATIONS_TABLE);
      // 0003 and 0004 are non-idempotent `ALTER TABLE ... ADD COLUMN`s.
      expect(columnNames(db, "imports")).toContain("error");
      expect(columnNames(db, "ai_settings")).toContain("reasoning_effort");
      expect(countRows(db, MIGRATIONS_TABLE)).toBe(MIGRATION_FILES.length);

      db.exec(`
        INSERT INTO \`user\` (\`id\`,\`name\`,\`email\`,\`email_verified\`,\`created_at\`,\`updated_at\`)
        VALUES ('u1','Ada','ada@example.com',0,1,1);
        INSERT INTO \`apikey\` (\`id\`,\`key\`,\`reference_id\`) VALUES ('k1','secret','u1');
      `);
      const apiKeysBefore = countRows(db, "apikey");
      expect(apiKeysBefore).toBe(1);

      // Second run must skip everything already recorded. Without the
      // __migrations guard, 0003 would throw "duplicate column name: error".
      await runMigrations(executor);

      expect(countRows(db, "apikey")).toBe(apiKeysBefore);
      expect(countRows(db, MIGRATIONS_TABLE)).toBe(MIGRATION_FILES.length);
    } finally {
      db.close();
    }
  });

  it("applies only the migrations that are not recorded yet", async () => {
    const db = new Database(":memory:");
    try {
      const executor = createExecutor(db);

      await runMigrations(executor, MIGRATIONS.slice(0, 1));
      expect(countRows(db, MIGRATIONS_TABLE)).toBe(1);
      expect(tableNames(db)).not.toContain("bookmarks_fts");

      await runMigrations(executor);

      expect(countRows(db, MIGRATIONS_TABLE)).toBe(MIGRATION_FILES.length);
      expect(tableNames(db)).toContain("bookmarks_fts");
      expect(columnNames(db, "imports")).toContain("error");
      expect(columnNames(db, "ai_settings")).toContain("reasoning_effort");
    } finally {
      db.close();
    }
  });
});
