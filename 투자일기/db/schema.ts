import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, foreignKey, check, sqliteView } from "drizzle-orm/sqlite-core";

// Each diary has its own identity. A user can write multiple diaries on the same date.
export const journalEntries = sqliteTable("journal_entries", {
  entryId: text("entry_id").primaryKey().notNull(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  entryJson: text("entry_json").notNull(),
  version: integer("version").notNull(),
  lastAttemptId: text("last_attempt_id").notNull(),
  deletedAt: text("deleted_at"),
}, (table) => [index("journal_entries_user_date").on(table.userId, table.date)]);

export const journalRevisions = sqliteTable("journal_revisions", {
  entryId: text("entry_id").notNull(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  version: integer("version").notNull(),
  savedAt: text("saved_at").notNull(),
  entryJson: text("entry_json").notNull(),
}, (table) => [primaryKey({ columns: [table.entryId, table.version] })]);

// Reservation, CAS write, revision and final result are committed in one batch.
export const journalMutations = sqliteTable("journal_mutations", {
  userId: text("user_id").notNull(),
  requestId: text("request_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  attemptId: text("attempt_id").notNull(),
  resultJson: text("result_json"),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.requestId] })]);

export const journalConnections = sqliteTable("journal_connections", {
  userId: text("user_id").primaryKey(),
  lastMcpAt: text("last_mcp_at").notNull(),
});

// Favorites are independent preferences, so edits/restores never replace them.
// Keep them when a diary is soft-deleted; active-entry reads hide them in trash.
export const journalFavorites = sqliteTable("journal_favorites", {
  entryId: text("entry_id").notNull(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.entryId] })]);

// Objects remain available for draft previews and immutable diary revisions.
export const journalImages = sqliteTable("journal_images", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  objectKey: text("object_key").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
});

// New community storage. No source-site records or identities are imported.
export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  nickname: text("nickname").notNull(),
  nicknameKey: text("nickname_key").notNull(),
  avatarUrl: text("avatar_url").notNull().default(""),
  bio: text("bio").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("profiles_nickname_key_unique").on(table.nicknameKey)]);

export const diaryLikes = sqliteTable("diary_likes", {
  entryId: text("entry_id").notNull(),
  authorId: text("author_id").notNull(),
  date: text("date").notNull(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({columns:[table.entryId,table.userId]}), foreignKey({columns:[table.entryId],foreignColumns:[journalEntries.entryId]}), check("likes_not_self", sql`${table.authorId} <> ${table.userId}`)]);

export const diaryModeration = sqliteTable("diary_moderation", {
  entryId: text("entry_id").primaryKey().notNull(),
  authorId: text("author_id").notNull(),
  date: text("date").notNull(),
  hidden: integer("hidden").notNull().default(0),
  reason: text("reason").notNull(),
  moderatorId: text("moderator_id").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [foreignKey({columns:[table.entryId],foreignColumns:[journalEntries.entryId]}), check("moderation_hidden_bool", sql`${table.hidden} IN (0,1)`)]);

export const moderationAudit = sqliteTable("moderation_audit", {
  entryId: text("entry_id"),
  id: text("id").primaryKey(),
  authorId: text("author_id").notNull(),
  date: text("date").notNull(),
  hidden: integer("hidden").notNull(),
  reason: text("reason").notNull(),
  moderatorId: text("moderator_id").notNull(),
  createdAt: text("created_at").notNull(),
});

export const authAccounts = sqliteTable("auth_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
});
export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(()=>authAccounts.id),
  expiresAt: text("expires_at").notNull(),
});
export const authTokens = sqliteTable("auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(()=>authAccounts.id),
  kind: text("kind").notNull(),
  expiresAt: text("expires_at").notNull(),
});
export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull(),
  windowStart: integer("window_start").notNull(),
});

export const journalPreferences = sqliteTable("journal_preferences", {
  userId: text("user_id").primaryKey(),
  targetCashRatio: integer("target_cash_ratio").notNull(),
}, (table) => [check("target_cash_ratio_range", sql`typeof(${table.targetCashRatio})='integer' AND ${table.targetCashRatio} BETWEEN 0 AND 100`)]);

// Public views project allowed fields at the database boundary. Raw journal JSON is never a feed source.
export const communityPostProjection = sqliteView("community_post_projection", {
  entryId:text("entry_id"), authorId:text("author_id"), date:text("date"), visibility:text("visibility"), title:text("title"), body:text("body"), insight:text("insight"), sentiment:text("sentiment"),
  fearGreedJson:text("fear_greed_json"), emotion:text("emotion"), cashRatio:integer("cash_ratio"), tradesJson:text("trades_json"),
  publishedAt:text("published_at"), updatedAt:text("updated_at"), nickname:text("nickname"), avatarUrl:text("avatar_url"), bio:text("bio"),
  hidden:integer("hidden"), moderationReason:text("moderation_reason"), moderatedAt:text("moderated_at"),
}).as(sql`SELECT e.entry_id,e.user_id AS author_id,e.date AS date,
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
  )`);

export const communityPublicImages = sqliteView("community_public_images", {
  entryId: text("entry_id"), authorId: text("author_id"), date: text("date"), id: text("id"), type: text("type"), size: integer("size"), position: integer("position"),
}).as(sql`SELECT p.entry_id,p.author_id,p.date,i.id,i.type,i.size,attached.key AS position
  FROM community_post_projection p
  JOIN journal_entries e ON e.entry_id=p.entry_id
  JOIN json_each(e.entry_json,'$.images') attached
  JOIN journal_images i ON i.id=json_extract(attached.value,'$.id') AND i.user_id=p.author_id
  WHERE p.visibility='public' AND p.hidden=0 AND json_extract(e.entry_json,'$.sharingVersion') IN (3,4)
  AND EXISTS (SELECT 1 FROM json_each(e.entry_json,'$.publishedImageIds') approved WHERE approved.value=i.id)`);

export const communitySentimentCounts = sqliteView("community_sentiment_counts", {
  date:text("date"), sentiment:text("sentiment"), count:integer("count"),
 }).as(sql`SELECT date,sentiment,count(*) AS count FROM (
  SELECT e.date,json_extract(e.entry_json,'$.sentiment') AS sentiment,
    row_number() OVER (PARTITION BY e.user_id,e.date ORDER BY
      json_extract(e.entry_json,'$.createdAt') DESC,e.entry_id DESC) AS position
  FROM journal_entries e LEFT JOIN diary_moderation m ON m.entry_id=e.entry_id
  WHERE e.deleted_at IS NULL AND coalesce(m.hidden,0)=0
  AND json_extract(e.entry_json,'$.visibility') IN ('sentiment','public')
  AND json_extract(e.entry_json,'$.sentiment') IN ('very-bearish','bearish','neutral','bullish','very-bullish')
) WHERE position=1 GROUP BY date,sentiment`);

export const diaryComments = sqliteTable("diary_comments", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull().references(()=>journalEntries.entryId),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
}, table => [
  index("diary_comments_entry").on(table.entryId,table.createdAt,table.id),
  check("diary_comments_body_length",sql`length(trim(${table.body})) BETWEEN 1 AND 2000`),
]);
