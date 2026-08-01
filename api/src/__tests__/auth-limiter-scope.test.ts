// The coarse IP limiter must not count authenticated session traffic. A signed-in
// user hits /me on every page load, so counting those against a budget sized for
// brute-force protection locks them out of their own account during normal use.
//
// Uses its own module registry and its own tiny ceiling, because config.ts reads
// the environment once at import time and the other suites deliberately set that
// ceiling high to keep the per-account layer unambiguous.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { closePool, truncateAll } from "./helpers/db.js";

const COARSE_LIMIT = 8;
const CORRECT_KEY = "the-correct-auth-key";

let app: Express;
let token: string;

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT_MAX = String(COARSE_LIMIT);
  process.env.AUTH_VERIFY_RATE_LIMIT_MAX_PER_ACCOUNT = "1000";
  process.env.AUTH_VERIFY_RATE_LIMIT_MAX_PER_IP = "1000";

  vi.resetModules();
  const { createApp } = await import("../app.js");
  app = createApp();

  await truncateAll();

  const email = "limiter-scope@example.com";
  await request(app)
    .post("/api/v1/auth/register")
    .send({ email, authKey: CORRECT_KEY, salt: "c2FsdA==" })
    .expect(201);

  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, authKey: CORRECT_KEY })
    .expect(200);
  token = res.body.token;
});

afterAll(closePool);

describe("coarse auth limiter scope", () => {
  it("never throttles GET /me, however many times a signed-in user reloads", async () => {
    // Well past the ceiling. Before the exemption this returned 429 partway
    // through, which is the reported symptom: a valid session refusing itself.
    const statuses: number[] = [];
    for (let i = 0; i < COARSE_LIMIT * 3; i++) {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);
      statuses.push(res.status);
    }

    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(statuses).not.toContain(429);
  });

  it("still rejects an unauthenticated request once the ceiling is reached", async () => {
    // Control for the test above: the limiter is genuinely active, so the /me
    // result is an exemption rather than a disabled limiter.
    let sawRateLimit = false;
    for (let i = 0; i < COARSE_LIMIT * 3; i++) {
      const res = await request(app).get("/api/v1/auth/salt").query({ email: "someone@example.com" });
      if (res.status === 429) {
        sawRateLimit = true;
        expect(res.body).toEqual({ error: "rate_limited" });
        break;
      }
    }

    expect(sawRateLimit).toBe(true);
  });

  it("throttles GET /me when the caller has no token", async () => {
    // The exemption is earned by proving a session, not by the path. Without a
    // token /me is anonymous traffic and must be counted, or it becomes a free
    // unmetered surface for anyone who simply omits the header.
    let sawRateLimit = false;
    for (let i = 0; i < COARSE_LIMIT * 3; i++) {
      const res = await request(app).get("/api/v1/auth/me");
      expect([401, 429]).toContain(res.status);
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }

    expect(sawRateLimit).toBe(true);
  });

  it("throttles GET /me when the token is invalid", async () => {
    // A garbage or forged bearer token must not buy the exemption either.
    let sawRateLimit = false;
    for (let i = 0; i < COARSE_LIMIT * 3; i++) {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer not-a-real-token");
      expect([401, 429]).toContain(res.status);
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }

    expect(sawRateLimit).toBe(true);
  });

  it("lets a throttled client still sign out", async () => {
    // Sign-out reduces risk, so it must stay reachable once /salt above has
    // driven the shared IP budget past its ceiling.
    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
  });
});
