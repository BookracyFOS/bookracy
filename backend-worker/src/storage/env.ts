// Bindings + secrets the backup layer needs. The Worker's full `Env` (in index.ts)
// extends this. All fields are optional so the feature degrades gracefully when
// unconfigured (e.g. local `wrangler dev` with no bot tokens) — exactly like the
// existing Turnstile handling.

export interface BackupEnv {
  BOOKS: R2Bucket;
  BACKUPS?: KVNamespace;
  BACKUP_QUEUE?: Queue<BackupJob>;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CHANNEL_ID?: string;

  // Optional overrides (strings from [vars]); parsed with sane defaults.
  BACKUP_CHUNK_BYTES?: string;
}

/** Payload enqueued when a freshly-cached book should be pushed to long-term backup. */
export interface BackupJob {
  md5: string;
  ext: string;
  mime: string;
}
