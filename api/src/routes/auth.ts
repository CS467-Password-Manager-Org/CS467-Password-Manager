import { createHmac, randomBytes } from "node:crypto";
import { Router } from "express";
import argon2 from "argon2";
import { authenticator } from "otplib";
import { z } from "zod";
import type {
  LoginResponse,
  MeResponse,
  MfaEnrollResponse,
  MfaStatusResponse,
  RegisterResponse,
  SaltResponse,
} from "@app/shared";
import { config } from "../config.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/require-auth.js";
import { accountVerifyLimiter, ipVerifyLimiter } from "../middleware/rate-limit.js";
import { signAccessToken } from "../lib/jwt.js";
import { block } from "../lib/token-blocklist.js";
import {
  claimTotpStep,
  createUser,
  disableMfa,
  enableMfa,
  findUserByEmail,
  findUserById,
  setTotpSecret,
} from "../repositories/users.js";

export const authRouter = Router();

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(255));

const registerSchema = z.object({
  email: emailSchema,
  authKey: z.string().min(1).max(1024),
  salt: z.string().min(1).max(1024),
});

const saltQuerySchema = z.object({
  email: emailSchema,
});

const MFA_ISSUER = "Secure Password Manager";

// Accept the adjacent 30s TOTP steps so minor client clock drift near a step
// boundary does not cause spurious rejections on an otherwise-correct code.
authenticator.options = { window: 1 };

const TOTP_STEP_SECONDS = 30;

// RFC 6238 5.2: an OTP is accepted once, so the matched step is recorded.
async function verifyAndConsumeTotp(
  userId: string,
  secret: string,
  code: string,
): Promise<boolean> {
  const nowMs = Date.now();
  // Pinning the epoch stops a boundary request recording the neighbouring step.
  const delta = authenticator.clone({ epoch: nowMs }).checkDelta(code, secret);
  if (delta === null) {
    return false;
  }
  const matchedStep = Math.floor(nowMs / (TOTP_STEP_SECONDS * 1000)) + delta;
  return claimTotpStep(userId, matchedStep);
}

const TOTP_CODE_PATTERN = /^\d{6}$/;

// Shape only: a missing or non-string `code` is a client bug and stays a 400.
const mfaCodeSchema = z.object({
  code: z.string(),
});

// A malformed code answers exactly like a wrong one, so clients match one error.
function readTotpCode(body: z.infer<typeof mfaCodeSchema>): string {
  const code = body.code.trim();
  if (!TOTP_CODE_PATTERN.test(code)) {
    throw new HttpError(401, "invalid_mfa_code");
  }
  return code;
}

authRouter.post(
  "/register",
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { email, authKey, salt } = req.body as z.infer<typeof registerSchema>;
    const authHash = await argon2.hash(authKey);
    try {
      const user = await createUser({ email, authHash, userSalt: salt });
      const body: RegisterResponse = { id: user.id, email: user.email };
      res.status(201).json(body);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "Email already registered");
      }
      throw err;
    }
  }),
);

authRouter.get(
  "/salt",
  validate({ query: saltQuerySchema }),
  asyncHandler(async (req, res) => {
    const { email } = req.query as unknown as z.infer<typeof saltQuerySchema>;
    const user = await findUserByEmail(email);
    // Unknown emails get a deterministic, same-shaped salt so the response
    // does not reveal whether an account exists.
    const salt = user ? user.user_salt : deriveDecoySalt(email);
    const body: SaltResponse = { salt };
    res.status(200).json(body);
  }),
);

const loginSchema = z.object({
  email: emailSchema,
  authKey: z.string().min(1).max(1024),
  // Any provided code is accepted by the schema and validated by verifying it
  // against the secret, so a malformed code fails as invalid_mfa_code (401)
  // rather than a schema error (400), keeping every bad-code case uniform.
  code: z.string().trim().max(64).optional(),
});

// Verified against for unknown emails so login timing cannot reveal existence.
const DUMMY_AUTH_HASH = await argon2.hash(randomBytes(32).toString("base64"));

