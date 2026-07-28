import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { vaultRouter } from "./routes/vault.js";
import { errorHandler } from "./middleware/error.js";
import { authLimiter, RATE_LIMIT_HEADERS } from "./middleware/rate-limit.js";

const app = express();
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

app.listen(config.PORT, () => {
  console.log(`api listening on port ${config.PORT}`);
});
