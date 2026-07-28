PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_snapshots` (
	`id` text NOT NULL,
	`run_id` text NOT NULL,
	`manifest_digest` text NOT NULL,
	`archive_digest` text NOT NULL,
	`before_source_digest` text NOT NULL,
	`after_source_digest` text NOT NULL,
	`document_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `id`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_snapshots`("id", "run_id", "manifest_digest", "archive_digest", "before_source_digest", "after_source_digest", "document_json", "created_at") SELECT "id", "run_id", "manifest_digest", "archive_digest", "before_source_digest", "after_source_digest", "document_json", "created_at" FROM `snapshots`;--> statement-breakpoint
DROP TABLE `snapshots`;--> statement-breakpoint
ALTER TABLE `__new_snapshots` RENAME TO `snapshots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_run_digest_uq` ON `snapshots` (`run_id`,`manifest_digest`);