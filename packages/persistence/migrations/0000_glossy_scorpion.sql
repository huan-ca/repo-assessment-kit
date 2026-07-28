CREATE TABLE `engagements` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`retention_policy` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engagements_slug_uq` ON `engagements` (`slug`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`principal` text NOT NULL,
	`operation` text NOT NULL,
	`run_id` text NOT NULL,
	`key` text NOT NULL,
	`request_digest` text NOT NULL,
	`status` integer NOT NULL,
	`response_json` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`principal`, `operation`, `run_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `migration_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phases` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`phase_key` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`document_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phases_run_key_revision_uq` ON `phases` (`run_id`,`phase_key`,`revision`);--> statement-breakpoint
CREATE TABLE `run_events` (
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`row_version` integer NOT NULL,
	`type` text NOT NULL,
	`public_payload_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`run_id`, `sequence`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `run_objects` (
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`current` integer DEFAULT true NOT NULL,
	`document_json` text NOT NULL,
	PRIMARY KEY(`run_id`, `kind`, `object_id`, `revision`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`parent_run_id` text,
	`project_slug` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`row_version` integer NOT NULL,
	`provider` text NOT NULL,
	`source_json` text NOT NULL,
	`selected_profiles_json` text NOT NULL,
	`optional_service_ids_json` text NOT NULL,
	`document_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_parent_revision_uq` ON `runs` (`parent_run_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_project_revision_uq` ON `runs` (`engagement_id`,`project_slug`,`revision`);--> statement-breakpoint
CREATE TABLE `source_handles` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`allowed_root_fingerprint` text NOT NULL,
	`registered_at` text NOT NULL
);
