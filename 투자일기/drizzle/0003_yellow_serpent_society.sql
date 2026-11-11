CREATE TABLE `journal_images` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
