CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`verified_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_email_unique` ON `auth_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `diary_likes` (
	`author_id` text NOT NULL,
	`date` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`author_id`, `date`, `user_id`),
	FOREIGN KEY (`author_id`,`date`) REFERENCES `journal_entries`(`user_id`,`date`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "likes_not_self" CHECK("diary_likes"."author_id" <> "diary_likes"."user_id")
);
--> statement-breakpoint
CREATE TABLE `diary_moderation` (
	`author_id` text NOT NULL,
	`date` text NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`moderator_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`author_id`, `date`),
	FOREIGN KEY (`author_id`,`date`) REFERENCES `journal_entries`(`user_id`,`date`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "moderation_hidden_bool" CHECK("diary_moderation"."hidden" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `moderation_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`date` text NOT NULL,
	`hidden` integer NOT NULL,
	`reason` text NOT NULL,
	`moderator_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`nickname_key` text NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_nickname_key_unique` ON `profiles` (`nickname_key`);