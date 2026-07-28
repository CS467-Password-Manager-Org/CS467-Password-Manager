import { pool } from "../db.js";

export interface UserRecord {
  id: string;
  email: string;
  auth_hash: string;
  user_salt: string;
  totp_secret: string | null;
  mfa_enabled: boolean;
  // BIGINT arrives from pg as a string to avoid silent precision loss.
  last_used_totp_step: string | null;
  created_at: Date;
  updated_at: Date;
}

// All statements are parameterized; caller input is never concatenated into SQL.
export async function createUser(input: {
  email: string;
  authHash: string;
  userSalt: string;
}): Promise<{ id: string; email: string }> {
  const result = await pool.query<{ id: string; email: string }>(
    "INSERT INTO users (email, auth_hash, user_salt) VALUES ($1, $2, $3) RETURNING id, email",
    [input.email, input.authHash, input.userSalt],
  );
  return result.rows[0];
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    "SELECT id, email, auth_hash, user_salt, totp_secret, mfa_enabled, last_used_totp_step, created_at, updated_at FROM users WHERE email = $1",
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    "SELECT id, email, auth_hash, user_salt, totp_secret, mfa_enabled, last_used_totp_step, created_at, updated_at FROM users WHERE id = $1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function setTotpSecret(userId: string, secret: string): Promise<void> {
  // A new secret starts a fresh step space, so the old consumed step must not carry over.
  await pool.query(
    "UPDATE users SET totp_secret = $2, mfa_enabled = false, last_used_totp_step = NULL, updated_at = now() WHERE id = $1",
    [userId, secret],
  );
}

// Consumes `step` only if strictly newer, so a replay fails. The condition lives in
// the UPDATE so concurrent requests with the same code cannot both win.
export async function claimTotpStep(userId: string, step: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE users SET last_used_totp_step = $2, updated_at = now()
      WHERE id = $1 AND (last_used_totp_step IS NULL OR last_used_totp_step < $2)`,
    [userId, step],
  );
  return result.rowCount === 1;
}

export async function enableMfa(userId: string): Promise<void> {
  await pool.query(
    "UPDATE users SET mfa_enabled = true, updated_at = now() WHERE id = $1",
    [userId],
  );
}

export async function disableMfa(userId: string): Promise<void> {
  // Clearing the secret clears the step so re-enrollment is not blocked by a stale value.
  await pool.query(
    "UPDATE users SET totp_secret = NULL, mfa_enabled = false, last_used_totp_step = NULL, updated_at = now() WHERE id = $1",
    [userId],
  );
}
