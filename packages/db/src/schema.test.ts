import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { splitStatements } from "./migrations.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Apply every `.sql` file in `migrations/`, in file-name order. */
function createDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of splitStatements(sql)) {
      db.exec(statement);
    }
  }

  return db;
}

function insertUser(db: Database.Database, id: string): void {
  db.prepare(
    'INSERT INTO "user" ("id", "name", "email", "email_verified") VALUES (?, ?, ?, ?)',
  ).run(id, "Test User", `${id}@example.com`, 1);
}

interface InsertBookmark {
  id: string;
  userId: string;
  url: string;
  urlHash: string;
  title: string | null;
  description?: string | null;
  notes?: string | null;
}

function insertBookmark(db: Database.Database, bookmark: InsertBookmark): void {
  db.prepare(
    `INSERT INTO "bookmarks"
      ("id", "user_id", "url", "normalized_url", "url_hash", "title", "description", "notes", "source")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
  ).run(
    bookmark.id,
    bookmark.userId,
    bookmark.url,
    bookmark.url,
    bookmark.urlHash,
    bookmark.title,
    bookmark.description ?? null,
    bookmark.notes ?? null,
  );
}

function search(db: Database.Database, query: string): string[] {
  const rows = db
    .prepare(
      `SELECT b."id" AS id
       FROM "bookmarks_fts"
       JOIN "bookmarks" b ON b."rowid" = "bookmarks_fts"."rowid"
       WHERE "bookmarks_fts" MATCH ?
       ORDER BY b."id"`,
    )
    .all(query) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function bookmarkCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM "bookmarks"').get() as { count: number }).count;
}

describe("bookmarks schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDatabase();
    insertUser(db, "user_1");
    insertUser(db, "user_2");

    insertBookmark(db, {
      id: "bm_react",
      userId: "user_1",
      url: "https://react.dev/learn",
      urlHash: "hash-react",
      title: "React documentation",
      description: "Learn React",
      notes: "hooks, suspense",
    });
    insertBookmark(db, {
      id: "bm_sqlite",
      userId: "user_1",
      url: "https://sqlite.org/fts5.html",
      urlHash: "hash-sqlite",
      title: "SQLite FTS5",
      description: "Full text search",
      notes: null,
    });
  });

  it("matches a bookmark by a title term", () => {
    expect(search(db, "react")).toEqual(["bm_react"]);
    expect(search(db, "sqlite")).toEqual(["bm_sqlite"]);
  });

  it("matches a bookmark by a url term", () => {
    expect(search(db, "fts5")).toEqual(["bm_sqlite"]);
  });

  it("matches on notes as well as title", () => {
    expect(search(db, "suspense")).toEqual(["bm_react"]);
  });

  it("keeps the index in sync when a title is updated", () => {
    db.prepare('UPDATE "bookmarks" SET "title" = ? WHERE "id" = ?').run("Vue.js guide", "bm_react");

    expect(search(db, "documentation")).toEqual([]);
    expect(search(db, "vue")).toEqual(["bm_react"]);
  });

  it("removes a bookmark from the index when deleted", () => {
    expect(search(db, "sqlite")).toEqual(["bm_sqlite"]);

    db.prepare('DELETE FROM "bookmarks" WHERE "id" = ?').run("bm_sqlite");

    expect(search(db, "sqlite")).toEqual([]);
    expect(bookmarkCount(db)).toBe(1);
  });

  it("enforces a unique (user_id, url_hash) pair", () => {
    expect(() =>
      insertBookmark(db, {
        id: "bm_react_duplicate",
        userId: "user_1",
        url: "https://react.dev/learn",
        urlHash: "hash-react",
        title: "React again",
      }),
    ).toThrow(/UNIQUE/i);
  });

  it("allows the same url hash for a different user", () => {
    expect(() =>
      insertBookmark(db, {
        id: "bm_react_other_user",
        userId: "user_2",
        url: "https://react.dev/learn",
        urlHash: "hash-react",
        title: "React for someone else",
      }),
    ).not.toThrow();
  });
});

describe("rate_limits schema", () => {
  it("is created by the migrations and enforces one row per key", () => {
    const db = new Database(":memory:");
    try {
      const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const file of files) {
        const sql = readFileSync(join(migrationsDir, file), "utf8");
        for (const statement of splitStatements(sql)) {
          db.exec(statement);
        }
      }

      const insert = db.prepare(
        'INSERT INTO "rate_limits" ("key", "count", "window_start") VALUES (?, ?, ?)',
      );
      insert.run("signin:203.0.113.9", 1, 1000);
      // The primary key on `key` is what makes the compare-and-swap limiter
      // race-safe: exactly one concurrent request can own a given counter.
      expect(() => insert.run("signin:203.0.113.9", 2, 2000)).toThrow(/UNIQUE/i);
      expect(() => insert.run("favicon:203.0.113.9", 1, 1000)).not.toThrow();

      const rows = db.prepare('SELECT "key" FROM "rate_limits" ORDER BY "key"').all() as Array<{
        key: string;
      }>;
      expect(rows.map((row) => row.key)).toEqual(["favicon:203.0.113.9", "signin:203.0.113.9"]);
    } finally {
      db.close();
    }
  });
});
