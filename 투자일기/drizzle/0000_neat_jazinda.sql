CREATE TABLE `journal_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_mcp_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`entry_json` text NOT NULL,
	`version` integer NOT NULL,
	`last_attempt_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `journal_mutations` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`attempt_id` text NOT NULL,
	`result_json` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `journal_revisions` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`version` integer NOT NULL,
	`saved_at` text NOT NULL,
	`entry_json` text NOT NULL,
	PRIMARY KEY(`user_id`, `date`, `version`)
);
