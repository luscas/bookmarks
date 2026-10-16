import type {
  AiJobStatus,
  AiJobType,
  AiProviderId,
  BookmarkSource,
  ImportSource,
  TagKind,
  TagSource,
} from "@bookmarks/shared";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * D1/SQLite schema for the bookmark manager.
 *
 * Two families live side by side:
 *
 * 1. Better Auth tables (`user`, `session`, `account`, `verification`, `apikey`)
 *    mirror the schema the Better Auth CLI generates for SQLite/D1, including
 *    `integer(..., { mode: "timestamp_ms" })` date columns. Do not rename columns
 *    or change their types here without also updating the auth adapter.
 * 2. Application tables (`bookmarks`, `tags`, …). IDs are text and generated in
 *    application code (ULID/nanoid), never by the database; timestamps are
 *    integers holding milliseconds since the Unix epoch.
 *
 * The full-text search index over `bookmarks` is a raw FTS5 virtual table that
 * Drizzle cannot model, so it lives in `migrations/0001_fts5.sql` and is kept in
 * sync by SQL triggers.
 */

/** Current time as milliseconds since the Unix epoch, as a database default. */
const epochMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/* ------------------------------------------------------------------ Better Auth */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
});

/** Table added by the `@better-auth/api-key` plugin. */
export const apikey = sqliteTable("apikey", {
  id: text("id").primaryKey(),
  name: text("name"),
  start: text("start"),
  prefix: text("prefix"),
  key: text("key").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
  enabled: integer("enabled", { mode: "boolean" }).default(true),
  rateLimitEnabled: integer("rate_limit_enabled", { mode: "boolean" }).default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window").default(86_400_000),
  rateLimitMax: integer("rate_limit_max").default(10),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: integer("last_request", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  permissions: text("permissions"),
  metadata: text("metadata"),
});

/* ------------------------------------------------------------------- bookmarks */

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    urlHash: text("url_hash").notNull(),
    title: text("title"),
    description: text("description"),
    notes: text("notes"),
    faviconKey: text("favicon_key"),
    source: text("source").$type<BookmarkSource>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  },
  (table) => [
    unique("bookmarks_user_id_url_hash_unique").on(table.userId, table.urlHash),
    index("bookmarks_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

/* ------------------------------------------------------------------------ tags */

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color"),
    kind: text("kind").$type<TagKind>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  },
  (table) => [
    unique("tags_user_id_slug_unique").on(table.userId, table.slug),
    index("tags_user_id_idx").on(table.userId),
  ],
);

export const bookmarkTags = sqliteTable(
  "bookmark_tags",
  {
    bookmarkId: text("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: text("source").$type<TagSource>().notNull().default("manual"),
    confidence: real("confidence"),
  },
  (table) => [primaryKey({ columns: [table.bookmarkId, table.tagId] })],
);

/* --------------------------------------------------------------------- imports */

export const imports = sqliteTable("imports", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  source: text("source").$type<ImportSource>().notNull(),
  status: text("status").notNull(),
  total: integer("total").notNull().default(0),
  imported: integer("imported").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

/* -------------------------------------------------------------------------- ai */

export const aiSettings = sqliteTable("ai_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").$type<AiProviderId>().notNull(),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyIv: text("api_key_iv"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
});

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").$type<AiJobType>().notNull(),
    status: text("status").$type<AiJobStatus>().notNull(),
    /** JSON-encoded payload. */
    payload: text("payload").notNull(),
    /** JSON-encoded result, set when the job finishes successfully. */
    result: text("result"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(epochMs),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("ai_jobs_user_id_created_at_idx").on(table.userId, table.createdAt)],
);

/* ------------------------------------------------------------------ row types */

export type UserRow = typeof user.$inferSelect;
export type NewUserRow = typeof user.$inferInsert;

export type SessionRow = typeof session.$inferSelect;
export type NewSessionRow = typeof session.$inferInsert;

export type AccountRow = typeof account.$inferSelect;
export type NewAccountRow = typeof account.$inferInsert;

export type VerificationRow = typeof verification.$inferSelect;
export type NewVerificationRow = typeof verification.$inferInsert;

export type ApiKeyRow = typeof apikey.$inferSelect;
export type NewApiKeyRow = typeof apikey.$inferInsert;

export type BookmarkRow = typeof bookmarks.$inferSelect;
export type NewBookmarkRow = typeof bookmarks.$inferInsert;

export type TagRow = typeof tags.$inferSelect;
export type NewTagRow = typeof tags.$inferInsert;

export type BookmarkTagRow = typeof bookmarkTags.$inferSelect;
export type NewBookmarkTagRow = typeof bookmarkTags.$inferInsert;

export type ImportRow = typeof imports.$inferSelect;
export type NewImportRow = typeof imports.$inferInsert;

export type AiSettingsRow = typeof aiSettings.$inferSelect;
export type NewAiSettingsRow = typeof aiSettings.$inferInsert;

export type AiJobRow = typeof aiJobs.$inferSelect;
export type NewAiJobRow = typeof aiJobs.$inferInsert;
