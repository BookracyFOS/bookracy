-- Moderation (ban / suspend) + per-upload covers + edit timestamps for community uploads.

-- Contributors can be banned (permanent: hides them + their books, blocks uploads)
-- or suspended until a date (temporary: blocks new uploads, books stay visible).
ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN suspended_until TEXT;

-- cover = 1 once an image has been stored at R2 covers/<md5>.jpg (auto-extracted
-- from the book or uploaded by the contributor). updated_at tracks metadata edits.
ALTER TABLE uploads ADD COLUMN cover INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN updated_at TEXT;