// After validate() to key on the normalized email; IP layer first so a spent IP
// budget cannot burn the victim's account budget.
authRouter.post(
  "/login",
  validate({ body: loginSchema }),
  ipVerifyLimiter,
  accountVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { email, authKey, code } = req.body as z.infer<typeof loginSchema>;
    const user = await findUserByEmail(email);
    // Always run one verify so a missing account costs the same as a wrong key.
    const keyValid = await argon2.verify(user?.auth_hash ?? DUMMY_AUTH_HASH, authKey);
    // One uniform error for unknown email and wrong key so login is not an oracle.
    if (!user || !keyValid) {
      throw new HttpError(401, "Invalid credentials");
    }
    // The MFA check runs only after the password is proven, so asking for a code
    // never reveals whether an account exists to an unauthenticated caller.
    if (user.mfa_enabled) {
      if (!code) {
        throw new HttpError(401, "mfa_required");
      }
      if (
        !user.totp_secret ||
        !(await verifyAndConsumeTotp(user.id, user.totp_secret, code))
      ) {
        throw new HttpError(401, "invalid_mfa_code");
      }
    }
    const token = signAccessToken(user.id);
    const body: LoginResponse = {
      token,
      tokenType: "Bearer",
      expiresIn: config.JWT_EXPIRES_IN_SECONDS,
    };
    res.status(200).json(body);
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await findUserById(req.auth!.userId);
    if (!user) {
      throw new HttpError(401, "Unauthorized");
    }
    const body: MeResponse = {
      id: user.id,
      email: user.email,
      mfaEnabled: user.mfa_enabled,
    };
    res.status(200).json(body);
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    block(req.auth!.jti, req.auth!.exp);
    res.status(204).end();
  }),
);

authRouter.post(
  "/mfa/enroll",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await findUserById(req.auth!.userId);
    if (!user) {
      throw new HttpError(401, "Unauthorized");
    }
    if (user.mfa_enabled) {
      throw new HttpError(409, "MFA is already enabled");
    }
    // Enrollment stores the secret in a pending state and does not turn MFA on
    // until a code is verified.
    const secret = authenticator.generateSecret();
    await setTotpSecret(user.id, secret);
    const otpauthUri = authenticator.keyuri(user.email, MFA_ISSUER, secret);
    const body: MfaEnrollResponse = { secret, otpauthUri };
    res.status(200).json(body);
  }),
);

authRouter.post(
  "/mfa/activate",
  requireAuth,
  validate({ body: mfaCodeSchema }),
  ipVerifyLimiter,
  accountVerifyLimiter,
  asyncHandler(async (req, res) => {
    const code = readTotpCode(req.body as z.infer<typeof mfaCodeSchema>);
    const user = await findUserById(req.auth!.userId);
    if (!user) {
      throw new HttpError(401, "Unauthorized");
    }
    if (!user.totp_secret) {
      throw new HttpError(400, "No pending enrollment");
    }
    if (!(await verifyAndConsumeTotp(user.id, user.totp_secret, code))) {
      throw new HttpError(401, "invalid_mfa_code");
    }
    await enableMfa(user.id);
    const body: MfaStatusResponse = { mfaEnabled: true };
    res.status(200).json(body);
  }),
);

authRouter.delete(
  "/mfa",
  requireAuth,
  validate({ body: mfaCodeSchema }),
  ipVerifyLimiter,
  accountVerifyLimiter,
  asyncHandler(async (req, res) => {
    const code = readTotpCode(req.body as z.infer<typeof mfaCodeSchema>);
    const user = await findUserById(req.auth!.userId);
    if (!user) {
      throw new HttpError(401, "Unauthorized");
    }
    if (!user.mfa_enabled || !user.totp_secret) {
      throw new HttpError(400, "MFA is not enabled");
    }
    // Disabling requires proving a current code so a stolen session cannot turn
    // MFA off on its own.
    if (!(await verifyAndConsumeTotp(user.id, user.totp_secret, code))) {
      throw new HttpError(401, "invalid_mfa_code");
    }
    await disableMfa(user.id);
    const body: MfaStatusResponse = { mfaEnabled: false };
    res.status(200).json(body);
  }),
);

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

function deriveDecoySalt(email: string): string {
  const digest = createHmac("sha256", config.SALT_PEPPER).update(email).digest();
  return digest.subarray(0, 16).toString("base64");
}
