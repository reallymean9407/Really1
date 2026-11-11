DROP VIEW community_public_images;
--> statement-breakpoint
DROP VIEW community_sentiment_counts;
--> statement-breakpoint
DROP VIEW community_post_projection;
--> statement-breakpoint
CREATE TABLE `__new_journal_entries` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`entry_json` text NOT NULL,
	`version` integer NOT NULL,
	`last_attempt_id` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
INSERT INTO __new_journal_entries SELECT 'legacy-' || lower(hex(user_id)) || '-' || date, journal_entries.* FROM journal_entries;
--> statement-breakpoint
CREATE TABLE `__new_journal_revisions` (
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`version` integer NOT NULL,
	`saved_at` text NOT NULL,
	`entry_json` text NOT NULL,
	PRIMARY KEY(`entry_id`, `version`)
);
--> statement-breakpoint
INSERT INTO __new_journal_revisions SELECT 'legacy-' || lower(hex(user_id)) || '-' || date, journal_revisions.* FROM journal_revisions;
--> statement-breakpoint
CREATE TABLE `__new_journal_favorites` (
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `entry_id`)
);
--> statement-breakpoint
INSERT INTO __new_journal_favorites SELECT 'legacy-' || lower(hex(user_id)) || '-' || date, journal_favorites.* FROM journal_favorites;
--> statement-breakpoint
CREATE TABLE `__new_diary_likes` (
	`entry_id` text NOT NULL,
	`author_id` text NOT NULL,
	`date` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`entry_id`, `user_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `__new_journal_entries`(`entry_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "likes_not_self" CHECK("__new_diary_likes"."author_id" <> "__new_diary_likes"."user_id")
);
--> statement-breakpoint
INSERT INTO __new_diary_likes SELECT 'legacy-' || lower(hex(author_id)) || '-' || date, diary_likes.* FROM diary_likes;
--> statement-breakpoint
CREATE TABLE `__new_diary_moderation` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`date` text NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`moderator_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `__new_journal_entries`(`entry_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "moderation_hidden_bool" CHECK("__new_diary_moderation"."hidden" IN (0,1))
);
--> statement-breakpoint
INSERT INTO __new_diary_moderation SELECT 'legacy-' || lower(hex(author_id)) || '-' || date, diary_moderation.* FROM diary_moderation;
--> statement-breakpoint
DROP TABLE diary_likes;
--> statement-breakpoint
DROP TABLE diary_moderation;
--> statement-breakpoint
DROP TABLE journal_favorites;
--> statement-breakpoint
DROP TABLE journal_revisions;
--> statement-breakpoint
DROP TABLE journal_entries;
--> statement-breakpoint
ALTER TABLE __new_journal_entries RENAME TO journal_entries;
--> statement-breakpoint
ALTER TABLE __new_journal_revisions RENAME TO journal_revisions;
--> statement-breakpoint
ALTER TABLE __new_journal_favorites RENAME TO journal_favorites;
--> statement-breakpoint
ALTER TABLE __new_diary_likes RENAME TO diary_likes;
--> statement-breakpoint
ALTER TABLE __new_diary_moderation RENAME TO diary_moderation;
--> statement-breakpoint
CREATE INDEX journal_entries_user_date ON journal_entries(user_id,date);
--> statement-breakpoint
ALTER TABLE moderation_audit ADD entry_id text;
--> statement-breakpoint
UPDATE moderation_audit SET entry_id='legacy-' || lower(hex(author_id)) || '-' || date;
--> statement-breakpoint
CREATE VIEW `community_post_projection` AS SELECT e.entry_id,e.user_id AS author_id,e.date AS date,
  json_extract(e.entry_json,'$.visibility') AS visibility,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' THEN json_extract(e.entry_json,'$.title') END AS title,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' THEN json_extract(e.entry_json,'$.body') END AS body,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' THEN coalesce(json_extract(e.entry_json,'$.insight'),'') END AS insight,
  json_extract(e.entry_json,'$.sentiment') AS sentiment,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' AND json_extract(e.entry_json,'$.shareFearGreed')=1 THEN json_extract(e.entry_json,'$.fearGreed') END AS fear_greed_json,
  CASE WHEN json_extract(e.entry_json,'$.shareEmotion')=1 AND (
    json_extract(e.entry_json,'$.visibility')='sentiment' OR coalesce(json_extract(e.entry_json,'$.sharingVersion'),0) NOT IN (2,3)
  ) THEN CASE json_extract(e.entry_json,'$.emotion')
    WHEN '과열됨' THEN '흥분됨' ELSE json_extract(e.entry_json,'$.emotion') END
  END AS emotion,
  NULL AS cash_ratio,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' AND json_extract(e.entry_json,'$.shareTrades')=1 THEN json_extract(e.entry_json,'$.trades') ELSE '[]' END AS trades_json,
  coalesce(json_extract(e.entry_json,'$.publishedAt'),json_extract(e.entry_json,'$.updatedAt')) AS published_at,json_extract(e.entry_json,'$.updatedAt') AS updated_at,
  p.nickname AS nickname,p.avatar_url AS avatar_url,p.bio AS bio,coalesce(m.hidden,0) AS hidden,m.reason AS moderation_reason,m.updated_at AS moderated_at
  FROM journal_entries e LEFT JOIN profiles p ON p.user_id=e.user_id LEFT JOIN diary_moderation m ON m.entry_id=e.entry_id
  WHERE e.deleted_at IS NULL AND (
    json_extract(e.entry_json,'$.visibility')='public' OR (
      json_extract(e.entry_json,'$.visibility')='sentiment'
      AND json_extract(e.entry_json,'$.sharingVersion') IN (2,3,4)
      AND json_extract(e.entry_json,'$.sentiment') IN ('very-bearish','bearish','neutral','bullish','very-bullish')
    )
  );
--> statement-breakpoint
CREATE VIEW `community_public_images` AS SELECT p.entry_id,p.author_id,p.date,i.id,i.type,i.size,attached.key AS position
  FROM community_post_projection p
  JOIN journal_entries e ON e.entry_id=p.entry_id
  JOIN json_each(e.entry_json,'$.images') attached
  JOIN journal_images i ON i.id=json_extract(attached.value,'$.id') AND i.user_id=p.author_id
  WHERE p.visibility='public' AND p.hidden=0 AND json_extract(e.entry_json,'$.sharingVersion') IN (3,4)
  AND EXISTS (SELECT 1 FROM json_each(e.entry_json,'$.publishedImageIds') approved WHERE approved.value=i.id);
--> statement-breakpoint
CREATE VIEW `community_sentiment_counts` AS SELECT date,sentiment,count(*) AS count FROM (
  SELECT e.date,json_extract(e.entry_json,'$.sentiment') AS sentiment,
    row_number() OVER (PARTITION BY e.user_id,e.date ORDER BY
      json_extract(e.entry_json,'$.createdAt') DESC,e.entry_id DESC) AS position
  FROM journal_entries e LEFT JOIN diary_moderation m ON m.entry_id=e.entry_id
  WHERE e.deleted_at IS NULL AND coalesce(m.hidden,0)=0
  AND json_extract(e.entry_json,'$.visibility') IN ('sentiment','public')
  AND json_extract(e.entry_json,'$.sentiment') IN ('very-bearish','bearish','neutral','bullish','very-bullish')
) WHERE position=1 GROUP BY date,sentiment;
