/**
 * Provider-agnostic contracts for AI tagging. Keeping them here (and not in
 * `@bookmarks/shared`) lets the provider implementations and their tests evolve
 * without leaking transport details into the shared, app-facing schemas.
 */

/** Minimal bookmark shape handed to a provider; never contains user notes. */
export interface BookmarkForAi {
  id: string;
  url: string;
  title?: string | null;
  description?: string | null;
}

/** Tags proposed for a single bookmark during bulk tagging. */
export interface TagSuggestion {
  bookmarkId: string;
  tags: string[];
  confidence?: number;
  suggestedTitle?: string;
}

/** A whole-taxonomy proposal: candidate tags plus per-bookmark assignments. */
export interface TaxonomyProposal {
  tags: Array<{ name: string; description?: string }>;
  assignments: Array<{ bookmarkId: string; tags: string[] }>;
}

/** Runtime configuration for a provider instance. */
export interface AiProviderConfig {
  apiKey: string;
  model: string;
  /** Base URL of a chat-completions-compatible API; defaults to OpenAI. */
  baseUrl?: string;
  /**
   * Controls how much the model "thinks" before answering. Only sent when set,
   * because some OpenAI-compatible providers (and some OpenAI models) reject the
   * field outright. On Ollama-style servers `"none"` disables thinking, cutting
   * latency from minutes to seconds on reasoning models.
   */
  reasoningEffort?: "none" | "low" | "medium" | "high";
  /** Injectable `fetch` so tests (and runtimes) can supply their own. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** The behaviour every provider must implement. */
export interface AiProvider {
  suggestTags(bookmarks: BookmarkForAi[], existingTags: string[]): Promise<TagSuggestion[]>;
  proposeTaxonomy(bookmarks: BookmarkForAi[], existingTags: string[]): Promise<TaxonomyProposal>;
}
