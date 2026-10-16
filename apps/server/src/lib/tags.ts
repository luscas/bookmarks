import type { TagRow } from "@bookmarks/db";
import { type Database, bookmarkTags, bookmarks, ownedBookmarkIds, tags } from "@bookmarks/db";
import type { Tag, TagKind, TagSource, UpdateTagInput } from "@bookmarks/shared";
import { normalizeTagName, slugifyTag } from "@bookmarks/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { chunk } from "./chunk.js";
import { isUniqueViolation } from "./db-errors.js";
import { badRequest, conflict } from "./http.js";
import { newId } from "./ids.js";
import { toTag } from "./mappers.js";

/** Columns bound per row in a `tags` INSERT (`id`,`user_id`,`name`,`slug`,`color`,`kind`). */
const TAG_INSERT_COLUMNS = 6;
/** Columns bound per row in a `bookmark_tags` INSERT. */
const BOOKMARK_TAG_INSERT_COLUMNS = 4;
/** Conservative cap for `IN (...)` lookups, well under D1's 100-parameter limit. */
const IDS_PER_QUERY = 50;

/** Resolve a name into the canonical `{ name, slug }` used for storage. */
function resolveTagName(raw: string): { name: string; slug: string } | undefined {
  const name = normalizeTagName(raw);
  if (name.length === 0) {
    return undefined;
  }
  const slug = slugifyTag(name);
  if (slug.length === 0) {
    return undefined;
  }
  return { name, slug };
}

async function fetchTagsBySlugs(
  db: Database,
  userId: string,
  slugs: readonly string[],
): Promise<TagRow[]> {
  const found: TagRow[] = [];
  for (const part of chunk(slugs, IDS_PER_QUERY)) {
    if (part.length === 0) {
      continue;
    }
    const rows = await db
      .select()
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.slug, part)));
    found.push(...rows);
  }
  return found;
}

/** Find the caller's tags matching any of the given slugs. */
export async function findTagsBySlugs(
  db: Database,
  userId: string,
  slugs: readonly string[],
): Promise<TagRow[]> {
  return fetchTagsBySlugs(db, userId, slugs);
}

/** Fetch tags owned by `userId`, keyed by id. */
export async function fetchOwnedTags(
  db: Database,
  userId: string,
  tagIds: readonly string[],
): Promise<TagRow[]> {
  const found: TagRow[] = [];
  for (const part of chunk(tagIds, IDS_PER_QUERY)) {
    if (part.length === 0) {
      continue;
    }
    const rows = await db
      .select()
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, part)));
    found.push(...rows);
  }
  return found;
}

/** Create a standalone manual tag, rejecting duplicates by slug. */
export async function createTag(
  db: Database,
  userId: string,
  name: string,
  color?: string,
): Promise<TagRow> {
  const resolved = resolveTagName(name);
  if (!resolved) {
    throw badRequest("Tag name is required");
  }
  const existing = await db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.slug, resolved.slug)))
    .get();
  if (existing) {
    throw conflict(`Tag "${resolved.name}" already exists`);
  }
  const row: TagRow = {
    id: newId(),
    userId,
    name: resolved.name,
    slug: resolved.slug,
    color: color ?? null,
    kind: "manual",
    createdAt: new Date(),
  };
  try {
    await db.insert(tags).values(row);
  } catch (error) {
    // A concurrent request may have created the same slug; report it as a 409
    // instead of leaking a UNIQUE-constraint 500.
    if (isUniqueViolation(error)) {
      throw conflict(`Tag "${resolved.name}" already exists`);
    }
    throw error;
  }
  return row;
}

