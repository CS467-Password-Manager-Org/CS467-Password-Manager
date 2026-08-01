import { inject } from "vitest";

// api/src/config.ts and api/src/db.ts both read process.env and throw at import
// time. setupFiles runs before the test file's static imports are evaluated,
// so assigning here is early enough and no dynamic import is needed.
process.env.DATABASE_URL = inject("databaseUrl");

// Long enough to satisfy any length floor added to config.ts by D-11, and
// deliberately not one of the strings D-11 rejects.
process.env.JWT_SECRET ??= "test-jwt-secret-not-a-real-secret";
process.env.SALT_PEPPER ??= "test-salt-pepper-not-a-real-secret";
process.env.JWT_EXPIRES_IN_SECONDS ??= "900";
process.env.FRONTEND_ORIGIN ??= "http://localhost:5173";

// D-04: the limiter stays wired up, but with ceilings high enough that ordinary
// test traffic never trips it. rate-limit.test.ts overrides these before it
// imports the app. Windows keep their real values so only the ceiling changes.
process.env.AUTH_RATE_LIMIT_WINDOW_MS ??= "900000";
process.env.AUTH_RATE_LIMIT_MAX ??= "100000";
process.env.AUTH_VERIFY_RATE_LIMIT_WINDOW_MS ??= "900000";
process.env.AUTH_VERIFY_RATE_LIMIT_MAX_PER_ACCOUNT ??= "100000";
process.env.AUTH_VERIFY_RATE_LIMIT_MAX_PER_IP ??= "100000";
