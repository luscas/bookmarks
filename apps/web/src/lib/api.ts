import {
  type AiReasoningEffort,
  type Bookmark,
  type BookmarkPage,
  type BookmarkSort,
  type CreateBookmarkInput,
  type CreateTagInput,
  type MergeTagsInput,
  type Tag,
  type UpdateBookmarkInput,
  type UpdateTagInput,
  aiReasoningEffortEnum,
  aiSettingsInputSchema,
  bookmarkSchema,
  pageSchema,
  tagSchema,
  updateBookmarkSchema,
} from "@bookmarks/shared";
import { z } from "zod";

/**
 * Typed HTTP client for the bookmarks API.
 *
 * The app is served from the same Worker as the API, so every request is a
 * relative `/api/...` call with `credentials: "include"` (Better Auth cookie
 * sessions). Responses are validated with the `@bookmarks/shared` zod schemas
 * where they exist, and with local schemas for the responses owned by other
 * packages (imports, AI, Better Auth).
 *
 * A Hono RPC (`hc<AppType>`) client was considered, but importing `AppType`
 * drags the whole server graph (Cloudflare Workers types, Drizzle, Better Auth)
 * into the web typecheck and build. The hand-written wrapper below keeps the
 * web app decoupled from the server internals while still type-checking every
 * request and response.
 */

const API_BASE = "/api";

export interface FieldIssue {
  path: string;
  message: string;
}

/** Error thrown for any non-2xx response, or a transport failure. */
export class ApiError extends Error {
  readonly status: number;
  readonly issues: FieldIssue[];

  constructor(status: number, message: string, issues: FieldIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

/** Accepts both the server error shape and Better Auth's flat `{ message }`. */
const errorBodySchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    })
    .optional(),
  message: z.string().optional(),
});

function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return "Requisição inválida.";
    case 401:
      return "Sessão expirada. Entre novamente.";
    case 403:
      return "Você não tem permissão para esta ação.";
    case 404:
      return "Não encontrado.";
    case 409:
      return "Já existe um registro com esses dados.";
    case 413:
      return "O arquivo é grande demais.";
    case 429:
      return "Muitas requisições. Aguarde um momento.";
    default:
      return "Ocorreu um erro inesperado.";
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const result = errorBodySchema.safeParse(parsed);
  const body = result.success ? result.data : null;
  const message = body?.error?.message ?? body?.message ?? statusMessage(response.status);
  const issues = body?.error?.issues ?? [];
  return new ApiError(response.status, message, issues);
}

type QueryValue = string | number | boolean | undefined | null | readonly string[];

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

async function send(
  path: string,
  options: RequestOptions,
): Promise<{ response: Response; data: unknown }> {
  const headers = new Headers({ accept: "application/json" });
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "include",
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Não foi possível conectar ao servidor.");
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return { response, data: undefined };

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
  return { response, data };
}

/** Perform a request, optionally validating the JSON body with a zod schema. */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions & { schema: z.ZodType<T, z.ZodTypeDef, unknown> },
): Promise<T>;
export async function apiRequest<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
export async function apiRequest<T>(
  path: string,
  options: RequestOptions & { schema?: z.ZodType<T, z.ZodTypeDef, unknown> } = {},
): Promise<T> {
  const { data } = await send(path, options);
  if (options.schema) {
    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError(502, "O servidor retornou uma resposta inesperada.");
    }
    return parsed.data;
  }
  return data as T;
}

/* -------------------------------------------------------------- response schemas */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  username: string | null;
  image: string | null;
}

export interface MeResponse {
  user: SessionUser;
  counts: { bookmarks: number; tags: number };
}

const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  username: z.string().nullable().default(null),
  image: z.string().nullable().default(null),
});

const meResponseSchema = z.object({
  user: sessionUserSchema,
  counts: z.object({ bookmarks: z.number(), tags: z.number() }),
});

const createBookmarkResponseSchema = z.object({
  bookmark: bookmarkSchema,
  created: z.boolean(),
});

const bookmarkResponseSchema = z.object({ bookmark: bookmarkSchema });
const tagResponseSchema = z.object({ tag: tagSchema });
const tagListResponseSchema = z.object({ items: z.array(tagSchema) });