/** Rename and/or recolor a tag owned by `userId`. */
export async function updateTag(
  db: Database,
  userId: string,
  id: string,
  input: UpdateTagInput,
): Promise<TagRow | null> {
  const existing = await db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, id)))
    .get();
  if (!existing) {
    return null;
  }

  const patch: Partial<TagRow> = {};
  if (input.name !== undefined) {
    const resolved = resolveTagName(input.name);
    if (!resolved) {
      throw badRequest("Tag name is required");
    }
    const clash = await db
      .select()
      .from(tags)
      .where(and(eq(tags.userId, userId), eq(tags.slug, resolved.slug)))
      .get();
    if (clash && clash.id !== id) {
      throw conflict(`Tag "${resolved.name}" already exists`);
    }
    patch.name = resolved.name;
    patch.slug = resolved.slug;
  }
  if (input.color !== undefined) {
    patch.color = input.color;
  }

  if (Object.keys(patch).length > 0) {
    try {
      await db
        .update(tags)
        .set(patch)
        .where(and(eq(tags.userId, userId), eq(tags.id, id)));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict(`Tag "${patch.name ?? existing.name}" already exists`);
      }
      throw error;
    }
  }
  return { ...existing, ...patch };
}

/** Delete a tag owned by `userId`. Returns false when it does not exist. */
export async function deleteTag(db: Database, userId: string, id: string): Promise<boolean> {
  const existing = await db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.id, id)))
    .get();
  if (!existing) {
    return false;
  }
  await db.delete(tags).where(and(eq(tags.userId, userId), eq(tags.id, id)));
  return true;
}

/**
 * Ensure a tag exists for every name and return the resulting rows. Names are
 * normalized and deduplicated by slug, which is what uniqueness is based on.
 */
export async function ensureTags(
  db: Database,
  userId: string,
  names: readonly string[],
  kind: TagKind,
): Promise<TagRow[]> {
  const bySlug = new Map<string, { name: string; slug: string }>();
  for (const raw of names) {
    const resolved = resolveTagName(raw);
    if (resolved && !bySlug.has(resolved.slug)) {
      bySlug.set(resolved.slug, resolved);
    }
  }
  if (bySlug.size === 0) {
    return [];
  }

  const slugs = [...bySlug.keys()];
  const existing = await fetchTagsBySlugs(db, userId, slugs);
  const existingSlugs = new Set(existing.map((tag) => tag.slug));
  const missing = [...bySlug.values()].filter((candidate) => !existingSlugs.has(candidate.slug));
  if (missing.length === 0) {
    return existing;
  }

  const rows = missing.map((candidate) => ({
    id: newId(),
    userId,
    name: candidate.name,
    slug: candidate.slug,
    color: null,
    kind,
  }));
  for (const part of chunk(rows, Math.floor(100 / TAG_INSERT_COLUMNS))) {
    await db.insert(tags).values(part).onConflictDoNothing();
  }
  return fetchTagsBySlugs(db, userId, slugs);
}

/** Replace the set of tags attached to a bookmark (manual edits). */
export async function setBookmarkTags(
  db: Database,
  userId: string,
  bookmarkId: string,
  names: readonly string[],
): Promise<TagRow[]> {
  // Scope the delete to a bookmark the caller owns so this can never touch
  // another user's links, even if a caller forgets the ownership check.
  await db
    .delete(bookmarkTags)
    .where(
      and(
        eq(bookmarkTags.bookmarkId, bookmarkId),
        inArray(bookmarkTags.bookmarkId, ownedBookmarkIds(bookmarks.id, userId)),
      ),
    );
  return attachTags(db, userId, [{ bookmarkId, names }], "manual", "manual");
}

