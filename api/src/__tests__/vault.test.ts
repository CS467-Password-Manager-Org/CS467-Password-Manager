/**
 * Integration tests for the vault surface, driven in-process against a real
 * Postgres container (D-01). Per-user isolation is enforced by the
 * `WHERE user_id = $1` scoping in the repository layer, so it can only be
 * proven against real SQL — a mocked repository would test the mock (OPS-02).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../app.js";
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

// An ISO-8601 instant as produced by Date#toISOString.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("vault item round trip", () => {
  it("stores an encrypted blob and returns it byte-identical", async () => {
    const { token } = await registerAndLogin("tracer-vault@example.com");

    // Deliberately opaque, with characters a server that tried to parse or
    // re-encode the blob would mangle. The server must treat it as bytes.
    const ciphertext = 'v1.aGVsbG8="{}\\+/=  trailing';

    const created = await request(app)
      .post("/api/v1/vault/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ encryptedData: ciphertext });

    expect(created.status).toBe(201);
    expect(created.body.id).toEqual(expect.any(String));
    expect(created.body.encryptedData).toBe(ciphertext);
    expect(created.body.createdAt).toMatch(ISO_8601);
    expect(created.body.updatedAt).toMatch(ISO_8601);

    const id: string = created.body.id;

    // The property that makes the zero-knowledge boundary real: the server
    // stores and returns the blob without parsing or transforming it.
    const fetched = await request(app)
      .get(`/api/v1/vault/items/${id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(id);
    expect(fetched.body.encryptedData).toBe(ciphertext);
  });
});
