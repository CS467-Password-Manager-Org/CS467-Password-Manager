/**
 * The dedicated 429 suite (D-04).
 *
 * The rest of the suite runs with deliberately generous ceilings so ordinary
 * test traffic never trips a false 429 — which leaves the 429 path itself
 * unexercised. D-04 rejected disabling the limiter for exactly that reason, so
 * this file closes the hole instead by tightening the ceilings for one file.
 *
 * This is the only file in the suite that builds the app through a dynamic
 * import. `config.ts` freezes its values in an `Object.freeze` evaluated once at
 * module load, and `rate-limit.ts` passes those numbers into the limiter
 * constructors at module scope, so both are fixed for the lifetime of the
 * worker. Setting the env vars after a static import would have no effect, and
 * `resetKey` cannot help either — it clears a counter but cannot lower a
 * ceiling. Vitest forks a process per test file, so the tightened ceilings get a
 * fresh module registry and cannot leak into the auth, MFA, or vault suites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

// Safe to import statically: db.ts depends only on `pg` and reads its own env
// var, so it has no path to config.ts and cannot pin the ceilings early.
import { closePool, truncateAll } from "./helpers/db.js";

const ACCOUNT_LIMIT = 3;

let app: Express;

beforeAll(async () => {
  process.env.AUTH_VERIFY_RATE_LIMIT_MAX_PER_ACCOUNT = String(ACCOUNT_LIMIT);
  // Left generous so the account layer is unambiguously the one that answers.
  process.env.AUTH_VERIFY_RATE_LIMIT_MAX_PER_IP = "1000";
  process.env.AUTH_RATE_LIMIT_MAX = "100000";

  const { createApp } = await import("../app.js");
  app = createApp();
});

beforeEach(truncateAll);
afterAll(closePool);

const CORRECT_KEY = "the-correct-auth-key";

async function register(email: string) {
  await request(app)
    .post("/api/v1/auth/register")
    .send({ email, authKey: CORRECT_KEY, salt: "c2FsdA==" })
    .expect(201);
}

function login(email: string, authKey: string) {
  return request(app).post("/api/v1/auth/login").send({ email, authKey });
}

describe("per-account login rate limiting", () => {
  // The limiter store is in-memory and its window is 15 minutes, so counters
  // survive truncateAll. Each test uses a distinct email, and the account key is
  // an HMAC of the email, so the tests get independent buckets.
  it("answers 429 once the per-account failure budget is spent", async () => {
    const email = "throttled@example.com";
    await register(email);

    // skipSuccessfulRequests is on, so only these failures spend the budget.
    for (let attempt = 0; attempt < ACCOUNT_LIMIT; attempt += 1) {
      const res = await login(email, "wrong-key");
      expect(res.status).toBe(401);
    }

    const limited = await login(email, "wrong-key");

    expect(limited.status).toBe(429);
    // The 429 matches the { error } contract error.ts emits everywhere else.
    expect(limited.body).toEqual({ error: "rate_limited" });

    // Assert the headers, not just the status: the frontend shows a countdown
    // from them, so a 429 that lost them is a regression the status alone would
    // not catch.
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers["ratelimit-limit"]).toBe(String(ACCOUNT_LIMIT));
    expect(limited.headers["ratelimit-remaining"]).toBe("0");
    expect(limited.headers["ratelimit-reset"]).toBeDefined();

    // The headers are not CORS-safelisted, so the browser can only read them
    // because app.ts exposes them explicitly.
    const exposed = String(limited.headers["access-control-expose-headers"] ?? "");
    expect(exposed).toContain("Retry-After");
    expect(exposed).toContain("RateLimit-Limit");
  });

  it("still throttles a correct password once the budget is spent", async () => {
    const email = "locked-out@example.com";
    await register(email);

    for (let attempt = 0; attempt < ACCOUNT_LIMIT; attempt += 1) {
      await login(email, "wrong-key").expect(401);
    }

    // Backoff applies to the account, not to the guess: an attacker who lands on
    // the right key after the budget is spent still gets nothing.
    const res = await login(email, CORRECT_KEY);

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited" });
  });
});

describe("skipSuccessfulRequests behaviour", () => {
  it("does not spend the failure budget on successful logins", async () => {
    const email = "well-behaved@example.com";
    await register(email);

    // Comfortably more successful logins than the failure budget allows. If
    // successes counted, the fourth request here would already be a 429 — this
    // is what keeps a legitimate user from locking themselves out.
    for (let attempt = 0; attempt < ACCOUNT_LIMIT + 2; attempt += 1) {
      const res = await login(email, CORRECT_KEY);
      expect(res.status).toBe(200);
      expect(typeof res.body.token).toBe("string");
    }

    // The full budget is still available afterwards.
    for (let attempt = 0; attempt < ACCOUNT_LIMIT; attempt += 1) {
      const res = await login(email, "wrong-key");
      expect(res.status).toBe(401);
    }

    // And it is a real budget, not an absent one.
    const limited = await login(email, "wrong-key");
    expect(limited.status).toBe(429);
  });
});
