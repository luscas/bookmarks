/**
 * Migration bookkeeping and runtime application.
 *
 * Drizzle-kit owns the baseline SQL in `migrations/`. FTS5 lives in its own
 * numbered file (`0001_fts5.sql`) because Drizzle has no concept of virtual
 * tables. A Cloudflare Worker cannot read files from disk, so the SQL is also
 * embedded here and applied by {@link runMigrations}. `migrations.test.ts`
 * asserts the embedded strings stay in sync with the files on disk.
 *
 * The `.sql` files are always driven forward by `drizzle-kit generate`; the base
 * file name below must be updated when a new baseline is generated. Note that a
 * future `drizzle-kit generate` will pick the next numeric prefix (0001) and can
 * collide with the hand-written FTS migration; renumber that baseline if so.
 *
 * D1 has no multi-statement transaction, so `runMigrations` applies statements
 * sequentially. Statements are rewritten to `CREATE ... IF NOT EXISTS`, which
 * makes applying an already-applied migration a no-op. `ALTER TABLE` is the one
 * exception (SQLite does not support `ADD COLUMN IF NOT EXISTS`); migrations
 * using it must be guarded by the caller.
 */

export interface Migration {
  /** File name as it appears in `migrations/`. */
  readonly name: string;
  /** Full SQL contents of the file. */
  readonly sql: string;
}

/** Statement separator emitted by drizzle-kit. */
export const MIGRATION_BREAKPOINT = "--> statement-breakpoint";

/**
 * Ordered migrations. Order is significant: the baseline creates the tables the
 * FTS5 migration attaches to.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    name: "0000_dusty_meggan.sql",
    sql: `CREATE TABLE \`account\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`account_id\` text NOT NULL,
	\`provider_id\` text NOT NULL,
	\`user_id\` text NOT NULL,
	\`access_token\` text,
	\`refresh_token\` text,
	\`id_token\` text,
	\`access_token_expires_at\` integer,
	\`refresh_token_expires_at\` integer,
	\`scope\` text,
	\`password\` text,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`updated_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`ai_jobs\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`type\` text NOT NULL,
	\`status\` text NOT NULL,
	\`payload\` text NOT NULL,
	\`result\` text,
	\`error\` text,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`finished_at\` integer,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`ai_jobs_user_id_created_at_idx\` ON \`ai_jobs\` (\`user_id\`,\`created_at\`);--> statement-breakpoint
CREATE TABLE \`ai_settings\` (
	\`user_id\` text PRIMARY KEY NOT NULL,
	\`provider\` text NOT NULL,
	\`model\` text NOT NULL,
	\`base_url\` text,
	\`api_key_ciphertext\` text,
	\`api_key_iv\` text,
	\`updated_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`apikey\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`config_id\` text DEFAULT 'default' NOT NULL,
	\`name\` text,
	\`start\` text,
	\`prefix\` text,
	\`key\` text NOT NULL,
	\`reference_id\` text NOT NULL,
	\`refill_interval\` integer,
	\`refill_amount\` integer,
	\`last_refill_at\` integer,
	\`enabled\` integer DEFAULT true,
	\`rate_limit_enabled\` integer DEFAULT true,
	\`rate_limit_time_window\` integer DEFAULT 86400000,
	\`rate_limit_max\` integer DEFAULT 10,
	\`request_count\` integer DEFAULT 0,
	\`remaining\` integer,
	\`last_request\` integer,
	\`expires_at\` integer,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`updated_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`permissions\` text,
	\`metadata\` text,
	FOREIGN KEY (\`reference_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`apikey_key_unique\` ON \`apikey\` (\`key\`);--> statement-breakpoint
CREATE INDEX \`apikey_reference_id_idx\` ON \`apikey\` (\`reference_id\`);--> statement-breakpoint
CREATE INDEX \`apikey_config_id_idx\` ON \`apikey\` (\`config_id\`);--> statement-breakpoint
CREATE TABLE \`bookmark_tags\` (
	\`bookmark_id\` text NOT NULL,
	\`tag_id\` text NOT NULL,
	\`source\` text DEFAULT 'manual' NOT NULL,
	\`confidence\` real,
	PRIMARY KEY(\`bookmark_id\`, \`tag_id\`),
	FOREIGN KEY (\`bookmark_id\`) REFERENCES \`bookmarks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`tag_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`bookmarks\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`url\` text NOT NULL,
	\`normalized_url\` text NOT NULL,
	\`url_hash\` text NOT NULL,
	\`title\` text,
	\`description\` text,
	\`notes\` text,
	\`favicon_key\` text,
	\`source\` text NOT NULL,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`updated_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`bookmarks_user_id_created_at_idx\` ON \`bookmarks\` (\`user_id\`,\`created_at\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`bookmarks_user_id_url_hash_unique\` ON \`bookmarks\` (\`user_id\`,\`url_hash\`);--> statement-breakpoint
CREATE TABLE \`imports\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`source\` text NOT NULL,
	\`status\` text NOT NULL,
	\`total\` integer DEFAULT 0 NOT NULL,
	\`imported\` integer DEFAULT 0 NOT NULL,
	\`skipped\` integer DEFAULT 0 NOT NULL,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`finished_at\` integer,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`session\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`expires_at\` integer NOT NULL,
	\`token\` text NOT NULL,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`updated_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`ip_address\` text,
	\`user_agent\` text,
	\`user_id\` text NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`session_token_unique\` ON \`session\` (\`token\`);--> statement-breakpoint
CREATE TABLE \`tags\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`name\` text NOT NULL,
	\`slug\` text NOT NULL,
	\`color\` text,
	\`kind\` text NOT NULL,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`tags_user_id_idx\` ON \`tags\` (\`user_id\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`tags_user_id_slug_unique\` ON \`tags\` (\`user_id\`,\`slug\`);--> statement-breakpoint
CREATE TABLE \`user\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`email\` text NOT NULL,
	\`email_verified\` integer NOT NULL,
	\`image\` text,
	\`username\` text,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`updated_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`user_email_unique\` ON \`user\` (\`email\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`user_username_unique\` ON \`user\` (\`username\`);--> statement-breakpoint
CREATE TABLE \`verification\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`identifier\` text NOT NULL,
	\`value\` text NOT NULL,
	\`expires_at\` integer NOT NULL,
	\`created_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	\`updated_at\` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);`,
  },
  {
    name: "0001_fts5.sql",
    sql: `CREATE VIRTUAL TABLE IF NOT EXISTS \`bookmarks_fts\` USING fts5(
	\`title\`,
	\`description\`,
	\`notes\`,
	\`url\`,
	content='bookmarks',
	content_rowid='rowid',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS \`bookmarks_fts_ai\` AFTER INSERT ON \`bookmarks\` BEGIN
	INSERT INTO \`bookmarks_fts\`(\`rowid\`, \`title\`, \`description\`, \`notes\`, \`url\`)
	VALUES (new.\`rowid\`, new.\`title\`, new.\`description\`, new.\`notes\`, new.\`url\`);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS \`bookmarks_fts_ad\` AFTER DELETE ON \`bookmarks\` BEGIN
	INSERT INTO \`bookmarks_fts\`(\`bookmarks_fts\`, \`rowid\`, \`title\`, \`description\`, \`notes\`, \`url\`)
	VALUES ('delete', old.\`rowid\`, old.\`title\`, old.\`description\`, old.\`notes\`, old.\`url\`);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS \`bookmarks_fts_au\` AFTER UPDATE ON \`bookmarks\` BEGIN
	INSERT INTO \`bookmarks_fts\`(\`bookmarks_fts\`, \`rowid\`, \`title\`, \`description\`, \`notes\`, \`url\`)
	VALUES ('delete', old.\`rowid\`, old.\`title\`, old.\`description\`, old.\`notes\`, old.\`url\`);
	INSERT INTO \`bookmarks_fts\`(\`rowid\`, \`title\`, \`description\`, \`notes\`, \`url\`)
	VALUES (new.\`rowid\`, new.\`title\`, new.\`description\`, new.\`notes\`, new.\`url\`);
END;
--> statement-breakpoint
INSERT INTO \`bookmarks_fts\`(\`bookmarks_fts\`) VALUES ('rebuild');`,
  },
];

/** Ordered migration file names, for verifying that every file is accounted for. */
export const MIGRATION_FILES: readonly string[] = MIGRATIONS.map((migration) => migration.name);

