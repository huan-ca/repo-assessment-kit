CREATE TABLE `db_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL,
	`verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deletion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`scope` text NOT NULL,
	`state` text NOT NULL,
	`trash_path_digest` text,
	`trash_at` text,
	`purge_after` text,
	`document_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `package_validations` (
	`package_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`run_revision` integer NOT NULL,
	`package_digest` text NOT NULL,
	`validation_report_id` text NOT NULL,
	`certificate_digest` text NOT NULL,
	`artifact_path` text NOT NULL,
	`byte_length` text NOT NULL,
	`admitted_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`input_digest` text NOT NULL,
	`verdict` text NOT NULL,
	`document_json` text NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `secret_handles` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`purpose` text NOT NULL,
	`recipient` text NOT NULL,
	`approval_id` text,
	`expires_at` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `source_handles` ADD `internal_root` text;