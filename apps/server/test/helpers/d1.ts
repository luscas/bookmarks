import { MIGRATIONS, splitStatements } from "@bookmarks/db";
import type { D1Database } from "@cloudflare/workers-types";
import Database from "better-sqlite3";

/**
 * Test doubles for D1-backed code paths: a real (migrated) better-sqlite3
 * database plus a D1-compatible adapter over it, so routes and middleware can
 * run against `env.DB` exactly as they do in the Worker.
 */

/** Open an in-memory SQLite database with every migration applied. */
export function createMigratedSqlite(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const migration of MIGRATIONS) {
    for (const statement of splitStatements(migration.sql)) {
      sqlite.exec(statement);
    }
  }
  return sqlite;
}

interface StatementInfo {
  changes: number;
  lastInsertRowid: number | bigint;
}

function toD1Result(info: StatementInfo) {
  return {
    success: true,
    meta: { changes: info.changes, last_row_id: info.lastInsertRowid, duration: 0 },
  };
}

/** Wrap a better-sqlite3 database in the subset of the D1 API drizzle uses. */
export function createD1Adapter(sqlite: Database.Database): D1Database {
  const prepareStatement = (statement: Database.Statement) => ({
    all: () => ({ results: statement.all() }),
    raw: () => statement.raw().all(),
    first: () => statement.get() ?? null,
    run: () => toD1Result(statement.run()),
  });

  const prepare = (query: string) => {
    const statement = sqlite.prepare(query);
    return {
      ...prepareStatement(statement),
      bind: (...params: unknown[]) => {
        const bound = {
          all: () => ({ results: statement.all(...params) }),
          raw: () => statement.raw().all(...params),
          first: () => statement.get(...params) ?? null,
          run: () => toD1Result(statement.run(...params)),
        };
        return { ...bound, bind: () => bound };
      },
    };
  };

  return {
    prepare,
    batch: async (statements: Array<{ results?: unknown }>) => {
      // D1 runs batches in one transaction; sequential execution is equivalent
      // for the single-threaded access patterns in tests.
      const results = await Promise.all(
        statements.map(async (statement) => {
          const run = (statement as unknown as { run: () => Promise<unknown> }).run;
          return (await run.call(statement)) as { results?: unknown };
        }),
      );
      return results;
    },
    exec: async (query: string) => {
      sqlite.exec(query);
      return { count: 0, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

/** A `env.DB`-ready D1 adapter over a freshly migrated in-memory database. */
export function createTestD1(): { d1: D1Database; sqlite: Database.Database } {
  const sqlite = createMigratedSqlite();
  return { d1: createD1Adapter(sqlite), sqlite };
}
