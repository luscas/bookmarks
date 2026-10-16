import type { BookmarkRow } from "@bookmarks/db";
import { type Database, bookmarks } from "@bookmarks/db";
import type {
  BookmarkSource,
  BulkBookmarksInput,
  CreateBookmarkInput,
  UpdateBookmarkInput,
} from "@bookmarks/shared";
import { folderPathToTagName, hostnameOf, normalizeUrl, urlHash } from "@bookmarks/shared";
import { and, eq, inArray } from "drizzle-orm";
import { chunk } from "./chunk.js";
import { badRequest } from "./http.js";
import { newId } from "./ids.js";
import { attachTags, setBookmarkTags, tagsForBookmarks } from "./tags.js";

/** Bound parameters per bookmark INSERT row (timestamps included). */
const BOOKMARK_INSERT_COLUMNS = 12;
const IDS_PER_QUERY = 50;

export interface CreateBookmarkResult {
  bookmark: BookmarkRow;
  created: boolean;
}

export interface BulkCreateResult {
  imported: number;
  skipped: number;
  bookmarkIds: string[];
}

export interface SelectBookmarksOptions {
  userId: string;
  bookmarkIds?: readonly string[];
  scope?: "all" | "untagged";
  limit?: number;
}

/** Load a single bookmark owned by `userId`, or `null`. */
export async function getBookmarkById(
  db: Database,
  userId: string,
  id: string,
): Promise<BookmarkRow | null> {
  const row = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.id, id)))
    .get();
  return row ?? null;
}

async function fetchExistingHashes(
  db: Database,
  userId: string,
  hashes: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(hashes, IDS_PER_QUERY)) {
    if (part.length === 0) {
      continue;
    }
    const rows = await db
      .select({ urlHash: bookmarks.urlHash })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.urlHash, part)));
    for (const row of rows) {
      found.add(row.urlHash);
    }
  }
  return found;
}

/** Create one bookmark, deduplicating on the normalized URL hash. */
export async function createBookmark(
  db: Database,
  userId: string,
  input: CreateBookmarkInput,
): Promise<CreateBookmarkResult> {
  let normalized: string;
  try {
    normalized = normalizeUrl(input.url);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid URL");
  }
  const hash = await urlHash(normalized);
  const existing = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.urlHash, hash)))
    .get();
  if (existing) {
    return { bookmark: existing, created: false };
  }

  const now = new Date();
  const row: BookmarkRow = {
    id: newId(),
    userId,
    url: input.url,
    normalizedUrl: normalized,
    urlHash: hash,
    title: input.title ?? null,
    description: input.description ?? null,
    notes: input.notes ?? null,
    faviconKey: hostnameOf(normalized) || null,
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(bookmarks).values(row);

  if (input.tags && input.tags.length > 0) {
    await setBookmarkTags(db, userId, row.id, input.tags);
  }

  return { bookmark: row, created: true };
}

/**
 * Create many bookmarks, skipping invalid URLs and anything already stored.
 * Folder paths become hierarchical `import` tags.
 */
export async function bulkCreateBookmarks(
  db: Database,
  userId: string,
  input: BulkBookmarksInput,
): Promise<BulkCreateResult> {
  const source: BookmarkSource = input.source;
  const candidates: Array<{
    id: string;
    url: string;
    normalizedUrl: string;
    urlHash: string;
    title: string | null;
    faviconKey: string | null;
    folderNames: string[];
  }> = [];
  let skipped = 0;
  const seenHashes = new Set<string>();

  for (const item of input.items) {
    let normalized: string;
    try {
      normalized = normalizeUrl(item.url);
    } catch {
      skipped += 1;
      continue;
    }
    const hash = await urlHash(normalized);
    if (seenHashes.has(hash)) {
      skipped += 1;
      continue;
    }
    seenHashes.add(hash);

    const folderName = folderPathToTagName(item.folderPath);
    candidates.push({
      id: newId(),
      url: item.url,
      normalizedUrl: normalized,
      urlHash: hash,
      title: item.title ?? null,
      faviconKey: hostnameOf(normalized) || null,
      folderNames: folderName ? [folderName] : [],
    });
  }

  if (candidates.length === 0) {
    return { imported: 0, skipped, bookmarkIds: [] };
  }

  const existingHashes = await fetchExistingHashes(
    db,
    userId,
    candidates.map((candidate) => candidate.urlHash),
  );
  const fresh = candidates.filter((candidate) => !existingHashes.has(candidate.urlHash));
  skipped += candidates.length - fresh.length;

  const now = new Date();
  const rows: BookmarkRow[] = fresh.map((candidate) => ({
    id: candidate.id,
    userId,
    url: candidate.url,
    normalizedUrl: candidate.normalizedUrl,
    urlHash: candidate.urlHash,
    title: candidate.title,
    description: null,
    notes: null,
    faviconKey: candidate.faviconKey,
    source,
    createdAt: now,
    updatedAt: now,
  }));

  for (const part of chunk(rows, Math.floor(100 / BOOKMARK_INSERT_COLUMNS))) {
    await db.insert(bookmarks).values(part);
  }

  const assignments = fresh
    .filter((candidate) => candidate.folderNames.length > 0)
    .map((candidate) => ({ bookmarkId: candidate.id, names: candidate.folderNames }));
  if (assignments.length > 0) {
    await attachTags(db, userId, assignments, "import", "manual");
  }

  return { imported: rows.length, skipped, bookmarkIds: rows.map((row) => row.id) };
}

/** Select bookmarks for AI jobs and bulk operations. */
export async function selectBookmarks(
  db: Database,
  options: SelectBookmarksOptions,
): Promise<BookmarkRow[]> {
  const conditions = [eq(bookmarks.userId, options.userId)];
  if (options.bookmarkIds) {
    if (options.bookmarkIds.length === 0) {
      return [];
    }
    conditions.push(inArray(bookmarks.id, [...options.bookmarkIds]));
  }

  const base = db
    .select()
    .from(bookmarks)
    .where(and(...conditions));
  const rows = options.limit !== undefined ? await base.limit(options.limit) : await base;

  if (options.scope === "untagged") {
    const tagged = await tagsForBookmarks(
      db,
      options.userId,
      rows.map((row) => row.id),
    );
    return rows.filter((row) => (tagged.get(row.id) ?? []).length === 0);
  }
  return rows;
}

/** Apply a partial update to a bookmark owned by `userId`. */
export async function updateBookmark(
  db: Database,
  userId: string,
  id: string,
  input: UpdateBookmarkInput,
): Promise<BookmarkRow | null> {
  const existing = await getBookmarkById(db, userId, id);
  if (!existing) {
    return null;
  }
  const patch: Partial<BookmarkRow> = { updatedAt: new Date() };
  if (input.title !== undefined) {
    patch.title = input.title;
  }
  if (input.description !== undefined) {
    patch.description = input.description;
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes;
  }
  await db
    .update(bookmarks)
    .set(patch)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.id, id)));
  return { ...existing, ...patch };
}

/** Delete a bookmark owned by `userId`. Returns false when it does not exist. */
export async function deleteBookmark(db: Database, userId: string, id: string): Promise<boolean> {
  const existing = await getBookmarkById(db, userId, id);
  if (!existing) {
    return false;
  }
  await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.id, id)));
  return true;
}
