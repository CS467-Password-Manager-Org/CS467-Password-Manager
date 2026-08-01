import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { vaultRouter } from "./routes/vault.js";
import { errorHandler } from "./middleware/error.js";
import { authLimiter, RATE_LIMIT_HEADERS } from "./middleware/rate-limit.js";

// Builds the app without binding a port so tests can drive it in-process.
export function createApp(): Express {
  const app = express();

  // Without this, req.ip behind a reverse proxy is the proxy's address, so every
  // user shares a single rate-limit bucket and one busy client can throttle
  // everyone. Only enabled when a hop count is configured: trusting a forwarded
  // header that no proxy actually set would let a client spoof X-Forwarded-For
  // and mint itself a fresh bucket per request, which is worse than the problem
  // it solves. express-rate-limit also rejects a blanket `true` for that reason.
  if (config.TRUST_PROXY_HOPS > 0) {
    app.set("trust proxy", config.TRUST_PROXY_HOPS);
  }

  app.use(helmet());
  // RateLimit-* and Retry-After are not CORS-safelisted, so the frontend can only
  // read them (to show a countdown on a 429) if they are explicitly exposed.
  app.use(cors({ origin: config.FRONTEND_ORIGIN, exposedHeaders: RATE_LIMIT_HEADERS }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/v1/auth", authLimiter, authRouter);
  app.use("/api/v1/vault", vaultRouter);

  app.use(errorHandler);
  return app;
}
