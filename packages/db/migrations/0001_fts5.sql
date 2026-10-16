CREATE VIRTUAL TABLE IF NOT EXISTS `bookmarks_fts` USING fts5(
	`title`,
	`description`,
	`notes`,
	`url`,
	content='bookmarks',
	content_rowid='rowid',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `bookmarks_fts_ai` AFTER INSERT ON `bookmarks` BEGIN
	INSERT INTO `bookmarks_fts`(`rowid`, `title`, `description`, `notes`, `url`)
	VALUES (new.`rowid`, new.`title`, new.`description`, new.`notes`, new.`url`);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `bookmarks_fts_ad` AFTER DELETE ON `bookmarks` BEGIN
	INSERT INTO `bookmarks_fts`(`bookmarks_fts`, `rowid`, `title`, `description`, `notes`, `url`)
	VALUES ('delete', old.`rowid`, old.`title`, old.`description`, old.`notes`, old.`url`);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `bookmarks_fts_au` AFTER UPDATE ON `bookmarks` BEGIN
	INSERT INTO `bookmarks_fts`(`bookmarks_fts`, `rowid`, `title`, `description`, `notes`, `url`)
	VALUES ('delete', old.`rowid`, old.`title`, old.`description`, old.`notes`, old.`url`);
	INSERT INTO `bookmarks_fts`(`rowid`, `title`, `description`, `notes`, `url`)
	VALUES (new.`rowid`, new.`title`, new.`description`, new.`notes`, new.`url`);
END;
--> statement-breakpoint
INSERT INTO `bookmarks_fts`(`bookmarks_fts`) VALUES ('rebuild');
