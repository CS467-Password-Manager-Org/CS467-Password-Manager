const { JWT_SECRET, SALT_PEPPER } = process.env;

// Fail fast at startup if a required secret is missing, mirroring db.ts.
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set");
}
if (!SALT_PEPPER) {
  throw new Error("SALT_PEPPER is not set");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// JWT lifetime is kept as a number of seconds so it satisfies jsonwebtoken's
// stricter expiresIn typing without a duration string.
export const config = Object.freeze({
  JWT_SECRET,
  SALT_PEPPER,
  JWT_EXPIRES_IN_SECONDS: parsePositiveInt(process.env.JWT_EXPIRES_IN_SECONDS, 900),
  PORT: parsePositiveInt(process.env.PORT, 5000),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  AUTH_RATE_LIMIT_WINDOW_MS: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 900000),
  AUTH_RATE_LIMIT_MAX: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 100),
  // Well below NIST SP 800-63B-4 3.2.2's ceiling of 100 failed attempts per account.
  AUTH_VERIFY_RATE_LIMIT_WINDOW_MS: parsePositiveInt(
    process.env.AUTH_VERIFY_RATE_LIMIT_WINDOW_MS,
    900000,
  ),
  AUTH_VERIFY_RATE_LIMIT_MAX_PER_ACCOUNT: parsePositiveInt(
    process.env.AUTH_VERIFY_RATE_LIMIT_MAX_PER_ACCOUNT,
    10,
  ),
  AUTH_VERIFY_RATE_LIMIT_MAX_PER_IP: parsePositiveInt(
    process.env.AUTH_VERIFY_RATE_LIMIT_MAX_PER_IP,
    30,
  ),
});
