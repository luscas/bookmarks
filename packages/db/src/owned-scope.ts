import type { SQL, SQLWrapper } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { bookmarks } from "./schema.js";

/**
 * Parenthesized subquery selecting the ids of the bookmarks owned by `userId`:
 *
 *   (select <idColumn> from `bookmarks` where `bookmarks`.`user_id` = ?)
 *
 * The parentheses are required: `drizzle-orm`'s `inArray` does not add any, so a
 * bare `select ...` fragment renders `... in select ...`, which SQLite rejects.
 * Use it to scope a `bookmark_tags` statement to one user's bookmarks without
 * repeating the ownership predicate:
 *
 *   inArray(bookmarkTags.bookmarkId, ownedBookmarkIds(bookmarks.id, userId))
 */
export function ownedBookmarkIds(idColumn: SQLWrapper, userId: string): SQL {
  return sql`(select ${idColumn} from ${bookmarks} where ${bookmarks.userId} = ${userId})`;
}
