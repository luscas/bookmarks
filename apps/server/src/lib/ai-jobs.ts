import type { AiProvider, BookmarkForAi, CreateProviderConfig } from "@bookmarks/ai";
import { createProvider } from "@bookmarks/ai";
import type { AiJobRow, AiSettingsRow, Database } from "@bookmarks/db";
import { aiJobs, bookmarks, tags } from "@bookmarks/db";
import type { AiJobType } from "@bookmarks/shared";
import { MAX_TAGS_PER_BOOKMARK } from "@bookmarks/shared";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db.js";
import type { AiJobMessage, Env } from "../env.js";
import { getOrProvisionAiSettings } from "./ai-config.js";
import { selectBookmarks } from "./bookmarks.js";
import { decryptApiKey } from "./crypto.js";
import { newId } from "./ids.js";
import { attachTags } from "./tags.js";

/** Upper bound on bookmarks considered by a single organize run. */
const ORGANIZE_LIMIT = 200;

function toBookmarkForAi(row: {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
}): BookmarkForAi {
  return { id: row.id, url: row.url, title: row.title, description: row.description };
}

/** Settings fields that shape the provider config. */
type ProviderSettings = Pick<AiSettingsRow, "provider" | "model" | "baseUrl" | "reasoningEffort">;

/**
 * Assemble the provider config, adding optional fields only when they are set —
 * some providers reject `reasoning_effort` outright, so an unset value must be
 * omitted rather than defaulted.
 */
export function toProviderConfig(settings: ProviderSettings, apiKey: string): CreateProviderConfig {
  const config: CreateProviderConfig = {
    provider: settings.provider,
    model: settings.model,
    apiKey,
  };
  if (settings.baseUrl) {
    config.baseUrl = settings.baseUrl;
  }
  if (settings.reasoningEffort) {
    config.reasoningEffort = settings.reasoningEffort;
  }
  return config;
}

async function buildProvider(env: Env, db: Database, userId: string): Promise<AiProvider | null> {
  // In development this provisions the local Ollama on first use, so AI jobs
  // work with zero manual configuration; production is unaffected.
  const settings = await getOrProvisionAiSettings(env, db, userId);
  if (!settings?.apiKeyCiphertext || !settings.apiKeyIv) {
    return null;
  }
  const apiKey = await decryptApiKey(
    { ciphertext: settings.apiKeyCiphertext, iv: settings.apiKeyIv },
    env.AI_KEY_ENCRYPTION_SECRET,
  );
  return createProvider(toProviderConfig(settings, apiKey));
}

