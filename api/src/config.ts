const { JWT_SECRET, SALT_PEPPER } = process.env;

// Compose used to supply these as fallbacks, which meant the variable was never
// unset inside the container and a bare "is not set" check could never fire.
// The values are therefore rejected by name, not only by absence.
const REJECTED_SECRETS = new Set([
  "dev-only-insecure-secret-change-me",
  "dev-only-insecure-pepper-change-me",
  "changeme",
  "change-me",
  "secret",
  "password",
]);

function requireSecret(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Run ./scripts/setup.sh to generate .env`);
  }
  // A length floor alone is not enough: both shipped defaults are 34 characters,
  // so any plausible minimum would pass them. The deny-list is the real gate.
  if (REJECTED_SECRETS.has(value.trim().toLowerCase())) {
    throw new Error(
      `${name} is set to a known default value. Run ./scripts/setup.sh to generate a strong secret.`,
    );
  }
  return value;
}

const jwtSecret = requireSecret("JWT_SECRET", JWT_SECRET);
const saltPepper = requireSecret("SALT_PEPPER", SALT_PEPPER);

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// JWT lifetime is kept as a number of seconds so it satisfies jsonwebtoken's
// stricter expiresIn typing without a duration string.
export const config = Object.freeze({
  // Property names are deliberately unchanged: lib/jwt.ts, routes/auth.ts and
  // middleware/rate-limit.ts read these by name and need no edits.
  JWT_SECRET: jwtSecret,
  SALT_PEPPER: saltPepper,
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
