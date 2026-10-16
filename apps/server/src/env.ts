import type { AiJobType } from "@bookmarks/shared";
import type { D1Database, Fetcher, Queue, R2Bucket } from "@cloudflare/workers-types";

/**
 * Message pushed onto the AI queue. It intentionally carries only identifiers:
 * the job payload lives in the `ai_jobs` row so the queue stays small and the
 * consumer always reads the latest state.
 */
export interface AiJobMessage {
  jobId: string;
  userId: string;
  type: AiJobType;
}

/** Bindings and secrets available to the Worker. */
export interface Env {
  DB: D1Database;
  FAVICONS: R2Bucket;
  AI_QUEUE: Queue<AiJobMessage>;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  AI_KEY_ENCRYPTION_SECRET: string;
  TRUSTED_ORIGINS: string;
  /**
   * Dev-only: set to `development` by the git-ignored `apps/server/.dev.vars`
   * to enable local Ollama defaults. Never set in production, so `undefined`
   * keeps today's behavior there.
   */
  NODE_ENV?: string;
  /** Dev-only overrides for the pre-configured local Ollama (see `ai-config.ts`). */
  DEV_AI_MODEL?: string;
  DEV_AI_BASE_URL?: string;
  DEV_AI_API_KEY?: string;
}
