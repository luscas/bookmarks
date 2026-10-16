import Database from "better-sqlite3";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrations.js";
import { ownedBookmarkIds } from "./owned-scope.js";
import { bookmarkTags, bookmarks } from "./schema.js";

type Sqlite = InstanceType<typeof Database>;

/**
 * Real migrations over in-memory SQLite, plus two users with one bookmark and
 * one tag each. `b2 -> t1` is a cross-user link: `u2`'s bookmark tagged with
 * `u1`'s tag, which a mis-scoped delete could destroy.
 */
async function createDb() {
  const sqlite = new Database(":memory:");
  await runMigrations({
    exec: (sql) => sqlite.exec(sql),
    all: (sql) => sqlite.prepare(sql).all(),
  });
  sqlite.exec(`
    INSERT INTO \`user\` (\`id\`,\`name\`,\`email\`,\`email_verified\`,\`created_at\`,\`updated_at\`) VALUES
      ('u1','Ada','ada@example.com',0,1,1),
      ('u2','Bob','bob@example.com',0,1,1);
    INSERT INTO \`bookmarks\` (\`id\`,\`user_id\`,\`url\`,\`normalized_url\`,\`url_hash\`,\`source\`,\`created_at\`,\`updated_at\`) VALUES
      ('b1','u1','https://example.com/1','https://example.com/1','h1','manual',1,1),
      ('b2','u2','https://example.com/2','https://example.com/2','h2','manual',1,1);
    INSERT INTO \`tags\` (\`id\`,\`user_id\`,\`name\`,\`slug\`,\`kind\`,\`created_at\`) VALUES
      ('t1','u1','work','work','manual',1),
      ('t2','u2','home','home','manual',1),
      ('t3','u1','later','later','manual',1);
    INSERT INTO \`bookmark_tags\` (\`bookmark_id\`,\`tag_id\`,\`source\`) VALUES
      ('b1','t1','manual'),
      ('b2','t1','manual'),
      ('b2','t2','manual');
  `);
  return { sqlite, db: drizzle(sqlite) };
}

function links(sqlite: Sqlite): string[] {
  const rows = sqlite
    .prepare("SELECT bookmark_id || ':' || tag_id AS link FROM bookmark_tags ORDER BY 1")
    .all() as Array<{ link: string }>;
  return rows.map((row) => row.link);
}

/** The ownership-scoped delete predicate used by `setBookmarkTags`/`mergeTags`. */
function scopedDelete(db: ReturnType<typeof drizzle>, userId: string, bookmarkId: string) {
  return db
    .delete(bookmarkTags)
    .where(
      and(
        eq(bookmarkTags.bookmarkId, bookmarkId),
        inArray(bookmarkTags.bookmarkId, ownedBookmarkIds(bookmarks.id, userId)),
      ),
    );
}

describe("ownedBookmarkIds", () => {
  it("renders a parenthesized subquery (inArray does not add parentheses)", async () => {
    const { sqlite, db } = await createDb();
    try {
      const rendered = db
        .select({ id: bookmarkTags.bookmarkId })
        .from(bookmarkTags)
        .where(inArray(bookmarkTags.bookmarkId, ownedBookmarkIds(bookmarks.id, "u1")))
        .toSQL();

      expect(rendered.sql).toContain("in (select");
    } finally {
      sqlite.close();
    }
  });

  it("deletes only the caller's own bookmark links", async () => {
    const { sqlite, db } = await createDb();
    try {
      await scopedDelete(db, "u1", "b1");

      expect(links(sqlite)).toEqual(["b2:t1", "b2:t2"]);
    } finally {
      sqlite.close();
    }
  });

  it("renders valid SQL inside a raw statement (merge-style insert)", async () => {
    const { sqlite, db } = await createDb();
    try {
      // Mirrors the `insert or ignore ... where bookmark_id in <helper>` shape
      // in `mergeTags`, which interpolates the fragment into a raw `sql`
      // template instead of `inArray`. Only u1's bookmark may be re-pointed.
      await db.run(
        sql`insert or ignore into bookmark_tags (bookmark_id, tag_id, source, confidence)
            select bookmark_id, 't3', source, confidence
            from bookmark_tags
            where tag_id = 't1'
              and bookmark_id in ${ownedBookmarkIds(sql`bookmarks.id`, "u1")}`,
      );

      expect(links(sqlite)).toEqual(["b1:t1", "b1:t3", "b2:t1", "b2:t2"]);
    } finally {
      sqlite.close();
    }
  });

  it("preserves another user's links when their bookmark id is passed in", async () => {
    const { sqlite, db } = await createDb();
    try {
      // `b2` belongs to u2; the ownership subquery must make this a no-op.
      await scopedDelete(db, "u1", "b2");

      expect(links(sqlite)).toEqual(["b1:t1", "b2:t1", "b2:t2"]);
    } finally {
      sqlite.close();
    }
  });
});