export interface ImportSummary {
  id: string;
  source: string;
  status: string;
  total: number;
  imported: number;
  skipped: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
}

const importSummarySchema = z.object({
  id: z.string(),
  source: z.string(),
  status: z.string(),
  total: z.number(),
  imported: z.number(),
  skipped: z.number(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  // Matches `aiJobSchema`: a missing field from an older payload reads as null.
  error: z.string().nullable().default(null),
});

export interface AiSettings {
  provider: string;
  model: string;
  baseUrl: string | null;
  reasoningEffort: AiReasoningEffort | null;
  hasApiKey: boolean;
  updatedAt: string;
}

const aiSettingsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string().nullable(),
  reasoningEffort: aiReasoningEffortEnum.nullable(),
  hasApiKey: z.boolean(),
  updatedAt: z.string(),
});

export type AiJobStatus = "queued" | "running" | "done" | "failed";

export interface AiJob {
  id: string;
  type: string;
  status: AiJobStatus;
  error: string | null;
  /** Present once the job has a result; shape depends on the job type. */
  result?: unknown;
  createdAt: string;
  finishedAt: string | null;
}

const aiJobSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["queued", "running", "done", "failed"]),
  error: z.string().nullable().default(null),
  result: z.unknown().default(undefined),
  createdAt: z.string(),
  finishedAt: z.string().nullable().default(null),
});

export interface ApiKeySummary {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  createdAt: string;
  lastRequest: string | null;
}

const apiKeySchema = z.object({
  id: z.string(),
  name: z.string().nullable().default(null),
  start: z.string().nullable().default(null),
  prefix: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  createdAt: z.string(),
  lastRequest: z.string().nullable().default(null),
});

const apiKeyListSchema = z.object({
  apiKeys: z.array(apiKeySchema),
});

const createdApiKeySchema = apiKeySchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

/* -------------------------------------------------------------- request params */

export interface ListBookmarksParams {
  q?: string;
  tag?: string[];
  sort?: BookmarkSort;
  cursor?: string;
  limit?: number;
}

export interface CreateImportParams {
  source: "html" | "chrome-json";
  html?: string;
  autoTag?: boolean;
}

export type AiSettingsInput = z.input<typeof aiSettingsInputSchema>;
export { aiSettingsInputSchema, type Bookmark, type BookmarkPage, type Tag };
export { updateBookmarkSchema };
export type { CreateBookmarkInput, CreateTagInput, MergeTagsInput, UpdateBookmarkInput };

/* ------------------------------------------------------------------ the client */

