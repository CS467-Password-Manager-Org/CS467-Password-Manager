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

// Well-formed and syntactically valid, so it clears the UUID schema and reaches
// the handler — which is the only way to exercise the not-found branch.
const ABSENT_ID = "00000000-0000-4000-8000-000000000000";

// createVaultItem is a helper rather than a fixture: each test still chooses its
// own owner and ciphertext.
async function createItem(token: string, encryptedData: string) {
  const res = await request(app)
    .post("/api/v1/vault/items")
    .set("Authorization", `Bearer ${token}`)
    .send({ encryptedData })
    .expect(201);
  return res.body as {
    id: string;
    encryptedData: string;
    createdAt: string;
    updatedAt: string;
  };
}

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

describe("GET /api/v1/vault/items", () => {
  it("returns an empty list for a user with no items", async () => {
    const { token } = await registerAndLogin("empty-list@example.com");

    const res = await request(app)
      .get("/api/v1/vault/items")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("returns only the caller's own items", async () => {
    const owner = await registerAndLogin("list-owner@example.com");
    const other = await registerAndLogin("list-other@example.com");

    const mine = await createItem(owner.token, "owner-ciphertext");
    const theirs = await createItem(other.token, "other-ciphertext");

    const res = await request(app)
      .get("/api/v1/vault/items")
      .set("Authorization", `Bearer ${owner.token}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(mine.id);
    // List is the one route where a scoping bug leaks rows without any id
    // needing to be guessed.
    expect(ids).not.toContain(theirs.id);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("POST /api/v1/vault/items", () => {
  it("rejects an empty encryptedData with 400", async () => {
    const { token } = await registerAndLogin("empty-blob@example.com");

    const res = await request(app)
      .post("/api/v1/vault/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ encryptedData: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it("rejects an oversized encryptedData with 400", async () => {
    const { token } = await registerAndLogin("big-blob@example.com");

    // createSchema caps encryptedData at 8192 characters.
    const res = await request(app)
      .post("/api/v1/vault/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ encryptedData: "x".repeat(8193) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });
});

describe("GET /api/v1/vault/items/:id", () => {
  it("returns 404 for a well-formed id that does not exist", async () => {
    const { token } = await registerAndLogin("missing-id@example.com");

    const res = await request(app)
      .get(`/api/v1/vault/items/${ABSENT_ID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  it("returns 400 for a malformed, non-UUID id", async () => {
    const { token } = await registerAndLogin("bad-id@example.com");

    const res = await request(app)
      .get("/api/v1/vault/items/not-a-uuid")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });
});

describe("PATCH /api/v1/vault/items/:id", () => {
  it("replaces the ciphertext of an owned item and advances updatedAt", async () => {
    const { token } = await registerAndLogin("patch-owner@example.com");
    const created = await createItem(token, "ciphertext-v1");

    // created_at and updated_at both default to now(), and toISOString()
    // truncates to milliseconds, so a same-millisecond update would produce an
    // identical string. A short wait makes the comparison deterministic.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await request(app)
      .patch(`/api/v1/vault/items/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ encryptedData: "ciphertext-v2" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.id);
    expect(res.body.encryptedData).toBe("ciphertext-v2");
    expect(res.body.updatedAt).not.toBe(created.updatedAt);
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
      new Date(created.updatedAt).getTime(),
    );
    // An update must not rewrite the creation instant.
    expect(res.body.createdAt).toBe(created.createdAt);

    // The new ciphertext is what a subsequent read returns.
    const fetched = await request(app)
      .get(`/api/v1/vault/items/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(fetched.body.encryptedData).toBe("ciphertext-v2");
  });

  it("returns 404 when updating an id that does not exist", async () => {
    const { token } = await registerAndLogin("patch-missing@example.com");

    const res = await request(app)
      .patch(`/api/v1/vault/items/${ABSENT_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ encryptedData: "ciphertext" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/vault/items/:id", () => {
  it("removes an owned item and makes it unreadable afterwards", async () => {
    const { token } = await registerAndLogin("delete-owner@example.com");
    const created = await createItem(token, "doomed-ciphertext");

    const res = await request(app)
      .delete(`/api/v1/vault/items/${created.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    const fetched = await request(app)
      .get(`/api/v1/vault/items/${created.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(fetched.status).toBe(404);
  });

  it("returns 404 when deleting an id that does not exist", async () => {
    const { token } = await registerAndLogin("delete-missing@example.com");

    const res = await request(app)
      .delete(`/api/v1/vault/items/${ABSENT_ID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe("vault routes without a bearer token", () => {
  // Every route is driven individually so requireAuth cannot be dropped from
  // one of them unnoticed.
  const routes = [
    { name: "GET /items", run: () => request(app).get("/api/v1/vault/items") },
    {
      name: "POST /items",
      run: () =>
        request(app).post("/api/v1/vault/items").send({ encryptedData: "ciphertext" }),
    },
    {
      name: "GET /items/:id",
      run: () => request(app).get(`/api/v1/vault/items/${ABSENT_ID}`),
    },
    {
      name: "PATCH /items/:id",
      run: () =>
        request(app)
          .patch(`/api/v1/vault/items/${ABSENT_ID}`)
          .send({ encryptedData: "ciphertext" }),
    },
    {
      name: "DELETE /items/:id",
      run: () => request(app).delete(`/api/v1/vault/items/${ABSENT_ID}`),
    },
  ];

  it.each(routes)("rejects $name with 401", async ({ run }) => {
    const res = await run();

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    // RFC 9110 15.5.2 requires a challenge on a 401.
    expect(res.headers["www-authenticate"]).toContain("Bearer");
  });
});

describe("vault per-user isolation", () => {
  it("hides another user's item behind a not-found and leaves it intact", async () => {
    const alice = await registerAndLogin("alice@example.com");
    const bob = await registerAndLogin("bob@example.com");

    const aliceCiphertext = "alice-ciphertext";
    const item = await createItem(alice.token, aliceCiphertext);

    // Not-found rather than forbidden on every accessor: the response must
    // never confirm to a non-owner that the id exists, or the endpoint becomes
    // an existence oracle.
    const read = await request(app)
      .get(`/api/v1/vault/items/${item.id}`)
      .set("Authorization", `Bearer ${bob.token}`);
    expect(read.status).toBe(404);
    expect(read.body.error).toBe("Not found");

    const write = await request(app)
      .patch(`/api/v1/vault/items/${item.id}`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ encryptedData: "bob-overwrite" });
    expect(write.status).toBe(404);

    const remove = await request(app)
      .delete(`/api/v1/vault/items/${item.id}`)
      .set("Authorization", `Bearer ${bob.token}`);
    expect(remove.status).toBe(404);

    // Bob's own listing must not leak the row either.
    const bobList = await request(app)
      .get("/api/v1/vault/items")
      .set("Authorization", `Bearer ${bob.token}`)
      .expect(200);
    const bobIds = bobList.body.items.map((entry: { id: string }) => entry.id);
    expect(bobIds).not.toContain(item.id);
    expect(bobList.body.items).toEqual([]);

    // The load-bearing assertion. Every check above passes even against a route
    // that answers not-found while still writing or deleting the row, so this
    // is the only one that proves the mutation was actually refused.
    const survivor = await request(app)
      .get(`/api/v1/vault/items/${item.id}`)
      .set("Authorization", `Bearer ${alice.token}`);
    expect(survivor.status).toBe(200);
    expect(survivor.body.id).toBe(item.id);
    expect(survivor.body.encryptedData).toBe(aliceCiphertext);
    expect(survivor.body.updatedAt).toBe(item.updatedAt);

    // And Alice's list still holds exactly the one item.
    const aliceList = await request(app)
      .get("/api/v1/vault/items")
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(aliceList.body.items).toHaveLength(1);
    expect(aliceList.body.items[0].encryptedData).toBe(aliceCiphertext);
  });
});
