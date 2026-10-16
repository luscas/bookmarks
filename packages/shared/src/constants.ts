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