/** Minimal surface `runMigrations` needs; satisfied by D1 and better-sqlite3. */
export interface MigrationExecutor {
  exec(sql: string): unknown;
}

/** Split a migration file into individual executable statements. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const CREATE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^CREATE UNIQUE INDEX\s+(?!IF NOT EXISTS\b)/i, "CREATE UNIQUE INDEX IF NOT EXISTS "],
  [/^CREATE INDEX\s+(?!IF NOT EXISTS\b)/i, "CREATE INDEX IF NOT EXISTS "],
  [/^CREATE VIRTUAL TABLE\s+(?!IF NOT EXISTS\b)/i, "CREATE VIRTUAL TABLE IF NOT EXISTS "],
  [/^CREATE TABLE\s+(?!IF NOT EXISTS\b)/i, "CREATE TABLE IF NOT EXISTS "],
  [/^CREATE TRIGGER\s+(?!IF NOT EXISTS\b)/i, "CREATE TRIGGER IF NOT EXISTS "],
];

/**
 * Rewrite a `CREATE` statement to its `IF NOT EXISTS` form so migrations can be
 * applied more than once. Non-`CREATE` statements are returned unchanged.
 */
export function makeIdempotent(statement: string): string {
  let result = statement;
  for (const [pattern, replacement] of CREATE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Apply every migration in order. Safe to call repeatedly for `CREATE`-only
 * migrations. Errors propagate; D1 has no cross-statement transaction, so a
 * failure leaves already-applied statements in place.
 */
export async function runMigrations(
  executor: MigrationExecutor,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  for (const migration of migrations) {
    for (const statement of splitStatements(migration.sql)) {
      await executor.exec(makeIdempotent(statement));
    }
  }
}
