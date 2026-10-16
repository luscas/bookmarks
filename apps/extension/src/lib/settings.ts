import { z } from "zod";

/**
 * Settings live in `chrome.storage.local`:
 *
 * - `serverUrl` — base URL of the user's self-hosted instance, e.g.
 *   `https://favoritos.exemplo.com` (never hardcoded in the manifest);
 * - `apiKey` — key created from the web app's `/settings/api-keys` screen.
 *
 * The server accepts the key as `Authorization: Bearer <key>`.
 */
export const settingsSchema = z.object({
  serverUrl: z
    .string()
    .trim()
    .min(1, "Informe a URL do servidor.")
    .url("Informe uma URL válida (ex.: https://favoritos.exemplo.com)."),
  apiKey: z.string().trim().min(1, "Informe a chave de API."),
});

export type Settings = z.infer<typeof settingsSchema>;

export const EMPTY_SETTINGS: Settings = { serverUrl: "", apiKey: "" };

/** Stored values may be absent (first run) or stale; read them leniently. */
const storedSettingsSchema = z.object({
  serverUrl: z.string().optional().default(""),
  apiKey: z.string().optional().default(""),
});

/** Coerce whatever came out of storage into a `Settings` object. */
export function parseSettings(raw: unknown): Settings {
  const parsed = storedSettingsSchema.safeParse(raw ?? {});
  const value = parsed.success ? parsed.data : { serverUrl: "", apiKey: "" };
  return { serverUrl: value.serverUrl.trim(), apiKey: value.apiKey.trim() };
}

/** True when both fields are present, i.e. the API client can be used. */
export function isConfigured(settings: Settings): boolean {
  return settings.serverUrl.length > 0 && settings.apiKey.length > 0;
}

/** Validation messages for the options form; empty when the input is valid. */
export function settingsIssues(input: Partial<Settings>): string[] {
  const result = settingsSchema.safeParse(input);
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => issue.message);
}

/** Read and normalize the settings from `chrome.storage.local`. */
export async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["serverUrl", "apiKey"]);
  return parseSettings(stored);
}

/** Validate and persist settings. Throws a `ZodError` when the input is invalid. */
export async function writeSettings(input: Settings): Promise<Settings> {
  const parsed = settingsSchema.parse(input);
  const settings: Settings = { serverUrl: parsed.serverUrl, apiKey: parsed.apiKey };
  await chrome.storage.local.set(settings);
  return settings;
}

/**
 * The host match pattern for a server URL, or `null` when the URL is not a
 * valid http(s) origin. Used for the optional host permission.
 *
 * Chrome match patterns have no concept of a port (`url.origin` would include
 * `:8787` and be rejected), and a pattern without a port matches every port,
 * so the hostname alone is the correct value.
 */
export function originPattern(serverUrl: string): string | null {
  try {
    const url = new URL(serverUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

/**
 * Ask the user to grant access to their own server. Must be called from a user
 * gesture (a click). Returns `true` when the permission is granted.
 */
export async function requestHostPermission(serverUrl: string): Promise<boolean> {
  const pattern = originPattern(serverUrl);
  if (!pattern) {
    return false;
  }
  const alreadyGranted = await chrome.permissions.contains({ origins: [pattern] });
  if (alreadyGranted) {
    return true;
  }
  return chrome.permissions.request({ origins: [pattern] });
}
