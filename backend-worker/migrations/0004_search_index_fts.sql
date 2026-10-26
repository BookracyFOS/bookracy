-- Full-text index over `search_index`, replacing an `instr()` table scan.
--
-- `findByQuery` matched with `instr(lower(title), ?)`, which cannot use an index: every
-- lookup reads the whole table. That is free at a few hundred rows and expensive at the
-- 100k cap — and the query only runs when AA and libgen have BOTH failed, i.e. on every
-- search during exactly the outage this table exists for. At ~30k searches/day that is
-- ~3 billion rows read/day, past the plan's included D1 quota, to answer questions an
-- index answers for nothing.
--
-- External-content FTS5 (`content='search_index'`): the tokenised terms live here, the
-- columns stay in the base table, so nothing is duplicated. `content_rowid` binds an FTS
-- row to its base row via SQLite's implicit rowid.
--
-- `unicode61 remove_diacritics 2` matters for a book catalogue — it folds accents, so
-- "Les Misérables" is reachable by typing "Les Miserables", which the old substring
-- match could never do.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5(
  title,
  author,
  content='search_index',
  content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2"
);

-- External-content tables are not maintained automatically; these triggers are the
-- contract. `INSERT OR REPLACE` (what remember() issues on a repeat sighting) fires the
-- delete trigger for the displaced row and the insert trigger for the new one, so a
-- refreshed book re-indexes rather than accumulating a stale duplicate term set.
--
-- The 'delete' command form writes a tombstone; FTS5 requires the OLD column values to
-- do it, which is why each delete/update trigger passes them back.
CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
  INSERT INTO search_index_fts (rowid, title, author) VALUES (new.rowid, new.title, new.author);
END;

CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_index BEGIN
  INSERT INTO search_index_fts (search_index_fts, rowid, title, author)
    VALUES ('delete', old.rowid, old.title, old.author);
END;

CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_index BEGIN
  INSERT INTO search_index_fts (search_index_fts, rowid, title, author)
    VALUES ('delete', old.rowid, old.title, old.author);
  INSERT INTO search_index_fts (rowid, title, author) VALUES (new.rowid, new.title, new.author);
END;

-- Backfill whatever the table already holds; the triggers only cover writes from here on.
INSERT INTO search_index_fts (search_index_fts) VALUES ('rebuild');
