CREATE TABLE `journal_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`target_cash_ratio` integer NOT NULL,
	CONSTRAINT "target_cash_ratio_range" CHECK(typeof("journal_preferences"."target_cash_ratio")='integer' AND "journal_preferences"."target_cash_ratio" BETWEEN 0 AND 100)
);
--> statement-breakpoint
DROP VIEW `community_post_projection`;--> statement-breakpoint
CREATE VIEW `community_post_projection` AS SELECT e.user_id AS author_id,e.date AS date,
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
  FROM journal_entries e LEFT JOIN profiles p ON p.user_id=e.user_id LEFT JOIN diary_moderation m ON m.author_id=e.user_id AND m.date=e.date
  WHERE e.deleted_at IS NULL AND (
    json_extract(e.entry_json,'$.visibility')='public' OR (
      json_extract(e.entry_json,'$.visibility')='sentiment'
      AND json_extract(e.entry_json,'$.sharingVersion') IN (2,3)
      AND json_extract(e.entry_json,'$.sentiment') IN ('very-bearish','bearish','neutral','bullish','very-bullish')
    )
  );
--> statement-breakpoint
CREATE VIEW `community_public_images` AS SELECT p.author_id,p.date,i.id,i.type,i.size,attached.key AS position
  FROM community_post_projection p
  JOIN journal_entries e ON e.user_id=p.author_id AND e.date=p.date
  JOIN json_each(e.entry_json,'$.images') attached
  JOIN journal_images i ON i.id=json_extract(attached.value,'$.id') AND i.user_id=p.author_id
  WHERE p.visibility='public' AND p.hidden=0 AND json_extract(e.entry_json,'$.sharingVersion')=3
  AND EXISTS (SELECT 1 FROM json_each(e.entry_json,'$.publishedImageIds') approved WHERE approved.value=i.id);
