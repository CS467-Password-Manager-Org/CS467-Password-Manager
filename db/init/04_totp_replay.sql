-- Most recent TOTP step consumed per user, so a code cannot be replayed (RFC 6238 5.2).
-- db/init only runs on a fresh volume: re-init locally with `docker compose down -v`.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_used_totp_step BIGINT;
