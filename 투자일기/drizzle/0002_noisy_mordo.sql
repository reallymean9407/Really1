CREATE TABLE `journal_favorites` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `date`)
);
