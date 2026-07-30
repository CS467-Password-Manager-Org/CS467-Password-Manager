# API Reference

The complete contract for the password manager backend: every route the API serves, the database schema behind it, and the zero-knowledge guarantee both are built to uphold.

This document is the **reference**. For an ordered, copy-pasteable walkthrough against a running stack, see [`api-testing.md`](./api-testing.md).

## Contents

- [Base URL and conventions](#base-url-and-conventions)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [Accounts and sessions](#accounts-and-sessions)
  - [Multi-factor authentication](#multi-factor-authentication)
  - [Vault items](#vault-items)
- [Error contract](#error-contract)
- [Rate limiting](#rate-limiting)
- [Database schema](#database-schema)
- [The zero-knowledge guarantee](#the-zero-knowledge-guarantee)

## Base URL and conventions

| | |
|---|---|
| Base URL (local) | `http://localhost:5001` |
| Versioned prefix | `/api/v1` |
| Content type | `application/json` on every request with a body |
| Max request body | 16 kB (`express.json({ limit: "16kb" })`) |
| CORS | Restricted to the `FRONTEND_ORIGIN` origin; `RateLimit-*` and `Retry-After` are explicitly exposed so a browser client can read them |
| Security headers | `helmet` defaults |

The health route sits at `/api/health`, outside the version prefix, so a container healthcheck never has to track the API version.

Timestamps are ISO 8601 strings. Identifiers are UUIDs.

## Authentication

Sign in returns a signed **JWT bearer token**. Send it on every protected route:

```
Authorization: Bearer <token>
```

| Property | Value |
|---|---|
| Algorithm | HS256, pinned on both sign and verify |
| Subject (`sub`) | The user's UUID |
| Token ID (`jti`) | A random UUID, used by the sign-out blocklist |
| Lifetime | `JWT_EXPIRES_IN_SECONDS`, 900 seconds (15 minutes) by default |

Implemented in [`api/src/lib/jwt.ts`](../api/src/lib/jwt.ts) and enforced by [`api/src/middleware/require-auth.ts`](../api/src/middleware/require-auth.ts). A token that is missing, malformed, expired, or has been signed out returns `401` with the same generic `Unauthorized` body.

## Endpoints

Fourteen routes in total: one health check, five account and session routes, three MFA routes, and five vault routes.

### Health

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/health` | none | — | `200 {"status":"ok"}` | — |

### Accounts and sessions

Base path `/api/v1/auth`.

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/register` | none | `{ email, authKey, salt }` | `201 { id, email }` | `400` schema · `409` `Email already registered` |
| `GET` | `/salt` | none | `?email=` | `200 { salt }` | `400` schema |
| `POST` | `/login` | none | `{ email, authKey, code? }` | `200 { token, tokenType, expiresIn }` | `401` `Invalid credentials` / `mfa_required` / `invalid_mfa_code` · `429` `rate_limited` |
| `GET` | `/me` | bearer | — | `200 { id, email, mfaEnabled }` | `401` |
| `POST` | `/logout` | bearer | — | `204` no body | `401` |

**`POST /register`** — `email` is trimmed and lowercased before it reaches SQL, so addresses are unique case-insensitively. `authKey` and `salt` are each 1–1024 characters. The server stores an Argon2id hash of `authKey`; it never receives the master password that produced it.

**`GET /salt`** — returns the caller's stored key-derivation salt so the client can re-derive its keys before signing in. An **unknown email returns a deterministic decoy salt, not a 404** — the same value on every call for the same address — so this route cannot be used to test whether an account exists. The decoy is an HMAC of the email keyed with `SALT_PEPPER` (`deriveDecoySalt` in [`api/src/routes/auth.ts`](../api/src/routes/auth.ts)).

**`POST /login`** — an unknown email and a wrong `authKey` produce the identical `401 { "error": "Invalid credentials" }`, and the unknown-email path still performs one Argon2 verification against a dummy hash so the two cases take the same time.

When the account has MFA enabled and no `code` was sent, login answers `401 { "error": "mfa_required" }`. That response is the challenge: re-send the same credentials with a `code`. Because the MFA branch runs only *after* the auth key has been verified, the challenge itself never reveals whether an account exists. A wrong or malformed code answers `401 { "error": "invalid_mfa_code" }` — the same error for both, so a client has only one case to handle.

**`POST /logout`** — adds the token's `jti` to a server-side blocklist until the token's own expiry, so the presented token stops working immediately rather than remaining valid for the rest of its 15-minute window.

### Multi-factor authentication

Base path `/api/v1/auth`. TOTP (RFC 6238), 30-second steps, ±1 step of clock drift accepted.

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/mfa/enroll` | bearer | — | `200 { secret, otpauthUri }` | `401` · `409` `MFA is already enabled` |
| `POST` | `/mfa/activate` | bearer | `{ code }` | `200 { mfaEnabled: true }` | `400` schema / `No pending enrollment` · `401` `invalid_mfa_code` · `429` |
| `DELETE` | `/mfa` | bearer | `{ code }` | `200 { mfaEnabled: false }` | `400` schema / `MFA is not enabled` · `401` `invalid_mfa_code` · `429` |

Enrollment stores the secret in a **pending** state and does not turn MFA on. MFA becomes active only when `/mfa/activate` verifies a real code, so a user who loses the secret between the two calls is never locked out. `otpauthUri` is a standard `otpauth://` URI ready to render as a QR code.

Disabling requires a current code as well as a valid session, so a stolen token alone cannot strip the second factor off an account.

A `code` that is missing or not a string is a `400` schema error. A `code` that is present but not six digits is a `401 invalid_mfa_code`, matching a wrong code exactly. Every accepted code is consumed: the matched time step is recorded and a code cannot be used twice.

### Vault items

Base path `/api/v1/vault`. Every route requires a bearer token and operates only on the caller's own items.

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| `GET` | `/items` | bearer | — | `200 { items: [VaultItem] }` | `401` |
| `POST` | `/items` | bearer | `{ encryptedData }` | `201 VaultItem` | `400` schema · `401` |
| `GET` | `/items/:id` | bearer | — | `200 VaultItem` | `400` non-UUID `id` · `401` · `404` |
| `PATCH` | `/items/:id` | bearer | `{ encryptedData }` | `200 VaultItem` | `400` · `401` · `404` |
| `DELETE` | `/items/:id` | bearer | — | `204` no body | `400` · `401` · `404` |

```jsonc
// VaultItem
{
  "id": "…uuid…",
  "encryptedData": "…opaque ciphertext…",
  "createdAt": "2026-07-30T16:00:00.000Z",
  "updatedAt": "2026-07-30T16:00:00.000Z"
}
```

`encryptedData` is 1–8192 characters and is **stored and returned verbatim** — the server never parses, validates, or decrypts it. In the shipped client it is a base64 AES-256-GCM blob; to the API it is a string.

`GET /items` returns only the caller's rows, newest first.

**An item belonging to another user returns `404`, not `403`.** Every statement in [`api/src/repositories/vault-items.ts`](../api/src/repositories/vault-items.ts) is scoped `WHERE user_id = $1`, so a non-owned id produces no row and is answered identically to an id that does not exist. A caller therefore cannot confirm that another user's item id is real.

## Error contract

Every error response — from any route — is a JSON object with an `error` string:

```json
{ "error": "Invalid credentials" }
```

Four additions to that base shape:

| Case | Response |
|---|---|
| Schema validation failure | `400 { "error": "Invalid request", "issues": [{ "path": "email", "message": "…" }] }` |
| Any `401` | Carries a `WWW-Authenticate` header. `error="invalid_token"` is included **only** when a token was actually presented and rejected, so a wrong second factor never looks like an expired session |
| Rate limited | `429 { "error": "rate_limited" }` with `RateLimit-*` and `Retry-After` headers |
| Malformed or oversized body | The status body-parser assigned (`400` for unparseable JSON, `413` for a body over 16 kB) with `{ "error": "Invalid request" }` |

Anything unexpected is logged server-side and returned as a flat `500 { "error": "Internal Server Error" }`. Stack traces, SQL text, and driver messages are never sent to a client. See [`api/src/middleware/error.ts`](../api/src/middleware/error.ts).

## Rate limiting

Two independent layers, both counting in memory per process.

**Surface limiter** — every `/api/v1/auth` route, keyed by IP. Defaults to 100 requests per 15 minutes (`AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS`). A coarse abuse and CPU safeguard.

**Verification limiters** — `POST /login`, `POST /mfa/activate`, and `DELETE /mfa`, which are the routes where a secret can be guessed. Two limiters run together:

| Limiter | Keyed by | Default budget |
|---|---|---|
| Per account | User id, or an HMAC of the submitted email | 10 failures / 15 min (`AUTH_VERIFY_RATE_LIMIT_MAX_PER_ACCOUNT`) |
| Per IP | Client IP | 30 failures / 15 min (`AUTH_VERIFY_RATE_LIMIT_MAX_PER_IP`) |

Only **failed** attempts count, so an active user is never throttled. The per-account key is never looked up in the database, so an address with no account throttles exactly like a real one. An `mfa_required` challenge proves the auth key was correct and so does not spend the account budget, but it does spend the IP budget.

Because both stores are per process, these budgets apply to a single API instance — which is what the local Compose deployment runs. Implemented in [`api/src/middleware/rate-limit.ts`](../api/src/middleware/rate-limit.ts).

## Database schema

PostgreSQL 16. Created by `db/init/*.sql`, which Postgres applies in lexical order **only when the data volume is first initialized**.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `email` | `VARCHAR(255) UNIQUE NOT NULL` | Normalized to lowercase and trimmed before it reaches SQL |
| `auth_hash` | `VARCHAR(255) NOT NULL` | Argon2id hash of the **client-derived auth key** — not of the master password, which never leaves the browser |
| `user_salt` | `VARCHAR(255) NOT NULL` | Client-generated; feeds client-side key derivation. Useless on its own |
| `totp_secret` | `VARCHAR(255)` | `NULL` until enrollment; cleared when MFA is disabled |
| `mfa_enabled` | `BOOLEAN NOT NULL DEFAULT false` | Stays `false` between enroll and activate |
| `last_used_totp_step` | `BIGINT` | Most recent TOTP step consumed, so a code cannot be replayed |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

### `vault_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `user_id` | `UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Indexed by `idx_vault_items_user_id`; every query filters on it |
| `encrypted_data` | `TEXT NOT NULL` | Opaque ciphertext. The server never parses it |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Deleting a user cascades to their vault items.

## The zero-knowledge guarantee

**There is no column anywhere in this schema that holds a plaintext credential, a master password, a master key, or a decryption key.**

Read the two tables above and check what is actually stored:

- `auth_hash` is an Argon2id hash of a value **the client already derived**. The master password it came from never reaches the server, in any form, on any route.
- `user_salt` is a key-derivation input. Without the master password it derives nothing.
- `encrypted_data` is ciphertext the server has no key for. It is written and read as an opaque string.
- `totp_secret` authenticates a second factor. It grants no access to vault contents.

The server can therefore prove a user is who they claim to be, and hand back the exact bytes that user gave it, while being **structurally incapable** of reading a single stored password. An attacker with a full database dump gets ciphertext, hashes, and salts — not a vault.

This is the project's core value, and it is a property of the schema and the request contract, not a policy anyone has to remember to follow.

## Related documentation

| Document | What it covers |
|---|---|
| [`api-testing.md`](./api-testing.md) | Ordered curl walkthroughs against a running stack |
| [`vault.http`](./vault.http) | The same flows as a VS Code REST Client collection |
| [`threat-model.md`](./threat-model.md) | Assets, threats, mitigations, and explicit non-goals |
