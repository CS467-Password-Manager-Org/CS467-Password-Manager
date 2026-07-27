import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

// Carries a client-safe status and message; anything else becomes a generic 500.
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

// Forwards rejected promises to the error middleware so async handlers never hang.
export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      issues: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // body-parser rejects bad bodies before routing; keep them client errors, not 500s.
  if (isBadRequestBody(err)) {
    res.status(err.status).json({ error: "Invalid request" });
    return;
  }

  if (err instanceof HttpError) {
    if (err.status === 401) {
      res.setHeader("WWW-Authenticate", bearerChallenge(req));
    }
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Log the real cause server-side only; never leak internals to the client.
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
}

// RFC 9110 15.5.2 requires a challenge on 401. Per RFC 6750 3.1, invalid_token is sent
// only when a token was presented and failed, so a bad 2nd factor never implies logout.
function bearerChallenge(req: Request): string {
  const tokenRejected =
    req.auth === undefined &&
    req.headers.authorization?.startsWith("Bearer ") === true;
  return tokenRejected
    ? 'Bearer realm="api", error="invalid_token"'
    : 'Bearer realm="api"';
}

function isBadRequestBody(err: unknown): err is { status: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    typeof (err as { status?: number }).status === "number" &&
    ((err as { type?: string }).type ?? "").startsWith("entity.")
  );
}
