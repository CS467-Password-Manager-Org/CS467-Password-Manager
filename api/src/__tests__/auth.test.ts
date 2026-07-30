/**
 * Integration tests for the auth surface, driven in-process against a real
 * Postgres container (D-01). Assertions read rows back through the pool so the
 * database layer is genuinely exercised, not just the HTTP contract.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../app.js";
import { pool } from "../db.js";
import { closePool, truncateAll } from "./helpers/db.js";

const app = createApp();

beforeEach(truncateAll);
afterAll(closePool);

describe("POST /api/v1/auth/register", () => {
  it("creates a user and persists the row to Postgres", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: "tracer@example.com",
      authKey: "tracer-auth-key",
      salt: "tracer-user-salt",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "tracer@example.com" });
    expect(res.body.id).toEqual(expect.any(String));

    // The point of the tracer: assert the row actually landed in the database.
    const { rows } = await pool.query(
      "SELECT id, email, auth_hash, user_salt FROM users WHERE email = $1",
      ["tracer@example.com"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.body.id);
    expect(rows[0].user_salt).toBe("tracer-user-salt");
    // The server stores an argon2 hash, never the submitted auth key.
    expect(rows[0].auth_hash).not.toBe("tracer-auth-key");
    expect(rows[0].auth_hash.startsWith("$argon2")).toBe(true);
  });
});
