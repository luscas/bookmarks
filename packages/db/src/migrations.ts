/**
 * Migration bookkeeping and runtime application.
 *
 * Drizzle-kit owns the SQL in `migrations/`; FTS5 lives in its own hand-written
 * file (`0001_fts5.sql`) because Drizzle has no concept of virtual tables. A
 * Cloudflare Worker cannot read files from disk, so the SQL is embedded here and
 * applied by {@link runMigrations}. `migrations.test.ts` asserts that the
 * embedded strings stay in sync with the files on disk and that every `.sql`
 * file in the directory is accounted for.
 *
 * `drizzle-kit generate` numbers new files from the journal's last `idx`, so a
 * generated file can collide with a hand-written one; renumber the generated
 * file (and its `_journal.json` tag) when that happens.
 *
 * `runMigrations` records each applied migration in the `__migrations` control
 * table and skips anything already recorded, so non-idempotent migrations
 * (`ALTER TABLE`, table rebuilds) run exactly once. Statements are still
 * rewritten to `CREATE ... IF NOT EXISTS` as a resume aid after a partial
 * failure. D1 has no multi-statement transaction, so a failure mid-migration
 * leaves earlier statements applied and the migration *unrecorded*; the next run
 * resumes it from the top. Errors propagate.
 */

export interface Migration {
  /** File name as it appears in `migrations/`. */
  readonly name: string;
  /** Full SQL contents of the file. */
  readonly sql: string;
}

/** Statement separator emitted by drizzle-kit. */
export const MIGRATION_BREAKPOINT = "--> statement-breakpoint";

/** Control table recording which migrations have already been applied. */
export const MIGRATIONS_TABLE = "__migrations";

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
  {
    name: "0002_api_key_rate_limit.sql",
    sql: `PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE \`__new_apikey\` (
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
	\`rate_limit_time_window\` integer DEFAULT 3600000,
	\`rate_limit_max\` integer DEFAULT 5000,
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
INSERT INTO \`__new_apikey\`("id", "config_id", "name", "start", "prefix", "key", "reference_id", "refill_interval", "refill_amount", "last_refill_at", "enabled", "rate_limit_enabled", "rate_limit_time_window", "rate_limit_max", "request_count", "remaining", "last_request", "expires_at", "created_at", "updated_at", "permissions", "metadata") SELECT "id", "config_id", "name", "start", "prefix", "key", "reference_id", "refill_interval", "refill_amount", "last_refill_at", "enabled", "rate_limit_enabled", "rate_limit_time_window", "rate_limit_max", "request_count", "remaining", "last_request", "expires_at", "created_at", "updated_at", "permissions", "metadata" FROM \`apikey\`;--> statement-breakpoint
DROP TABLE \`apikey\`;--> statement-breakpoint
ALTER TABLE \`__new_apikey\` RENAME TO \`apikey\`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX \`apikey_key_unique\` ON \`apikey\` (\`key\`);--> statement-breakpoint
CREATE INDEX \`apikey_reference_id_idx\` ON \`apikey\` (\`reference_id\`);--> statement-breakpoint
CREATE INDEX \`apikey_config_id_idx\` ON \`apikey\` (\`config_id\`);`,
  },
  {
    name: "0003_import_error.sql",
    sql: "ALTER TABLE `imports` ADD `error` text;",
  },
  {
    name: "0004_ai_reasoning_effort.sql",
    sql: "ALTER TABLE `ai_settings` ADD COLUMN `reasoning_effort` text;",
  },
];

/** Ordered migration file names, for verifying that every file is accounted for. */
export const MIGRATION_FILES: readonly string[] = MIGRATIONS.map((migration) => migration.name);

/**
 * Minimal surface `runMigrations` needs. Both Cloudflare D1 and better-sqlite3
 * satisfy it with a thin adapter:
 *
 *   D1:      { exec: (sql) => db.exec(sql), all: (sql) => db.prepare(sql).all().results }
 *   sqlite3: { exec: (sql) => db.exec(sql), all: (sql) => db.prepare(sql).all() }
 */
export interface MigrationExecutor {
  /** Execute a single raw statement. */
  exec(sql: string): unknown;
  /** Run a single read-only statement and return its rows. */
  all(sql: string): unknown[] | Promise<unknown[]>;
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
 * Rewrite a `CREATE` statement to its `IF NOT EXISTS` form. This is only a
 * resume aid for a partially applied migration: exactly-once application is
 * guaranteed by the `__migrations` control table, not by this rewriting.
 * Non-`CREATE` statements are returned unchanged.
 */
export function makeIdempotent(statement: string): string {
  let result = statement;
  for (const [pattern, replacement] of CREATE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Quote a value as a SQL string literal. Names come from this module, not users. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Names recorded in `__migrations`, created on demand by {@link runMigrations}. */
export async function appliedMigrations(executor: MigrationExecutor): Promise<Set<string>> {
  const rows = await executor.all(`SELECT \`name\` FROM \`${MIGRATIONS_TABLE}\`;`);
  const applied = new Set<string>();
  for (const row of rows) {
    const name = (row as { name?: unknown } | null)?.name;
    if (typeof name === "string") {
      applied.add(name);
    }
  }
  return applied;
}

/**
 * Apply every migration exactly once, in order, recording each name in
 * `__migrations`. The control table is what makes non-idempotent migrations
 * (table rebuilds, `ALTER TABLE`) safe to re-run; an already-recorded migration
 * is skipped entirely. Errors propagate.
 */
export async function runMigrations(
  executor: MigrationExecutor,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  await executor.exec(
    `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (\`name\` text PRIMARY KEY NOT NULL, \`applied_at\` integer NOT NULL);`,
  );

  const applied = await appliedMigrations(executor);
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue;
    }
    for (const statement of splitStatements(migration.sql)) {
      await executor.exec(makeIdempotent(statement));
    }
    await executor.exec(
      `INSERT INTO \`${MIGRATIONS_TABLE}\` (\`name\`, \`applied_at\`) VALUES (${sqlLiteral(migration.name)}, ${Date.now()});`,
    );
  }
}
