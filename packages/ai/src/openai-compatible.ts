import { AI_BATCH_SIZE, MAX_AI_RESPONSE_BYTES } from "@bookmarks/shared";
import { AiProviderError } from "./errors.js";
import { buildProposeTaxonomyPrompt, buildSuggestTagsPrompt } from "./prompts.js";
import type {
  AiProvider,
  AiProviderConfig,
  BookmarkForAi,
  TagSuggestion,
  TaxonomyProposal,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
/** Extra attempts after the first failure (so up to 3 requests total). */
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;

type ChatRole = "system" | "user";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface JsonSchemaFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  response_format: JsonSchemaFormat;
  /**
   * Only present when `AiProviderConfig.reasoningEffort` is set: providers that
   * do not understand the field reject the whole request.
   */
  reasoning_effort?: string;
}

interface RequestSchema {
  name: string;
  schema: Record<string, unknown>;
}

/**
 * The single place a chat-completions body is assembled, so `suggestTags` and
 * `proposeTaxonomy` cannot drift on which optional fields they send.
 */
function buildRequestBody(
  config: AiProviderConfig,
  prompt: { system: string; user: string },
  schema: RequestSchema,
): ChatCompletionRequest {
  const body: ChatCompletionRequest = {
    model: config.model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: schema.name, strict: true, schema: schema.schema },
    },
  };
  if (config.reasoningEffort) {
    body.reasoning_effort = config.reasoningEffort;
  }
  return body;
}

const SUGGESTIONS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          bookmarkId: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          confidence: { type: ["number", "null"] },
          suggestedTitle: { type: ["string", "null"] },
        },
        required: ["bookmarkId", "tags", "confidence", "suggestedTitle"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

const TAXONOMY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: ["string", "null"] },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
    },
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          bookmarkId: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["bookmarkId", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["tags", "assignments"],
  additionalProperties: false,
};

/* ----------------------------------------------------------------- helpers */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function truncate(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function resolveChatCompletionsUrl(baseUrl: string | undefined): string {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}${CHAT_COMPLETIONS_PATH}`;
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}

/**
 * Read a response body without buffering more than `MAX_AI_RESPONSE_BYTES`.
 * A hostile or misconfigured provider must not be able to exhaust the worker's
 * memory by streaming an unbounded body at us.
 */
async function readTextCapped(response: Response): Promise<string> {
  const declared = Number(response.headers?.get?.("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_AI_RESPONSE_BYTES) {
    throw new AiProviderError(
      `AI provider response exceeded the ${MAX_AI_RESPONSE_BYTES}-byte limit.`,
      { status: response.status },
    );
  }

  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (text.length > MAX_AI_RESPONSE_BYTES) {
      throw new AiProviderError(
        `AI provider response exceeded the ${MAX_AI_RESPONSE_BYTES}-byte limit.`,
        { status: response.status },
      );
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > MAX_AI_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AiProviderError(
          `AI provider response exceeded the ${MAX_AI_RESPONSE_BYTES}-byte limit.`,
          { status: response.status },
        );
      }
      chunks.push(value);
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const text = (await readTextCapped(response)).trim();
    return text.length > 0 ? truncate(text) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Strip markdown code fences and surrounding prose, then parse the JSON body.
 * Some OpenAI-compatible servers wrap the structured output in ```json blocks.
 */
export function extractJsonContent(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

export function parseJsonContent(content: string): unknown {
  const json = extractJsonContent(content);
  try {
    return JSON.parse(json);
  } catch (cause) {
    throw new AiProviderError(`Failed to parse the AI response as JSON: ${truncate(content)}`, {
      cause,
    });
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const tag = item.trim();
      if (tag.length > 0) {
        tags.push(tag);
      }
    }
  }
  return tags;
}

function toTagSuggestion(value: unknown): TagSuggestion | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const bookmarkId = typeof record.bookmarkId === "string" ? record.bookmarkId.trim() : "";
  if (bookmarkId.length === 0) {
    return undefined;
  }
  const suggestion: TagSuggestion = { bookmarkId, tags: toStringArray(record.tags) };
  if (typeof record.confidence === "number" && Number.isFinite(record.confidence)) {
    suggestion.confidence = record.confidence;
  }
  if (typeof record.suggestedTitle === "string" && record.suggestedTitle.trim().length > 0) {
    suggestion.suggestedTitle = record.suggestedTitle.trim();
  }
  return suggestion;
}

function parseSuggestionsPayload(parsed: unknown): TagSuggestion[] {
  const payload = Array.isArray(parsed) ? { suggestions: parsed } : asRecord(parsed);
  const suggestions = payload?.suggestions;
  if (!Array.isArray(suggestions)) {
    throw new AiProviderError("AI response did not contain a `suggestions` array.");
  }
  const result: TagSuggestion[] = [];
  for (const item of suggestions) {
    const suggestion = toTagSuggestion(item);
    if (suggestion) {
      result.push(suggestion);
    }
  }
  return result;
}

