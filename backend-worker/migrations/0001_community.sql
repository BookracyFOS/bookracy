-- Community uploads + contributor identities + the leaderboard's source data.
-- Lives in D1 (SQLite). Everything here is non-secret metadata: we key a
-- contributor by a one-way HASH of their sync-account key (never the key itself),
-- so a D1 leak can't impersonate anyone or be reversed to a credential.

-- A contributor. `uid` = sha256(account key), hex. `username` is the optional,
-- unique public display name; NULL means the contributor stays Anonymous.
CREATE TABLE IF NOT EXISTS users (
  uid        TEXT PRIMARY KEY,
  username   TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Case-insensitive uniqueness for claimed usernames; NULLs (anonymous) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users (username COLLATE NOCASE)
  WHERE username IS NOT NULL;

-- One row per uploaded book, keyed by its content md5 (the same key the rest of
-- the system uses for R2 / covers / downloads). Metadata is denormalised so the
-- listing renders without extra lookups; `downloads` is the leaderboard counter.
CREATE TABLE IF NOT EXISTS uploads (
  md5         TEXT PRIMARY KEY,
  uid         TEXT NOT NULL,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  ext         TEXT NOT NULL DEFAULT '',
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        INTEGER NOT NULL DEFAULT 0,
  lang        TEXT NOT NULL DEFAULT '',
  year        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (uid) REFERENCES users (uid)
);

CREATE INDEX IF NOT EXISTS idx_uploads_uid       ON uploads (uid);
CREATE INDEX IF NOT EXISTS idx_uploads_downloads ON uploads (downloads DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_created   ON uploads (created_at DESC);