/** Attach tags to bookmarks without removing existing ones. */
export async function attachTags(
  db: Database,
  userId: string,
  assignments: ReadonlyArray<{ bookmarkId: string; names: readonly string[] }>,
  kind: TagKind,
  source: TagSource,
): Promise<TagRow[]> {
  const allNames = assignments.flatMap((assignment) => [...assignment.names]);
  const tagRows = await ensureTags(db, userId, allNames, kind);
  if (tagRows.length === 0) {
    return [];
  }
  const idBySlug = new Map(tagRows.map((tag) => [tag.slug, tag.id]));

  const links: Array<{
    bookmarkId: string;
    tagId: string;
    source: TagSource;
    confidence: number | null;
  }> = [];
  for (const assignment of assignments) {
    const seen = new Set<string>();
    for (const raw of assignment.names) {
      const resolved = resolveTagName(raw);
      if (!resolved) {
        continue;
      }
      const tagId = idBySlug.get(resolved.slug);
      if (!tagId || seen.has(tagId)) {
        continue;
      }
      seen.add(tagId);
      links.push({ bookmarkId: assignment.bookmarkId, tagId, source, confidence: null });
    }
  }

  for (const part of chunk(links, Math.floor(100 / BOOKMARK_TAG_INSERT_COLUMNS))) {
    await db.insert(bookmarkTags).values(part).onConflictDoNothing();
  }
  return tagRows;
}

/** List tags owned by `userId` with their bookmark counts, by name. */
export async function listTagsWithCounts(db: Database, userId: string): Promise<Tag[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      color: tags.color,
      kind: tags.kind,
      bookmarkCount: sql<number>`count(${bookmarkTags.bookmarkId})`,
    })
    .from(tags)
    .leftJoin(bookmarkTags, eq(bookmarkTags.tagId, tags.id))
    .where(eq(tags.userId, userId))
    .groupBy(tags.id)
    .orderBy(tags.name);

  return rows.map((row) => toTag(row, Number(row.bookmarkCount)));
}

/** Fetch the tags attached to each of `bookmarkIds`, grouped by bookmark. */
export async function tagsForBookmarks(
  db: Database,
  userId: string,
  bookmarkIds: readonly string[],
): Promise<Map<string, Tag[]>> {
  const grouped = new Map<string, Tag[]>();
  for (const part of chunk(bookmarkIds, IDS_PER_QUERY)) {
    if (part.length === 0) {
      continue;
    }
    const rows = await db
      .select({
        bookmarkId: bookmarkTags.bookmarkId,
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
        color: tags.color,
        kind: tags.kind,
      })
      .from(bookmarkTags)
      .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
      .where(and(inArray(bookmarkTags.bookmarkId, part), eq(tags.userId, userId)));

    for (const row of rows) {
      const existing = grouped.get(row.bookmarkId);
      const tag = toTag(row);
      if (existing) {
        existing.push(tag);
      } else {
        grouped.set(row.bookmarkId, [tag]);
      }
    }
  }
  return grouped;
}

/**
 * Merge `sourceTagIds` into `targetTagId`: re-point their bookmark links, then
 * delete the now-empty source tags. Returns the updated target tag.
 */
export async function mergeTags(
  db: Database,
  userId: string,
  sourceTagIds: readonly string[],
  targetTagId: string,
): Promise<Tag | null> {
  const owned = await fetchOwnedTags(db, userId, [...sourceTagIds, targetTagId]);
  const target = owned.find((tag) => tag.id === targetTagId);
  if (!target) {
    return null;
  }
  const ownedIds = new Set(owned.map((tag) => tag.id));
  const sources = sourceTagIds.filter((id) => id !== targetTagId && ownedIds.has(id));

  for (const sourceId of sources) {
    await db.run(
      sql`insert or ignore into bookmark_tags (bookmark_id, tag_id, source, confidence)
          select bookmark_id, ${targetTagId}, source, confidence
          from bookmark_tags
          where tag_id = ${sourceId}
            and bookmark_id in ${ownedBookmarkIds(sql`bookmarks.id`, userId)}`,
    );
    await db
      .delete(bookmarkTags)
      .where(
        and(
          eq(bookmarkTags.tagId, sourceId),
          inArray(bookmarkTags.bookmarkId, ownedBookmarkIds(bookmarks.id, userId)),
        ),
      );
  }

  if (sources.length > 0) {
    await db.delete(tags).where(and(eq(tags.userId, userId), inArray(tags.id, sources)));
  }

  const count = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookmarkTags)
    .where(eq(bookmarkTags.tagId, targetTagId))
    .get();

  return toTag(target, Number(count?.count ?? 0));
}
