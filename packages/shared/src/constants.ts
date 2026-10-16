/**
 * Tuning knobs shared across apps and packages. Keep these in one place so the
 * server, the web app and the extension never disagree on limits.
 */

/** Hard cap on tags attached to a single bookmark. */
export const MAX_TAGS_PER_BOOKMARK = 12;

/** How many bookmarks the AI sees in a single provider call. */
export const AI_BATCH_SIZE = 20;

/** How many bookmarks the extension pushes in one bulk request. */
export const BULK_IMPORT_CHUNK_SIZE = 200;

/** Default page size for cursor-paginated bookmark listings. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Max accepted size for an uploaded Netscape bookmarks HTML export (10 MiB). */
export const MAX_IMPORT_HTML_BYTES = 10 * 1024 * 1024;

/**
 * Default cap on a parsed JSON request body (1 MiB) enforced before and while
 * reading, so an oversized payload can never reach `JSON.parse`. The import
 * route overrides it with `MAX_IMPORT_HTML_BYTES`.
 */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/**
 * Cap on `/api/auth/*` request bodies (64 KiB). Auth payloads (credentials,
 * profile fields) are tiny JSON documents, so anything larger is waste or
 * abuse; reading the body through this cap keeps oversized payloads from ever
 * reaching Better Auth's parser.
 */
export const MAX_AUTH_BODY_BYTES = 64 * 1024;

/** Max length of a stored tag name (manual path and AI suggestions alike). */
export const MAX_TAG_NAME_LENGTH = 100;

/** Max number of items accepted in a single import request. */
export const MAX_IMPORT_ITEMS = 20_000;

/** Max length of a stored URL (generous enough for signed/query-heavy links). */
export const MAX_URL_LENGTH = 8192;

/** Max length of a search query (`q`) accepted by the list endpoint. */
export const MAX_SEARCH_QUERY_LENGTH = 200;

/** Max length of an opaque pagination cursor accepted on the list endpoint. */
export const MAX_CURSOR_LENGTH = 4096;

/** Max length of an AI provider API key accepted by the settings endpoint. */
export const MAX_AI_API_KEY_LENGTH = 512;

/** Max folder nesting depth accepted from a browser bookmark export. */
export const MAX_FOLDER_PATH_DEPTH = 32;

/** Max length of a single folder name segment. */
export const MAX_FOLDER_SEGMENT_LENGTH = 256;

/** Max bytes downloaded when caching a favicon (256 KiB). */
export const MAX_FAVICON_BYTES = 256 * 1024;

/** Max bytes read while discovering an icon URL from a host's HTML (256 KiB). */
export const MAX_FAVICON_HTML_BYTES = 256 * 1024;

/** Max bytes read from an AI provider's response body (1 MiB). */
export const MAX_AI_RESPONSE_BYTES = 1024 * 1024;

/**
 * API-key rate limit applied per key by the Better Auth `apiKey` plugin. The
 * plugin defaults to 10 requests per 24h, which throttles the browser extension
 * to a handful of saves per day; allow a generous hourly burst instead. These
 * values are shared with the `apikey` table column defaults so both stay aligned.
 */
export const API_KEY_RATE_LIMIT_MAX = 5000;
export const API_KEY_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
