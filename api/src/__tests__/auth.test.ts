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

// Local factory, matching the repo convention of per-file setup helpers.
async function registerAndLogin(email: string) {
  const authKey = `auth-key-for-${email}`;
  await request(app)
    .post("/api/v1/auth/register")
    .send({ email, authKey, salt: "c2FsdA==" })
    .expect(201);

  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, authKey })
    .expect(200);

  return { token: res.body.token as string, email, authKey };
}

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

  it("rejects an email that is already registered with 409", async () => {
    const body = {
      email: "dupe@example.com",
      authKey: "some-auth-key",
      salt: "c2FsdA==",
    };
    await request(app).post("/api/v1/auth/register").send(body).expect(201);

    const res = await request(app).post("/api/v1/auth/register").send(body);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Email already registered");

    // The duplicate must not have created a second row.
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM users WHERE email = $1",
      ["dupe@example.com"],
    );
    expect(rows[0].n).toBe(1);
  });

  it("rejects a malformed body with 400 and reports the Zod issues", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", authKey: "", salt: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues[0]).toHaveProperty("path");
    expect(res.body.issues[0]).toHaveProperty("message");
  });
});

describe("GET /api/v1/auth/salt", () => {
  it("returns the stored salt for a known email", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: "known@example.com",
        authKey: "some-auth-key",
        salt: "dGhlLXJlYWwtc2FsdA==",
      })
      .expect(201);

    const res = await request(app)
      .get("/api/v1/auth/salt")
      .query({ email: "known@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.salt).toBe("dGhlLXJlYWwtc2FsdA==");
  });

  it("returns a deterministic decoy salt for an unknown email, never a 404", async () => {
    const email = "no-such-account@example.com";

    const first = await request(app).get("/api/v1/auth/salt").query({ email });
    const second = await request(app).get("/api/v1/auth/salt").query({ email });

    // A 404 here would turn the endpoint into an account-existence oracle.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(typeof first.body.salt).toBe("string");
    expect(first.body.salt.length).toBeGreaterThan(0);
    // Determinism is the property that makes the decoy useful: a random salt
    // would still return 200 but would leak existence across two lookups.
    expect(second.body.salt).toBe(first.body.salt);

    // The decoy is synthesised, not stored — no row exists for this email.
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("POST /api/v1/auth/login", () => {
  it("returns a bearer token for the correct auth key", async () => {
    const email = "login-ok@example.com";
    const authKey = `auth-key-for-${email}`;
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email, authKey, salt: "c2FsdA==" })
      .expect(201);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, authKey });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.tokenType).toBe("Bearer");
    expect(res.body.expiresIn).toBe(900);
  });

  it("rejects a wrong auth key with 401", async () => {
    const email = "login-bad@example.com";
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email, authKey: "the-right-key", salt: "c2FsdA==" })
      .expect(201);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, authKey: "the-wrong-key" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("answers an unknown email exactly like a wrong auth key", async () => {
    const email = "registered@example.com";
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email, authKey: "the-right-key", salt: "c2FsdA==" })
      .expect(201);

    const wrongKey = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, authKey: "the-wrong-key" });

    const unknownEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ghost@example.com", authKey: "the-wrong-key" });

    // Identical status and body, so login is not an account-existence oracle.
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.status).toBe(wrongKey.status);
    expect(unknownEmail.body).toEqual(wrongKey.body);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns the caller's identity for a valid bearer token", async () => {
    const { token, email } = await registerAndLogin("me@example.com");

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.mfaEnabled).toBe(false);
  });

  it("rejects a missing token with 401 and a WWW-Authenticate challenge", async () => {
    const res = await request(app).get("/api/v1/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    // RFC 9110 15.5.2 requires a challenge on a 401.
    expect(res.headers["www-authenticate"]).toBeDefined();
    expect(res.headers["www-authenticate"]).toContain("Bearer");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("returns 204 and blocks the same token from being reused", async () => {
    const { token } = await registerAndLogin("logout@example.com");

    // The token works before logout.
    await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    // The very same token is now on the server-side jti blocklist.
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });
});