export const api = {
  auth: {
    signInEmail(input: { email: string; password: string }): Promise<unknown> {
      return apiRequest("/auth/sign-in/email", { method: "POST", body: input });
    },
    signUpEmail(input: {
      email: string;
      password: string;
      name: string;
      username: string;
    }): Promise<unknown> {
      return apiRequest("/auth/sign-up/email", { method: "POST", body: input });
    },
    signOut(): Promise<unknown> {
      return apiRequest("/auth/sign-out", { method: "POST" });
    },
  },

  me: {
    get(): Promise<MeResponse> {
      return apiRequest("/me", { schema: meResponseSchema });
    },
    updateProfile(name: string): Promise<MeResponse> {
      return apiRequest("/me", { method: "PATCH", body: { name }, schema: meResponseSchema });
    },
  },

  bookmarks: {
    list(params: ListBookmarksParams): Promise<BookmarkPage> {
      return apiRequest("/bookmarks", {
        query: {
          q: params.q,
          tag: params.tag,
          sort: params.sort,
          cursor: params.cursor,
          limit: params.limit,
        },
        schema: pageSchema,
      });
    },
    create(input: CreateBookmarkInput): Promise<{ bookmark: Bookmark; created: boolean }> {
      return apiRequest("/bookmarks", {
        method: "POST",
        body: input,
        schema: createBookmarkResponseSchema,
      });
    },
    update(id: string, input: UpdateBookmarkInput): Promise<{ bookmark: Bookmark }> {
      return apiRequest(`/bookmarks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: input,
        schema: bookmarkResponseSchema,
      });
    },
    setTags(id: string, tags: string[]): Promise<{ bookmark: Bookmark }> {
      return apiRequest(`/bookmarks/${encodeURIComponent(id)}/tags`, {
        method: "PUT",
        body: { tags },
        schema: bookmarkResponseSchema,
      });
    },
    remove(id: string): Promise<void> {
      return apiRequest(`/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  },

  tags: {
    list(): Promise<Tag[]> {
      return apiRequest("/tags", { schema: tagListResponseSchema }).then((data) => data.items);
    },
    create(input: CreateTagInput): Promise<Tag> {
      return apiRequest("/tags", { method: "POST", body: input, schema: tagResponseSchema }).then(
        (data) => data.tag,
      );
    },
    update(id: string, input: UpdateTagInput): Promise<Tag> {
      return apiRequest(`/tags/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: input,
        schema: tagResponseSchema,
      }).then((data) => data.tag);
    },
    merge(input: MergeTagsInput): Promise<Tag> {
      return apiRequest("/tags/merge", {
        method: "POST",
        body: input,
        schema: tagResponseSchema,
      }).then((data) => data.tag);
    },
    remove(id: string): Promise<void> {
      return apiRequest(`/tags/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  },

  imports: {
    list(): Promise<ImportSummary[]> {
      return apiRequest<{ items: ImportSummary[] }>("/imports", {
        schema: z.object({ items: z.array(importSummarySchema) }),
      }).then((data) => data.items);
    },
    create(params: CreateImportParams): Promise<ImportSummary> {
      return apiRequest("/imports", {
        method: "POST",
        body: {
          source: params.source,
          ...(params.html !== undefined ? { html: params.html } : {}),
          // Omit when undefined so the server can apply its own default (in
          // development it triggers local AI tagging on import).
          ...(params.autoTag !== undefined ? { autoTag: params.autoTag } : {}),
        },
        schema: z.object({ import: importSummarySchema }),
      }).then((data) => data.import);
    },
    get(id: string): Promise<ImportSummary> {
      return apiRequest(`/imports/${encodeURIComponent(id)}`, {
        schema: z.object({ import: importSummarySchema }),
      }).then((data) => data.import);
    },
  },

  ai: {
    getSettings(): Promise<{ settings: AiSettings | null; autoTagByDefault: boolean }> {
      return apiRequest("/ai/settings", {
        schema: z.object({
          settings: aiSettingsSchema.nullable(),
          // Dev-only default for the import checkbox; `false` in production.
          autoTagByDefault: z.boolean(),
        }),
      });
    },
    saveSettings(input: AiSettingsInput): Promise<AiSettings> {
      return apiRequest("/ai/settings", {
        method: "PUT",
        body: input,
        schema: z.object({ settings: aiSettingsSchema }),
      }).then((data) => data.settings);
    },
    organize(scope: "untagged" | "all"): Promise<string> {
      return apiRequest("/ai/organize", {
        method: "POST",
        body: { scope },
        schema: z.object({ jobId: z.string() }),
      }).then((data) => data.jobId);
    },
    tag(bookmarkIds: string[]): Promise<string> {
      return apiRequest("/ai/tags", {
        method: "POST",
        body: { bookmarkIds },
        schema: z.object({ jobId: z.string() }),
      }).then((data) => data.jobId);
    },
    getJob(id: string): Promise<AiJob> {
      return apiRequest(`/ai/jobs/${encodeURIComponent(id)}`, {
        schema: z.object({ job: aiJobSchema }),
      }).then((data) => data.job);
    },
  },

  apiKeys: {
    list(): Promise<ApiKeySummary[]> {
      return apiRequest("/me/api-keys", { schema: apiKeyListSchema }).then((data) => data.apiKeys);
    },
    create(name: string): Promise<CreatedApiKey> {
      return apiRequest("/me/api-keys", {
        method: "POST",
        body: { name },
        schema: createdApiKeySchema,
      });
    },
    remove(id: string): Promise<void> {
      return apiRequest(`/me/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  },
};

export type ApiClient = typeof api;
