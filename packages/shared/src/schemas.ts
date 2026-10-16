import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_TAGS_PER_BOOKMARK } from "./constants.js";

/* ------------------------------------------------------------------ enums */

export const bookmarkSourceEnum = z.enum(["manual", "import"]);
export type BookmarkSource = z.infer<typeof bookmarkSourceEnum>;

export const tagKindEnum = z.enum(["manual", "ai", "import"]);
export type TagKind = z.infer<typeof tagKindEnum>;

export const tagSourceEnum = z.enum(["manual", "ai"]);
export type TagSource = z.infer<typeof tagSourceEnum>;

/**
 * Only `openai-compatible` ships in phase 1: it covers OpenAI, OpenRouter,
 * Groq and any local server exposing the same chat-completions API.
 */
export const aiProviderEnum = z.enum(["openai-compatible"]);
export type AiProviderId = z.infer<typeof aiProviderEnum>;

export const importSourceEnum = z.enum(["chrome-json", "html"]);
export type ImportSource = z.infer<typeof importSourceEnum>;

export const aiJobTypeEnum = z.enum(["tag_bookmarks", "organize_taxonomy"]);
export type AiJobType = z.infer<typeof aiJobTypeEnum>;

export const aiJobStatusEnum = z.enum(["queued", "running", "done", "failed"]);
export type AiJobStatus = z.infer<typeof aiJobStatusEnum>;

/* -------------------------------------------------------------- bookmarks */

export const createBookmarkSchema = z.object({
  url: z.string().trim().min(1, "url is required"),
  title: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1)).max(MAX_TAGS_PER_BOOKMARK).optional(),
});
export type CreateBookmarkInput = z.infer<typeof createBookmarkSchema>;

export const bulkBookmarkItemSchema = z.object({
  url: z.string().trim().min(1),
  title: z.string().trim().max(500).optional(),
  /** Folder path from the browser, e.g. ["Bookmarks Bar", "Dev", "React"]. */
  folderPath: z.array(z.string()).optional(),
  /** When set, skip these folders becoming tags. */
  addedAt: z.string().optional(),
});
export type BulkBookmarkItem = z.infer<typeof bulkBookmarkItemSchema>;

export const bulkBookmarksSchema = z.object({
  source: bookmarkSourceEnum.default("import"),
  items: z.array(bulkBookmarkItemSchema).min(1).max(1000),
});
export type BulkBookmarksInput = z.infer<typeof bulkBookmarksSchema>;

export const updateBookmarkSchema = z
  .object({
    title: z.string().trim().max(500).nullable(),
    description: z.string().trim().max(2000).nullable(),
    notes: z.string().trim().max(5000).nullable(),
  })
  .partial();
export type UpdateBookmarkInput = z.infer<typeof updateBookmarkSchema>;

export const setBookmarkTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1)).max(MAX_TAGS_PER_BOOKMARK),
});
export type SetBookmarkTagsInput = z.infer<typeof setBookmarkTagsSchema>;

export const bookmarkSortEnum = z.enum(["createdAt", "updatedAt", "title"]);
export type BookmarkSort = z.infer<typeof bookmarkSortEnum>;

export const listBookmarksQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  tag: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  sort: bookmarkSortEnum.default("createdAt"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListBookmarksQuery = z.infer<typeof listBookmarksQuerySchema>;

/* ------------------------------------------------------------------- tags */

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex value such as #7c3aed")
    .optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
  })
  .partial();
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export const mergeTagsSchema = z.object({
  sourceTagIds: z.array(z.string().min(1)).min(1),
  targetTagId: z.string().min(1),
});
export type MergeTagsInput = z.infer<typeof mergeTagsSchema>;

/* ------------------------------------------------------------------ import */

export const createImportSchema = z
  .object({
    source: importSourceEnum,
    items: z.array(bulkBookmarkItemSchema).optional(),
    html: z.string().optional(),
    /** Enqueue AI tagging for everything the import creates. */
    autoTag: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.items?.length || value.html), {
    message: "Provide either `items` or `html`",
    path: ["items"],
  });
export type CreateImportInput = z.infer<typeof createImportSchema>;

/* ---------------------------------------------------------------------- ai */

export const aiSettingsInputSchema = z.object({
  provider: aiProviderEnum,
  model: z.string().trim().min(1).max(200),
  baseUrl: z.string().url().optional(),
  /** Omit to keep the stored key unchanged. */
  apiKey: z.string().trim().min(1).optional(),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

export const aiTagRequestSchema = z.object({
  bookmarkIds: z.array(z.string().min(1)).min(1).max(1000),
});
export type AiTagRequestInput = z.infer<typeof aiTagRequestSchema>;

export const aiOrganizeRequestSchema = z.object({
  scope: z.enum(["untagged", "all"]).default("untagged"),
});
export type AiOrganizeRequestInput = z.infer<typeof aiOrganizeRequestSchema>;

/* -------------------------------------------------------------- responses */

export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string().nullable(),
  kind: tagKindEnum,
  bookmarkCount: z.number().int().nonnegative().optional(),
});
export type Tag = z.infer<typeof tagSchema>;

export const bookmarkSchema = z.object({
  id: z.string(),
  url: z.string(),
  normalizedUrl: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  source: bookmarkSourceEnum,
  tags: z.array(tagSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Bookmark = z.infer<typeof bookmarkSchema>;

export const pageSchema = z.object({
  items: z.array(bookmarkSchema),
  nextCursor: z.string().nullable(),
});
export type BookmarkPage = z.infer<typeof pageSchema>;