function parseTaxonomyPayload(parsed: unknown): TaxonomyProposal {
  const record = asRecord(parsed);
  if (!record) {
    throw new AiProviderError("AI response was not a JSON object.");
  }
  const rawTags = record.tags;
  const rawAssignments = record.assignments;
  if (!Array.isArray(rawTags) || !Array.isArray(rawAssignments)) {
    throw new AiProviderError("AI response did not contain `tags` and `assignments` arrays.");
  }

  const tags: TaxonomyProposal["tags"] = [];
  for (const item of rawTags) {
    const tagRecord = asRecord(item);
    const name = typeof tagRecord?.name === "string" ? tagRecord.name.trim() : "";
    if (name.length === 0) {
      continue;
    }
    const tag: TaxonomyProposal["tags"][number] = { name };
    if (typeof tagRecord?.description === "string" && tagRecord.description.trim().length > 0) {
      tag.description = tagRecord.description.trim();
    }
    tags.push(tag);
  }

  const assignments: TaxonomyProposal["assignments"] = [];
  for (const item of rawAssignments) {
    const assignmentRecord = asRecord(item);
    const bookmarkId =
      typeof assignmentRecord?.bookmarkId === "string" ? assignmentRecord.bookmarkId.trim() : "";
    if (bookmarkId.length === 0) {
      continue;
    }
    assignments.push({ bookmarkId, tags: toStringArray(assignmentRecord?.tags) });
  }

  return { tags, assignments };
}

/* ---------------------------------------------------------------- transport */

function extractContentFromEnvelope(bodyText: string): string | undefined {
  let envelope: unknown;
  try {
    envelope = JSON.parse(bodyText);
  } catch (cause) {
    throw new AiProviderError("AI provider returned a non-JSON response body.", { cause });
  }
  const choices = asRecord(envelope)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const message = asRecord(asRecord(choices[0])?.message);
  const content = message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return undefined;
  }
  return content.trim();
}

async function completeChat(
  config: AiProviderConfig,
  fetchImpl: typeof fetch,
  body: ChatCompletionRequest,
): Promise<string> {
  const url = resolveChatCompletionsUrl(config.baseUrl);
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  };
  if (config.signal) {
    requestInit.signal = config.signal;
  }

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, requestInit);

    if (response.ok) {
      const content = extractContentFromEnvelope(await readTextCapped(response));
      if (content === undefined) {
        throw new AiProviderError("AI provider response did not contain any message content.", {
          status: response.status,
        });
      }
      return content;
    }

    if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    const detail = await readErrorMessage(response);
    const suffix = detail ? `: ${detail}` : "";
    throw new AiProviderError(
      `AI provider request failed with status ${response.status}${suffix}`,
      { status: response.status },
    );
  }
}

/* ----------------------------------------------------------------- provider */

/**
 * Provider for any server exposing the OpenAI chat-completions API with
 * `response_format: { type: "json_schema" }` (OpenAI, OpenRouter, Groq, local
 * llama.cpp/Ollama-style servers, ...).
 */
export function createOpenAiCompatibleProvider(config: AiProviderConfig): AiProvider {
  const fetchImpl = config.fetchImpl ?? fetch;

  async function suggestTags(
    bookmarks: BookmarkForAi[],
    existingTags: string[],
  ): Promise<TagSuggestion[]> {
    const suggestions: TagSuggestion[] = [];
    for (const batch of chunked(bookmarks, AI_BATCH_SIZE)) {
      const prompt = buildSuggestTagsPrompt(batch, existingTags);
      const body = buildRequestBody(config, prompt, {
        name: "tag_suggestions",
        schema: SUGGESTIONS_SCHEMA,
      });
      const content = await completeChat(config, fetchImpl, body);
      suggestions.push(...parseSuggestionsPayload(parseJsonContent(content)));
    }
    return suggestions;
  }

  async function proposeTaxonomy(
    bookmarks: BookmarkForAi[],
    existingTags: string[],
  ): Promise<TaxonomyProposal> {
    const proposals: TaxonomyProposal[] = [];
    for (const batch of chunked(bookmarks, AI_BATCH_SIZE)) {
      const prompt = buildProposeTaxonomyPrompt(batch, existingTags);
      const body = buildRequestBody(config, prompt, {
        name: "taxonomy_proposal",
        schema: TAXONOMY_SCHEMA,
      });
      const content = await completeChat(config, fetchImpl, body);
      proposals.push(parseTaxonomyPayload(parseJsonContent(content)));
    }
    return mergeProposals(proposals);
  }

  return { suggestTags, proposeTaxonomy };
}

function mergeProposals(proposals: TaxonomyProposal[]): TaxonomyProposal {
  const tags: TaxonomyProposal["tags"] = [];
  const seen = new Set<string>();
  const assignments: TaxonomyProposal["assignments"] = [];

  for (const proposal of proposals) {
    for (const tag of proposal.tags) {
      const key = tag.name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      tags.push(tag);
    }
    assignments.push(...proposal.assignments);
  }

  return { tags, assignments };
}
