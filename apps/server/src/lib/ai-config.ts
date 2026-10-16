import type { AiSettingsRow, Database } from "@bookmarks/db";
import { aiSettings } from "@bookmarks/db";
import type { AiProviderId, AiReasoningEffort } from "@bookmarks/shared";
import { aiReasoningEffortEnum } from "@bookmarks/shared";
import { eq } from "drizzle-orm";
import type { Env } from "../env.js";
import { encryptApiKey } from "./crypto.js";

/**
 * Development-only AI provisioning.
 *
 * When `NODE_ENV=development` (supplied by the git-ignored `apps/server/.dev.vars`)
 * the server pre-configures the local Ollama so importing favorites can be
 * organised out of the box. This module is the single place that reads those
 * env values, so production (where `NODE_ENV` is unset) never provisions or
 * overwrites anything.
 */

const DEV_AI_DEFAULT_MODEL = "qwen3.5:4b";
const DEV_AI_DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEV_AI_DEFAULT_API_KEY = "ollama";
/**
 * Disables the reasoning trace on the dev Ollama, which otherwise spends
 * thousands of tokens "thinking" before emitting a few hundred characters of
 * JSON (turning a ~2.5s call into 76–126s).
 */
const DEV_AI_DEFAULT_REASONING_EFFORT: AiReasoningEffort = "none";

/** Provider used for the dev defaults; the only one that ships in phase 1. */
const DEV_AI_PROVIDER: AiProviderId = "openai-compatible";

export interface DevAiDefaults {
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  reasoningEffort: AiReasoningEffort;
}

/** Accept a valid `DEV_AI_REASONING_EFFORT`, otherwise fall back to `"none"`. */
function resolveReasoningEffort(value: string | undefined): AiReasoningEffort {
  const parsed = aiReasoningEffortEnum.safeParse(value);
  return parsed.success ? parsed.data : DEV_AI_DEFAULT_REASONING_EFFORT;
}

/** True only when the server runs with `NODE_ENV=development`. */
export function isDevelopment(env: Env): boolean {
  return env.NODE_ENV === "development";
}

/** Dev Ollama settings, with `DEV_AI_*` env overrides taking precedence. */
export function devAiDefaults(env: Env): DevAiDefaults {
  return {
    provider: DEV_AI_PROVIDER,
    model: env.DEV_AI_MODEL ?? DEV_AI_DEFAULT_MODEL,
    baseUrl: env.DEV_AI_BASE_URL ?? DEV_AI_DEFAULT_BASE_URL,
    apiKey: env.DEV_AI_API_KEY ?? DEV_AI_DEFAULT_API_KEY,
    reasoningEffort: resolveReasoningEffort(env.DEV_AI_REASONING_EFFORT),
  };
}

async function getSettingsRow(db: Database, userId: string): Promise<AiSettingsRow | null> {
  const row = await db.select().from(aiSettings).where(eq(aiSettings.userId, userId)).get();
  return row ?? null;
}

/**
 * Provision the dev Ollama settings for a user, inserting only when they have
 * no `ai_settings` row. The `onConflictDoNothing` on the `userId` PK makes this
 * idempotent and means a user's own configuration is never overwritten. A no-op
 * outside development.
 */
export async function ensureDevAiSettings(env: Env, db: Database, userId: string): Promise<void> {
  if (!isDevelopment(env)) {
    return;
  }
  const defaults = devAiDefaults(env);
  const encrypted = await encryptApiKey(defaults.apiKey, env.AI_KEY_ENCRYPTION_SECRET);
  await db
    .insert(aiSettings)
    .values({
      userId,
      provider: defaults.provider,
      model: defaults.model,
      baseUrl: defaults.baseUrl,
      reasoningEffort: defaults.reasoningEffort,
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyIv: encrypted.iv,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: aiSettings.userId });
}

/**
 * Return the user's stored AI settings, provisioning the dev defaults first when
 * they are missing. Returns `null` in production when nothing is configured.
 */
export async function getOrProvisionAiSettings(
  env: Env,
  db: Database,
  userId: string,
): Promise<AiSettingsRow | null> {
  const existing = await getSettingsRow(db, userId);
  if (existing) {
    return existing;
  }
  await ensureDevAiSettings(env, db, userId);
  return getSettingsRow(db, userId);
}
