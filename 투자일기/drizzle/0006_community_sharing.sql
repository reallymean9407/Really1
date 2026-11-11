DROP VIEW `community_post_projection`;--> statement-breakpoint
CREATE VIEW `community_post_projection` AS SELECT e.user_id AS author_id,e.date AS date,
  json_extract(e.entry_json,'$.visibility') AS visibility,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' THEN json_extract(e.entry_json,'$.title') END AS title,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' THEN json_extract(e.entry_json,'$.body') END AS body,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' THEN coalesce(json_extract(e.entry_json,'$.insight'),'') END AS insight,
  json_extract(e.entry_json,'$.sentiment') AS sentiment,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' AND json_extract(e.entry_json,'$.shareFearGreed')=1 THEN json_extract(e.entry_json,'$.fearGreed') END AS fear_greed_json,
  CASE WHEN json_extract(e.entry_json,'$.shareEmotion')=1 THEN json_extract(e.entry_json,'$.emotion') END AS emotion,
  NULL AS cash_ratio,
  CASE WHEN json_extract(e.entry_json,'$.visibility')='public' AND json_extract(e.entry_json,'$.shareTrades')=1 THEN json_extract(e.entry_json,'$.trades') ELSE '[]' END AS trades_json,
  coalesce(json_extract(e.entry_json,'$.publishedAt'),json_extract(e.entry_json,'$.updatedAt')) AS published_at,json_extract(e.entry_json,'$.updatedAt') AS updated_at,
  p.nickname AS nickname,p.avatar_url AS avatar_url,p.bio AS bio,coalesce(m.hidden,0) AS hidden,m.reason AS moderation_reason,m.updated_at AS moderated_at
  FROM journal_entries e LEFT JOIN profiles p ON p.user_id=e.user_id LEFT JOIN diary_moderation m ON m.author_id=e.user_id AND m.date=e.date
  WHERE e.deleted_at IS NULL AND (
    json_extract(e.entry_json,'$.visibility')='public' OR (
      json_extract(e.entry_json,'$.visibility')='sentiment'
      AND json_extract(e.entry_json,'$.sharingVersion')=2
      AND json_extract(e.entry_json,'$.sentiment') IN ('very-bearish','bearish','neutral','bullish','very-bullish')
    )
  );