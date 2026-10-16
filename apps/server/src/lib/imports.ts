import type { Database } from "@bookmarks/db";
import { imports } from "@bookmarks/db";
import type { BulkBookmarkItem, CreateImportInput, ImportSource } from "@bookmarks/shared";
import { MAX_IMPORT_HTML_BYTES } from "@bookmarks/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Env } from "../env.js";
import { createAiJob } from "./ai-jobs.js";
import { bulkCreateBookmarks } from "./bookmarks.js";
import { chunk } from "./chunk.js";
import { payloadTooLarge } from "./http.js";
import { newId } from "./ids.js";
import { htmlByteLength, parseNetscapeBookmarks } from "./import.js";

/** Items per bulk call, matching the bounds of the request schemas. */
const IMPORT_BATCH_SIZE = 500;

export interface ImportSummary {
  id: string;
  source: ImportSource;
  status: string;
  total: number;
  imported: number;
  skipped: number;
  createdAt: string;
  finishedAt: string | null;
}

function toSummary(row: typeof imports.$inferSelect): ImportSummary {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    total: row.total,
    imported: row.imported,
    skipped: row.skipped,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

function toItems(input: CreateImportInput): BulkBookmarkItem[] {
  if (input.html !== undefined) {
    if (htmlByteLength(input.html) > MAX_IMPORT_HTML_BYTES) {
      throw payloadTooLarge("Bookmarks HTML export is too large");
    }
    return parseNetscapeBookmarks(input.html).map((parsed) => {
      const item: BulkBookmarkItem = { url: parsed.url, folderPath: parsed.folderPath };
      if (parsed.title !== undefined) {
        item.title = parsed.title;
      }
      if (parsed.addedAt !== undefined) {
        item.addedAt = parsed.addedAt;
      }
      return item;
    });
  }
  return input.items ?? [];
}

/**
 * Run an import synchronously: parse, bulk-insert with per-user dedupe, record
 * the outcome, and optionally enqueue AI tagging for the new bookmarks.
 */
export async function runImport(
  env: Env,
  db: Database,
  userId: string,
  input: CreateImportInput,
): Promise<ImportSummary> {
  // Parse and size-check first so a rejected upload leaves no stale row behind.
  const items = toItems(input);

  const id = newId();
  const startedAt = new Date();
  await db.insert(imports).values({
    id,
    userId,
    source: input.source,
    status: "running",
    total: 0,
    imported: 0,
    skipped: 0,
    createdAt: startedAt,
    finishedAt: null,
  });

  let imported = 0;
  let skipped = 0;
  const bookmarkIds: string[] = [];

  for (const part of chunk(items, IMPORT_BATCH_SIZE)) {
    const result = await bulkCreateBookmarks(db, userId, { source: "import", items: part });
    imported += result.imported;
    skipped += result.skipped;
    bookmarkIds.push(...result.bookmarkIds);
  }

  const finishedAt = new Date();
  await db
    .update(imports)
    .set({ status: "done", total: items.length, imported, skipped, finishedAt })
    .where(eq(imports.id, id));

  if (input.autoTag && bookmarkIds.length > 0) {
    await createAiJob(env, db, userId, "tag_bookmarks", { bookmarkIds });
  }

  return {
    id,
    source: input.source,
    status: "done",
    total: items.length,
    imported,
    skipped,
    createdAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

/** Recent imports for a user, newest first. */
export async function listImports(
  db: Database,
  userId: string,
  limit = 20,
): Promise<ImportSummary[]> {
  const rows = await db
    .select()
    .from(imports)
    .where(eq(imports.userId, userId))
    .orderBy(desc(imports.createdAt))
    .limit(limit);
  return rows.map(toSummary);
}

/** Load a single import owned by `userId`, or `null`. */
export async function getImportById(
  db: Database,
  userId: string,
  id: string,
): Promise<ImportSummary | null> {
  const row = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, id), eq(imports.userId, userId)))
    .get();
  return row ? toSummary(row) : null;
}
