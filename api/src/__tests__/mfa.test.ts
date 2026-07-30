/**
 * Integration tests for the MFA lifecycle: enroll, activate, challenge, replay
 * and disable. Codes are generated with the same otplib the API depends on
 * (D-03), so the real RFC 6238 algorithm and the claimTotpStep replay guard
 * stay on the tested path rather than being stubbed out.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";

import { createApp } from "../app.js";
import { pool } from "../db.js";
import { closePool, truncateAll } from "./helpers/db.js";

const app = createApp();
const STEP_MS = 30_000;

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

// The server pins epoch to Date.now() and runs with window: 1, so a code minted
// for a future step is still accepted while claiming a strictly greater step.
// This is load-bearing: claimTotpStep requires a strictly increasing step, so a
// second present-time code would resolve to the already-consumed step and fail.
// Fake timers are deliberately not used — they break the pg pool's timers.
function codeForStep(secret: string, stepsAhead: number): string {
  return authenticator
    .clone({ epoch: Date.now() + stepsAhead * STEP_MS })
    .generate(secret);
}

async function enroll(token: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/auth/mfa/enroll")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  return res.body.secret as string;
}

async function mfaEnabledFor(email: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT mfa_enabled FROM users WHERE email = $1",
    [email],
  );
  return rows[0].mfa_enabled;
}

describe("POST /api/v1/auth/mfa/enroll", () => {
  it("returns a secret and an otpauth provisioning URI", async () => {
    const { token, email } = await registerAndLogin("enroll@example.com");

    const res = await request(app)
      .post("/api/v1/auth/mfa/enroll")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.secret).toBe("string");
    expect(res.body.secret.length).toBeGreaterThan(0);
    expect(res.body.otpauthUri).toContain("otpauth://totp/");
    expect(res.body.otpauthUri).toContain(encodeURIComponent(email));

    // Enrollment stores a pending secret but must not switch MFA on yet.
    expect(await mfaEnabledFor(email)).toBe(false);
  });

  it("rejects enrollment when MFA is already enabled with 409", async () => {
    const { token, email } = await registerAndLogin("already@example.com");
    const secret = await enroll(token);

    await request(app)
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: codeForStep(secret, 0) })
      .expect(200);

    const res = await request(app)
      .post("/api/v1/auth/mfa/enroll")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("MFA is already enabled");
    expect(await mfaEnabledFor(email)).toBe(true);
  });
});

describe("POST /api/v1/auth/mfa/activate", () => {
  it("turns MFA on when given a valid TOTP code", async () => {
    const { token, email } = await registerAndLogin("activate@example.com");
    const secret = await enroll(token);

    const res = await request(app)
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: codeForStep(secret, 0) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mfaEnabled: true });
    // Assert the flag actually flipped in Postgres, not just in the response.
    expect(await mfaEnabledFor(email)).toBe(true);
  });

  it("answers a shape-valid but wrong code with 401", async () => {
    const { token, email } = await registerAndLogin("wrongcode@example.com");
    await enroll(token);

    const res = await request(app)
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "abc" });

    // readTotpCode deliberately turns a malformed code into the same 401 a
    // wrong code produces, so clients only ever match one error.
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_mfa_code");
    expect(await mfaEnabledFor(email)).toBe(false);
  });

  it("answers a body with no code field with 400", async () => {
    const { token } = await registerAndLogin("nocode@example.com");
    await enroll(token);

    const res = await request(app)
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    // A missing field is a client bug and stays a schema error.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });
});

describe("POST /api/v1/auth/login with MFA enabled", () => {
  it("rejects a login with no code and signals mfa_required", async () => {
    const { token, email, authKey } = await registerAndLogin(
      "challenge@example.com",
    );
    const secret = await enroll(token);
    await request(app)
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: codeForStep(secret, 0) })
      .expect(200);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, authKey });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("mfa_required");
  });

  it("issues a token when the login carries a valid code", async () => {
    const { token, email, authKey } = await registerAndLogin(
      "mfa-login@example.com",
    );
    const secret = await enroll(token);
    await request(app)
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: codeForStep(secret, 0) })
      .expect(200);

    // Step +1 clears the strictly-increasing claimTotpStep guard without
    // waiting 30 seconds or touching global timers.
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, authKey, code: codeForStep(secret, 1) });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.tokenType).toBe("Bearer");
  });

  it("refuses to accept the same code twice, consuming each TOTP step once", async () => {
    const { token, email, authKey } = await registerAndLogin(
      "replay@example.com",
    );
    const secret = await enroll(token);
    await request(app)
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: codeForStep(secret, 0) })
      .expect(200);

    // Capture the exact code string that succeeds; the replay must reuse it.
    // Regenerating a code here would fail for the wrong reason (same-window
    // reuse) and would prove nothing about the replay guard.
    const loginCode = codeForStep(secret, 1);

    await request(app)
      .post("/api/v1/auth/login")
      .send({ email, authKey, code: loginCode })
      .expect(200);

    const replay = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, authKey, code: loginCode });

    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe("invalid_mfa_code");
  });
});

describe("DELETE /api/v1/auth/mfa", () => {
  it("turns MFA off when the caller re-verifies with a current code", async () => {
    const { token, email } = await registerAndLogin("disable@example.com");
    const secret = await enroll(token);
    await request(app)
      .post("/api/v1/auth/mfa/activate")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: codeForStep(secret, 0) })
      .expect(200);
    expect(await mfaEnabledFor(email)).toBe(true);

    // A second successful verification needs a strictly greater step.
    const res = await request(app)
      .delete("/api/v1/auth/mfa")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: codeForStep(secret, 1) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mfaEnabled: false });
    expect(await mfaEnabledFor(email)).toBe(false);
  });
});
