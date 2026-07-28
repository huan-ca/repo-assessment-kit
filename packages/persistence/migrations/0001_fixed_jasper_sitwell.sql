CREATE TABLE `cleanup_records` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`fence_token` integer NOT NULL,
	`residues_json` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `limitations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`domain` text NOT NULL,
	`code` text NOT NULL,
	`reason` text NOT NULL,
	`effect` text NOT NULL,
	`follow_up` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `phase_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`phase_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`state` text NOT NULL,
	`input_digest` text NOT NULL,
	`fence_token` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`created_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`phase_id`) REFERENCES `phases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phase_attempts_number_uq` ON `phase_attempts` (`phase_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`manifest_digest` text NOT NULL,
	`archive_digest` text NOT NULL,
	`before_source_digest` text NOT NULL,
	`after_source_digest` text NOT NULL,
	`document_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_run_digest_uq` ON `snapshots` (`run_id`,`manifest_digest`);