async function listTagNames(db: Database, userId: string): Promise<string[]> {
  const rows = await db.select({ name: tags.name }).from(tags).where(eq(tags.userId, userId));
  return rows.map((row) => row.name);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

async function runTagJob(
  db: Database,
  provider: AiProvider,
  userId: string,
  payload: string,
  existingTags: string[],
): Promise<{ tagged: number }> {
  const parsed = JSON.parse(payload) as { bookmarkIds?: unknown };
  const bookmarkIds = parseStringArray(parsed.bookmarkIds);
  const rows = await selectBookmarks(db, { userId, bookmarkIds });
  if (rows.length === 0) {
    return { tagged: 0 };
  }

  const suggestions = await provider.suggestTags(rows.map(toBookmarkForAi), existingTags);
  let tagged = 0;
  for (const suggestion of suggestions) {
    const row = rows.find((candidate) => candidate.id === suggestion.bookmarkId);
    if (!row) {
      continue;
    }
    const names = suggestion.tags.slice(0, MAX_TAGS_PER_BOOKMARK);
    if (names.length > 0) {
      await attachTags(db, userId, [{ bookmarkId: row.id, names }], "ai", "ai");
      tagged += 1;
    }
    if (suggestion.suggestedTitle && (!row.title || row.title.trim().length === 0)) {
      await db
        .update(bookmarks)
        .set({ title: suggestion.suggestedTitle, updatedAt: new Date() })
        .where(and(eq(bookmarks.id, row.id), eq(bookmarks.userId, userId)));
    }
  }
  return { tagged };
}

async function runOrganizeJob(
  db: Database,
  provider: AiProvider,
  userId: string,
  payload: string,
  existingTags: string[],
): Promise<{ tagged: number }> {
  const parsed = JSON.parse(payload) as { scope?: unknown };
  const scope = parsed.scope === "all" ? "all" : "untagged";
  const rows = await selectBookmarks(db, { userId, scope, limit: ORGANIZE_LIMIT });
  if (rows.length === 0) {
    return { tagged: 0 };
  }

  const proposal = await provider.proposeTaxonomy(rows.map(toBookmarkForAi), existingTags);
  let tagged = 0;
  for (const assignment of proposal.assignments) {
    const row = rows.find((candidate) => candidate.id === assignment.bookmarkId);
    if (!row) {
      continue;
    }
    const names = assignment.tags.slice(0, MAX_TAGS_PER_BOOKMARK);
    if (names.length === 0) {
      continue;
    }
    await attachTags(db, userId, [{ bookmarkId: row.id, names }], "ai", "ai");
    tagged += 1;
  }
  return { tagged };
}

/** Outline of an AI job suitable for API responses. */
export interface AiJobSummary {
  id: string;
  type: AiJobType;
  status: AiJobRow["status"];
  error: string | null;
  result: unknown;
  createdAt: string;
  finishedAt: string | null;
}

function parseResult(result: string | null): unknown {
  if (!result) {
    return null;
  }
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

export function toJobSummary(row: AiJobRow): AiJobSummary {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    error: row.error ?? null,
    result: parseResult(row.result ?? null),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

/** Most recent AI jobs for a user, newest first. */
export async function listAiJobs(db: Database, userId: string, limit = 20): Promise<AiJobRow[]> {
  return db
    .select()
    .from(aiJobs)
    .where(eq(aiJobs.userId, userId))
    .orderBy(desc(aiJobs.createdAt))
    .limit(limit);
}

/** Load one AI job owned by `userId`, or `null`. */
export async function getAiJobById(
  db: Database,
  userId: string,
  id: string,
): Promise<AiJobRow | null> {
  const row = await db
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.id, id), eq(aiJobs.userId, userId)))
    .get();
  return row ?? null;
}

/** Persist a queued AI job and push it onto the queue. Returns the job id. */
export async function createAiJob(
  env: Env,
  db: Database,
  userId: string,
  type: AiJobType,
  payload: unknown,
): Promise<string> {
  const id = newId();
  await db.insert(aiJobs).values({
    id,
    userId,
    type,
    status: "queued",
    payload: JSON.stringify(payload),
    result: null,
    error: null,
    createdAt: new Date(),
    finishedAt: null,
  });
  await env.AI_QUEUE.send({ jobId: id, userId, type });
  return id;
}

/**
 * Process one queued AI job. Failures are recorded on the job row rather than
 * thrown, so the queue consumer can acknowledge the message and avoid retrying
 * a deterministic failure forever.
 */
export async function processAiJob(env: Env, message: AiJobMessage): Promise<void> {
  const db = getDb(env);
  const job = await db
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.id, message.jobId), eq(aiJobs.userId, message.userId)))
    .get();
  if (!job) {
    return;
  }

  await db.update(aiJobs).set({ status: "running" }).where(eq(aiJobs.id, job.id));

  try {
    const provider = await buildProvider(env, db, message.userId);
    if (!provider) {
      throw new Error("AI provider is not configured or the API key is missing");
    }
    const existingTags = await listTagNames(db, message.userId);
    const result =
      job.type === "organize_taxonomy"
        ? await runOrganizeJob(db, provider, message.userId, job.payload, existingTags)
        : await runTagJob(db, provider, message.userId, job.payload, existingTags);

    await db
      .update(aiJobs)
      .set({ status: "done", result: JSON.stringify(result), error: null, finishedAt: new Date() })
      .where(eq(aiJobs.id, job.id));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown AI error";
    await db
      .update(aiJobs)
      .set({ status: "failed", error: reason, finishedAt: new Date() })
      .where(eq(aiJobs.id, job.id));
    console.error(`AI job ${job.id} failed: ${reason}`);
  }
}
