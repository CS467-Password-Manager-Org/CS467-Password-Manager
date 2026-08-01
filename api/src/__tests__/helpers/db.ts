import { pool } from "../../db.js";

// db.ts imports only `pg` and reads DATABASE_URL — it has no path to config.ts,
// so rate-limit.test.ts can import this helper without pinning its config early.

// vault_items.user_id REFERENCES users(id), so users cannot be truncated alone.
// Naming both tables is explicit; CASCADE covers anything added later.
export async function truncateAll(): Promise<void> {
  await pool.query("TRUNCATE TABLE vault_items, users CASCADE");
}

export async function closePool(): Promise<void> {
  await pool.end();
}
