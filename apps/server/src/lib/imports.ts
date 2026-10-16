import type { Database } from "@bookmarks/db";
import { imports } from "@bookmarks/db";
import type { BulkBookmarkItem, CreateImportInput, ImportSource } from "@bookmarks/shared";
import { MAX_IMPORT_HTML_BYTES } from "@bookmarks/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Env } from "../env.js";
import { ensureDevAiSettings, isDevelopment } from "./ai-config.js";
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
  /** Failure reason when `status` is `failed`; `null` otherwise. */
  error: string | null;
}

/** Upper bound on the failure reason persisted on an `imports` row. */
const MAX_IMPORT_ERROR_LENGTH = 500;

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
    error: row.error,
  };
}

/**
 * Record a failed run so the row does not stay `running` forever. Best effort:
 * the original error is more useful than a failed bookkeeping write, so a
 * problem here is swallowed.
 */
async function markImportFailed(db: Database, id: string, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  try {
    await db
      .update(imports)
      .set({
        status: "failed",
        error: reason.slice(0, MAX_IMPORT_ERROR_LENGTH),
        finishedAt: new Date(),
      })
      .where(eq(imports.id, id));
  } catch {
    // Ignore: the caller still receives the original error.
  }
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
 *
 * A failure after the row is created marks it `failed` (with the reason and
 * `finishedAt`) before propagating, so it never stays `running` forever.
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

  try {
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

    const shouldAutoTag = input.autoTag ?? isDevelopment(env);
    if (shouldAutoTag && bookmarkIds.length > 0) {
      // AI provisioning/enqueue is a convenience layered on top of a successful
      // import, so a failure here (e.g. a malformed `AI_KEY_ENCRYPTION_SECRET`)
      // must not rewrite the persisted `done` row to `failed` or fail the
      // request; the import already succeeded. The job just isn't enqueued.
      try {
        // In development make sure the local Ollama settings exist before the
        // queued job runs; production is a no-op and never provisions anything.
        await ensureDevAiSettings(env, db, userId);
        await createAiJob(env, db, userId, "tag_bookmarks", { bookmarkIds });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `Import ${id} for user ${userId}: AI tagging setup failed (import kept as done): ${reason}`,
        );
      }
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
      error: null,
    };
  } catch (error) {
    await markImportFailed(db, id, error);
    throw error;
  }
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
