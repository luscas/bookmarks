import {
  type Bookmark,
  type BookmarkSource,
  type BulkBookmarkItem,
  type CreateBookmarkInput,
  bookmarkSchema,
} from "@bookmarks/shared";
import { z } from "zod";
import { type Settings, isConfigured, readSettings } from "./settings";

/** A single field validation failure returned by the API. */
export interface FieldIssue {
  path: string;
  message: string;
}

/** Thrown when the extension has no server URL / API key yet. */
export class NotConfiguredError extends Error {
  constructor() {
    super("Extensão não configurada. Informe o servidor e a chave de API.");
    this.name = "NotConfiguredError";
  }
}

/** Thrown for any non-2xx response, or a transport failure. */
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

const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  username: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const meSchema = z.object({
  user: sessionUserSchema,
  counts: z.object({ bookmarks: z.number(), tags: z.number() }),
});
export type MeResponse = z.infer<typeof meSchema>;

const saveResponseSchema = z.object({
  bookmark: bookmarkSchema,
  created: z.boolean(),
});
export type SaveBookmarkResult = z.infer<typeof saveResponseSchema>;

export const bulkResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  bookmarkIds: z.array(z.string()),
});
export type BulkImportResult = z.infer<typeof bulkResultSchema>;

/** Human-readable fallback message for an HTTP status. */
export function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return "Requisição inválida.";
    case 401:
      return "Chave de API inválida ou expirada.";
    case 403:
      return "Sem permissão para esta ação.";
    case 404:
      return "Não encontrado.";
    case 409:
      return "Já existe um registro com esses dados.";
    case 413:
      return "O conteúdo é grande demais.";
    case 429:
      return "Muitas requisições. Aguarde um momento.";
    default:
      return "O servidor respondeu com um erro.";
  }
}

/**
 * Turn an HTTP status plus response body into a typed `ApiError`. Pure so it can
 * be unit-tested without `fetch` or `chrome`.
 */
export function mapApiError(status: number, body: unknown): ApiError {
  const parsed = errorBodySchema.safeParse(body);
  const data = parsed.success ? parsed.data : null;
  const message = data?.error?.message ?? data?.message ?? statusMessage(status);
  const issues = data?.error?.issues ?? [];
  return new ApiError(status, message, issues);
}

/**
 * Join a server URL and an API path: `("https://x.test/", "/me")` becomes
 * `https://x.test/api/me`. Pure so it can be unit-tested without `chrome`.
 */
export function apiUrl(serverUrl: string, path: string): string {
  const base = serverUrl.trim().replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}/api${suffix}`;
}

interface RequestOptions<T> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
}

export interface ApiClient {
  saveBookmark(input: CreateBookmarkInput): Promise<SaveBookmarkResult>;
  getMe(): Promise<MeResponse>;
  bulkImport(
    items: readonly BulkBookmarkItem[],
    source?: BookmarkSource,
  ): Promise<BulkImportResult>;
}

/**
 * Build a client bound to a set of settings. Kept separate from the top-level
 * helpers so tests can inject a fake server without touching `chrome.storage`.
 * The API key is only ever sent in the `Authorization` header — never logged.
 */
export function createApiClient(settings: Settings): ApiClient {
  async function request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }
    headers.set("authorization", `Bearer ${settings.apiKey}`);

    let response: Response;
    try {
      response = await fetch(apiUrl(settings.serverUrl, path), {
        method: options.method,
        headers,
        body,
      });
    } catch {
      throw new ApiError(0, "Não foi possível conectar ao servidor.");
    }

    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      throw mapApiError(response.status, payload);
    }

    let data: unknown;
    try {
      const text = await response.text();
      data = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      throw new ApiError(502, "O servidor retornou uma resposta inesperada.");
    }

    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError(502, "O servidor retornou uma resposta inesperada.");
    }
    return parsed.data;
  }

  return {
    saveBookmark(input: CreateBookmarkInput): Promise<SaveBookmarkResult> {
      return request("/bookmarks", { method: "POST", body: input, schema: saveResponseSchema });
    },
    getMe(): Promise<MeResponse> {
      return request("/me", { method: "GET", schema: meSchema });
    },
    bulkImport(
      items: readonly BulkBookmarkItem[],
      source: BookmarkSource = "import",
    ): Promise<BulkImportResult> {
      return request("/bookmarks/bulk", {
        method: "POST",
        body: { source, items },
        schema: bulkResultSchema,
      });
    },
  };
}

async function requireSettings(): Promise<Settings> {
  const settings = await readSettings();
  if (!isConfigured(settings)) {
    throw new NotConfiguredError();
  }
  return settings;
}

/* ------------------------------------------------------- top-level helpers */

export async function saveBookmark(input: CreateBookmarkInput): Promise<SaveBookmarkResult> {
  return createApiClient(await requireSettings()).saveBookmark(input);
}

export async function getMe(): Promise<MeResponse> {
  return createApiClient(await requireSettings()).getMe();
}

export async function bulkImport(
  items: readonly BulkBookmarkItem[],
  source: BookmarkSource = "import",
): Promise<BulkImportResult> {
  return createApiClient(await requireSettings()).bulkImport(items, source);
}

export type { Bookmark };
