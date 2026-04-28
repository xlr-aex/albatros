-- =============================================================================
-- Albatros RSS Reader — Database Triggers
-- =============================================================================
-- Two sets of triggers:
--
-- 1. FTS4 Synchronisation triggers
--    FTS5 "content tables" mode means FTS5 itself doesn't store text, it
--    reads from `articles`. But it doesn't auto-detect row changes, so we
--    maintain the index manually via these three triggers.
--
-- 2. Denormalisation triggers for feeds.unread_count
--    Keeping the count column up-to-date in the `feeds` table avoids an
--    expensive COUNT(*) on every sidebar render.  The tradeoff is a tiny
--    overhead on INSERT / UPDATE / DELETE — acceptable since article writes
--    are relatively rare (only during sync).
-- =============================================================================

-- After INSERT: add the new article to the full-text index.
CREATE TRIGGER IF NOT EXISTS articles_ai_fts
AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts (docid, title, content_text, author)
  VALUES (new.id, new.title, new.content_text, new.author);
END;

-- Before DELETE: remove the article from the full-text index while content still exists.
CREATE TRIGGER IF NOT EXISTS articles_bd_fts
BEFORE DELETE ON articles BEGIN
  DELETE FROM articles_fts WHERE docid = old.id;
END;

-- Before UPDATE: remove old terms from index.
CREATE TRIGGER IF NOT EXISTS articles_bu_fts
BEFORE UPDATE ON articles BEGIN
  DELETE FROM articles_fts WHERE docid = old.id;
END;

-- After UPDATE: insert new terms into index.
CREATE TRIGGER IF NOT EXISTS articles_au_fts
AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts (docid, title, content_text, author)
  VALUES (new.id, new.title, new.content_text, new.author);
END;

-- ─── Unread Count Denormalisation Triggers ────────────────────────────────────

-- After a new unread article is inserted, increment the counter.
CREATE TRIGGER IF NOT EXISTS feeds_unread_on_insert
AFTER INSERT ON articles
WHEN new.is_read = 0
BEGIN
  UPDATE feeds SET unread_count = unread_count + 1 WHERE id = new.feed_id;
END;

-- After an article is deleted, decrement the counter if it was unread.
CREATE TRIGGER IF NOT EXISTS feeds_unread_on_delete
AFTER DELETE ON articles
WHEN old.is_read = 0
BEGIN
  UPDATE feeds SET unread_count = MAX(0, unread_count - 1) WHERE id = old.feed_id;
END;

-- After is_read flips, adjust the counter accordingly.
-- WHEN guard ensures we only fire when the value actually changed.
CREATE TRIGGER IF NOT EXISTS feeds_unread_on_update
AFTER UPDATE OF is_read ON articles
WHEN old.is_read != new.is_read
BEGIN
  UPDATE feeds
  SET unread_count = MAX(0, unread_count + CASE WHEN new.is_read = 0 THEN 1 ELSE -1 END)
  WHERE id = new.feed_id;
END;

-- Also update feeds.updated_at whenever a column changes.
-- Guard: only fire when updated_at was NOT already explicitly set by the
-- statement, preventing infinite recursion (trigger updating → trigger firing).
CREATE TRIGGER IF NOT EXISTS feeds_updated_at
AFTER UPDATE ON feeds
WHEN old.updated_at = new.updated_at
BEGIN
  UPDATE feeds SET updated_at = strftime('%s','now') WHERE id = new.id;
END;
