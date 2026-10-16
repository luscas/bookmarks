import type { Database } from "@bookmarks/db";
import { bookmarkTags, bookmarks } from "@bookmarks/db";
import type { BookmarkPage, ListBookmarksQuery } from "@bookmarks/shared";
import { slugifyTag } from "@bookmarks/shared";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { chunk } from "./chunk.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { buildFtsQuery } from "./fts.js";
import { toBookmark } from "./mappers.js";
import { findTagsBySlugs, tagsForBookmarks } from "./tags.js";

/** Max tag ids per `IN (...)` group, kept under D1's bound-parameter limit. */
const TAG_IDS_PER_GROUP = 90;

function sortValue(
  row: {
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  sort: ListBookmarksQuery["sort"],
): string | number {
  switch (sort) {
    case "title":
      return row.title ?? "";
    case "updatedAt":
      return row.updatedAt.getTime();
    default:
      return row.createdAt.getTime();
  }
}

/**
 * Cursor-paginated bookmark listing with optional full-text search and tag
 * filtering. Sorting is keyset-based (never `OFFSET`) so pages stay stable as
 * rows are inserted.
 */
export async function listBookmarks(
  db: Database,
  userId: string,
  query: ListBookmarksQuery,
): Promise<BookmarkPage> {
  const conditions: SQL[] = [eq(bookmarks.userId, userId)];

  if (query.q) {
    const fts = buildFtsQuery(query.q);
    if (fts.length > 0) {
      conditions.push(
        sql`"bookmarks"."rowid" in (select "rowid" from "bookmarks_fts" where "bookmarks_fts" match ${fts})`,
      );
    }
  }

  if (query.tag && query.tag.length > 0) {
    const slugs = [
      ...new Set(query.tag.map((tag) => slugifyTag(tag)).filter((slug) => slug.length > 0)),
    ];
    if (slugs.length === 0) {
      return { items: [], nextCursor: null };
    }
    const tagRows = await findTagsBySlugs(db, userId, slugs);
    if (tagRows.length === 0) {
      return { items: [], nextCursor: null };
    }
    const groups = chunk(
      tagRows.map((tag) => tag.id),
      TAG_IDS_PER_GROUP,
    ).map(
      (ids) =>
        sql`${bookmarks.id} in (select ${bookmarkTags.bookmarkId} from ${bookmarkTags} where ${inArray(bookmarkTags.tagId, ids)})`,
    );
    const tagCondition = groups.length === 1 ? groups[0] : or(...groups);
    if (tagCondition) {
      conditions.push(tagCondition);
    }
  }

  const direction: "asc" | "desc" = query.sort === "title" ? "asc" : "desc";
  const valueExpression: SQL =
    query.sort === "title"
      ? sql`coalesce(${bookmarks.title}, '')`
      : query.sort === "updatedAt"
        ? sql`${bookmarks.updatedAt}`
        : sql`${bookmarks.createdAt}`;

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      conditions.push(
        direction === "desc"
          ? sql`(${valueExpression} < ${cursor.v} or (${valueExpression} = ${cursor.v} and ${bookmarks.id} < ${cursor.id}))`
          : sql`(${valueExpression} > ${cursor.v} or (${valueExpression} = ${cursor.v} and ${bookmarks.id} > ${cursor.id}))`,
      );
    }
  }

  const orderBy =
    direction === "desc"
      ? [desc(valueExpression), desc(bookmarks.id)]
      : [asc(valueExpression), asc(bookmarks.id)];

  const rows = await db
    .select()
    .from(bookmarks)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ v: sortValue(last, query.sort), id: last.id }) : null;

  const tagsByBookmark = await tagsForBookmarks(
    db,
    userId,
    page.map((row) => row.id),
  );

  return {
    items: page.map((row) => toBookmark(row, tagsByBookmark.get(row.id) ?? [])),
    nextCursor,
  };
}
