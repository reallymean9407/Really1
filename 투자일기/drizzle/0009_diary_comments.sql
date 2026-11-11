CREATE TABLE diary_comments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(entry_id),
  user_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
--> statement-breakpoint
CREATE INDEX diary_comments_entry ON diary_comments(entry_id, created_at, id);
--> statement-breakpoint
CREATE TRIGGER protect_diary_comments BEFORE UPDATE OF entry_json ON journal_entries
WHEN json_extract(NEW.entry_json,'$.commentsEnabled')=0
AND EXISTS(SELECT 1 FROM diary_comments WHERE entry_id=NEW.entry_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'COMMENTS_EXIST'); END;
