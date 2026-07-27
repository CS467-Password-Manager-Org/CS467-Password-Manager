import { createHmac } from "node:crypto";
import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";

// MemoryStore: per-process counters, so a multi-replica deploy needs a shared store.

// Machine-readable 429 body matching the { error } shape error.ts emits.
const RATE_LIMITED_BODY = { error: "rate_limited" } as const;

// Pinned: v8 resolves `true` to draft-6 but may mean a newer draft in a future major.
const HEADERS_DRAFT = "draft-6" as const;

// Not CORS-safelisted, so index.ts must expose them for the browser to read.
export const RATE_LIMIT_HEADERS = [
  "RateLimit-Policy",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "Retry-After",
];

// Must match emailSchema exactly, or varying case/padding multiplies the budget.
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

// Never a DB lookup, so an unknown address throttles like a real one and cannot become
// an existence oracle. HMACed so a heap dump yields no addresses.
function accountVerifyKey(req: Request): string {
  const userId = req.auth?.userId;
  if (userId) {
    return `uid:${userId}`;
  }
  const email = normalizeEmail((req.body as { email?: unknown } | undefined)?.email);
  if (email) {
    const digest = createHmac("sha256", config.SALT_PEPPER).update(email).digest("base64url");
    return `email:${digest}`;
  }
  // Unreachable after validate(); fall back to IP so the attempt still counts.
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

// Coarse IP ceiling over the whole auth surface; an abuse/CPU safeguard only.
export const authLimiter = rateLimit({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: config.AUTH_RATE_LIMIT_MAX,
  standardHeaders: HEADERS_DRAFT,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY,
});

// Layer 1: failed verifications per account, IP-independent, so rotating IPs cannot
// walk past it (OWASP). Only failures count; a 429 is backoff, never a lockout.
export const accountVerifyLimiter = rateLimit({
  windowMs: config.AUTH_VERIFY_RATE_LIMIT_WINDOW_MS,
  limit: config.AUTH_VERIFY_RATE_LIMIT_MAX_PER_ACCOUNT,
  standardHeaders: HEADERS_DRAFT,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY,
  skipSuccessfulRequests: true,
  keyGenerator: accountVerifyKey,
});

// Layer 2: failures per IP across all accounts, catching a horizontal spray. Kept
// separate because a composite account+IP key would reset per rotated IP.
export const ipVerifyLimiter = rateLimit({
  windowMs: config.AUTH_VERIFY_RATE_LIMIT_WINDOW_MS,
  limit: config.AUTH_VERIFY_RATE_LIMIT_MAX_PER_IP,
  standardHeaders: HEADERS_DRAFT,
  legacyHeaders: false,
  message: RATE_LIMITED_BODY,
  skipSuccessfulRequests: true,
});
