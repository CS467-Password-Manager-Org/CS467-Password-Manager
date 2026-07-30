# Threat Model

The security posture of the password manager backend: what is worth protecting, what could go wrong, what stops it, and what this system deliberately does not try to do.

Scope is the API and database — `api/` and `db/` — as deployed by the local Docker Compose stack in this repository. Client-side cryptography runs in the browser and is out of scope, though the guarantee below depends on it holding up its end.

## The central claim

**The server is structurally incapable of reading a stored password.**

Not "does not", not "is configured not to" — cannot. There is no column in the schema that holds a plaintext credential, a master password, a master key, or a decryption key, and no route that accepts one. The master password and the keys derived from it never leave the browser.

What the server actually holds is:

| Stored | Why it is not enough to open a vault |
|---|---|
| `users.auth_hash` | An Argon2id hash of a value **the client already derived**. It proves someone knows the auth key; it decrypts nothing |
| `users.user_salt` | A key-derivation input. Without the master password it derives nothing |
| `vault_items.encrypted_data` | Ciphertext the server has no key for, written and read as an opaque string |
| `users.totp_secret` | Authenticates a second factor. It grants no access to vault contents |

An attacker who walks away with a complete database dump has hashes, salts, and ciphertext. They do not have a vault. This is the property everything below is in service of, and it is enforced by the shape of the schema and the request contract — not by a policy someone has to remember to follow.

Schema details are in [`api.md`](./api.md).

## Assets

Ordered by what an attacker would most want.

| Asset | Where it lives | Exposure |
|---|---|---|
| **Master password** | The user's head and the browser, only | Never transmitted to the server, in any form, on any route |
| **Master key** | Derived in the browser from the master password | Never transmitted. It is the only thing that decrypts vault contents |
| **Vault ciphertext** | `vault_items.encrypted_data` | Stored and served by the API. Opaque to it |
| **Account records** | `users` | Email, Argon2id auth hash, key-derivation salt, TOTP secret |
| **JWT signing key** | `JWT_SECRET`, process environment | Signs every session token. Disclosure means minting a valid session for any user |
| **Salt pepper** | `SALT_PEPPER`, process environment | Keys the decoy-salt HMAC. Disclosure turns the pre-login salt lookup into an account-existence oracle |

The last two are not user data, but they are the highest-leverage secrets in the system: either one, if known, defeats a control that protects everything above it.

## Threats and mitigations

Each entry names the threat, the control that answers it, and the file that implements it. Every citation is a real path in this repository — open it and the control is there.

### Injection into the database

**Threat.** A crafted email address or vault blob escapes into SQL and reads or destroys rows the caller does not own.

**Mitigation.** Every statement in [`api/src/repositories/users.ts`](../api/src/repositories/users.ts) and [`api/src/repositories/vault-items.ts`](../api/src/repositories/vault-items.ts) is a parameterized query using `$n` placeholders. There is no string concatenation into SQL anywhere in the codebase — user input is passed to the driver as a bound value, never as query text. Requests are also shape-validated by Zod before reaching a repository, through the single `validate()` middleware in [`api/src/middleware/validate.ts`](../api/src/middleware/validate.ts).

### Account enumeration through the pre-login salt lookup

**Threat.** `GET /api/v1/auth/salt` must return a salt to anyone before they sign in — that is what it is for. A naive implementation answers `404` for an address with no account, handing an attacker a fast, unauthenticated oracle for which of a leaked address list are customers here.

**Mitigation.** An unknown email receives a **deterministic decoy salt** rather than an error. `deriveDecoySalt()` in [`api/src/routes/auth.ts`](../api/src/routes/auth.ts) computes an HMAC of the address keyed with `SALT_PEPPER` and returns the first 16 bytes, base64-encoded — the same shape and length as a real salt, and stable across calls, so repeated probing does not reveal the substitution either. Because the pepper is a generated per-deployment secret, the decoy cannot be recomputed offline to distinguish it from a stored salt.

### Account enumeration through registration

**Threat.** Registration must reject a duplicate address, so a `409` confirms an account exists.

**Mitigation.** The rate of that probe is capped rather than the answer hidden: the surface limiter in [`api/src/middleware/rate-limit.ts`](../api/src/middleware/rate-limit.ts) applies to the whole `/api/v1/auth` prefix, keyed by IP, defaulting to 100 requests per 15 minutes. Bulk enumeration against a list of any useful size is not viable through this route, and unlike the salt lookup it leaves rows behind. The unauthenticated, high-volume surface an attacker would actually prefer is the salt endpoint, which is mitigated above.

### Account enumeration through login timing

**Threat.** A wrong password costs one Argon2 verification; an address with no account costs nothing. The response is identical, but the response *time* is not, and the difference is measurable.

**Mitigation.** The login handler in [`api/src/routes/auth.ts`](../api/src/routes/auth.ts) always performs exactly one Argon2 verification. When no user is found it verifies the submitted key against `DUMMY_AUTH_HASH`, a hash of random bytes generated at startup, so the work performed is the same either way. Both outcomes then return the identical `401 Invalid credentials`.

### Account enumeration through the MFA prompt

**Threat.** If the server asks for a TOTP code before checking the password, the prompt itself announces that the address is a real account with MFA enabled — to a caller who has proven nothing.

**Mitigation.** In [`api/src/routes/auth.ts`](../api/src/routes/auth.ts) the `user.mfa_enabled` branch is reached only after `keyValid` is true. The MFA challenge is therefore visible only to a caller who has already presented the correct auth key, at which point it reveals nothing they did not already know.

### Online password guessing

**Threat.** An attacker sprays guesses at the login and MFA-verification routes, rotating IPs to stay under a naive per-IP counter.

**Mitigation.** Two independent limiters run together on `POST /login`, `POST /mfa/activate`, and `DELETE /mfa`, both in [`api/src/middleware/rate-limit.ts`](../api/src/middleware/rate-limit.ts):

- **Per account**, IP-independent — 10 failures per 15 minutes by default. Rotating IPs does not reset it. The key is the user id, or an HMAC of the submitted email when unauthenticated. It is deliberately **never a database lookup**, so an address with no account throttles exactly like a real one and the limiter cannot itself become an existence oracle. The HMAC also means a heap dump yields no addresses.
- **Per IP**, across all accounts — 30 failures per 15 minutes by default, catching a horizontal spray across many accounts. Kept separate because a composite account-plus-IP key would reset every time the attacker rotated.

Only failed attempts count (`skipSuccessfulRequests`), so a legitimate user is never throttled, and a `429` is backoff rather than a lockout — an attacker cannot use it to deny a victim access to their own account. The `mfa_required` challenge proves the auth key was already correct, so it does not spend the account budget; it does spend the IP budget, so replaying it still costs the source. The per-account ceiling sits well below the limit of 100 failed attempts per account in NIST SP 800-63B §3.2.2.

### TOTP code replay

**Threat.** A code observed over the user's shoulder, or captured from a client, is valid for its full 30-second step plus the accepted drift window. Replayed inside that window it authenticates a second time.

**Mitigation.** Each code is consumed on use, per RFC 6238 §5.2. `verifyAndConsumeTotp()` in [`api/src/routes/auth.ts`](../api/src/routes/auth.ts) pins the epoch before computing the matched step, so a request landing on a step boundary cannot record the neighbouring step, and then calls `claimTotpStep()` in [`api/src/repositories/users.ts`](../api/src/repositories/users.ts). That function puts the strictly-increasing test inside the `WHERE` clause of the `UPDATE`:

```sql
UPDATE users SET last_used_totp_step = $2, updated_at = now()
 WHERE id = $1 AND (last_used_totp_step IS NULL OR last_used_totp_step < $2)
```

and returns whether a row was affected. Because the comparison and the write are one atomic statement, two concurrent requests carrying the same code cannot both succeed — the database, not application logic, resolves the race.

### Reading another user's vault items

**Threat.** An authenticated user substitutes another user's item id and reads, modifies, or deletes a vault entry that is not theirs. This is the single worst outcome the API can produce, and it is the property the product exists to guarantee.

**Mitigation.** Ownership lives in the query, not in a check that could be forgotten. Every statement in [`api/src/repositories/vault-items.ts`](../api/src/repositories/vault-items.ts) — list, get, update, delete — is scoped `WHERE user_id = $1`, with the authenticated user id taken from the verified token and never from the request body. A non-owned id matches no row, and [`api/src/routes/vault.ts`](../api/src/routes/vault.ts) translates that to **`404`, not `403`**, so the caller cannot even confirm the item exists. This is enforced by an automated test that creates an item as one user and asserts a second user receives `404` on both direct read and list.

### Token replay after sign-out

**Threat.** Access tokens are stateless and valid for 15 minutes. A token captured before sign-out would otherwise keep working for the remainder of that window, so signing out on a shared machine would not actually end the session.

**Mitigation.** Sign-out revokes the specific token. `POST /api/v1/auth/logout` calls `block()` in [`api/src/lib/token-blocklist.ts`](../api/src/lib/token-blocklist.ts), recording the token's `jti` against its own expiry, and [`api/src/middleware/require-auth.ts`](../api/src/middleware/require-auth.ts) rejects any blocked `jti` on every subsequent protected request. Entries are keyed to token expiry and pruned as they lapse, so the store holds only tokens that would still be valid and cannot grow without bound. Every token carries a unique `jti` for exactly this purpose, minted per sign-in in [`api/src/lib/jwt.ts`](../api/src/lib/jwt.ts), which also pins verification to `HS256` so a token cannot be presented with a weaker or absent algorithm.

### Secrets reaching a deployment from version control

**Threat.** A signing key or pepper committed to a public repository — or shipped as a working default that nobody changes — means every deployment shares a publicly known secret. For this system that is total authentication bypass: a known `JWT_SECRET` lets anyone mint a valid session for any user, and a known `SALT_PEPPER` makes every decoy salt recomputable offline, turning the salt lookup back into an enumeration oracle.

**Mitigation.** No usable secret exists in the repository, and two independent gates refuse to start a deployment that would use a guessable one:

- `scripts/setup.sh` generates `POSTGRES_PASSWORD`, `JWT_SECRET`, and `SALT_PEPPER` from a CSPRNG on first run and writes `.env` with mode `600`. `.env` is gitignored; `.env.example` ships those three values **blank**, so copying the template produces a file that cannot boot.
- `docker-compose.yml` declares them with required-variable syntax (`${VAR:?}`), so Compose refuses to start the stack at all if one is missing or empty, naming the setup script in the error.
- `requireSecret()` in [`api/src/config.ts`](../api/src/config.ts) rejects a set of known default strings **by exact value** at process start. A length check would not do: the previously shipped defaults were 34 characters, long enough to pass any plausible minimum. A container started with one of these values exits at startup with an actionable message.

### Container running as root

**Threat.** A remote-code-execution flaw in the API executes as `root` inside the container, widening a code bug into full control of the container and a better position from which to attempt escape.

**Mitigation.** The production stage of `api/Dockerfile` runs `USER node` (uid 1000). It also installs runtime dependencies through a separate `npm ci --omit=dev` and copies only compiled output from the build stage, so devDependencies, test files, and TypeScript sources are not present in the running image at all. A plain `docker compose up` resolves to this stage; the dev target with source mounts and watchers requires explicitly passing the dev overlay.

### Internal detail leaking through error responses

**Threat.** An unhandled exception returns a stack trace, a SQL fragment, or a driver message, disclosing table names, file paths, library versions, and query structure.

**Mitigation.** All errors pass through a single handler, `errorHandler` in [`api/src/middleware/error.ts`](../api/src/middleware/error.ts). Anything that is not an explicit, client-safe `HttpError` is logged server-side and returned as a flat `500 { "error": "Internal Server Error" }` with no detail. Schema failures return only the field path and a validation message, never the submitted value. Every `401` carries an RFC 9110 `WWW-Authenticate` challenge, and per RFC 6750 §3.1 the `invalid_token` code is included only when a token was actually presented and rejected — so a wrong second factor is never reported as an invalid session.

## Verification

These controls are exercised by 40 integration tests across four suites in `api/src/__tests__/`, run against a real PostgreSQL instance rather than a mock, so the ownership scoping and the replay guard are tested as the SQL that actually enforces them:

| Suite | Covers |
|---|---|
| `auth.test.ts` | Registration, the decoy salt, uniform login failure, session identity, sign-out revocation |
| `mfa.test.ts` | Enroll, activate, the login challenge, disable, and code replay rejection |
| `vault.test.ts` | Vault CRUD and cross-user isolation |
| `rate-limit.test.ts` | The `429` response under a tightened ceiling |

Run them with `npm test --workspace=api`.

## Non-goals

Explicitly out of scope for this deployment, which targets a single local Docker Compose stack. These are stated so a reader knows where the boundary is drawn rather than assuming coverage that was never intended.

**TLS termination.** The Compose stack has no reverse proxy and serves plain HTTP on localhost. Transport encryption is the responsibility of whatever fronts the API in a hosted deployment. On the loopback interface there is no network segment for an attacker to sit on.

**Multi-instance deployment.** The sign-out blocklist and both rate-limit counters are per-process in-memory stores, by design and documented as such in the source. They are correct for the single API instance this stack runs. Running several replicas behind a load balancer would call for a shared store such as Redis, which is a deployment-architecture decision rather than a change to any control described above.

**Account recovery.** A lost master password means the vault cannot be decrypted, by anyone, including the operator. This follows directly from the central claim: a server that could restore access would be a server that could read vaults. It is the intended behaviour of a zero-knowledge design, not a defect in it.

**Server-side breach detection and audit logging.** There is no intrusion detection, no anomaly alerting, and no durable audit trail of authentication events. Errors are logged to the container's standard output for operational debugging only.

**Client-side cryptography.** Key derivation and AES-256-GCM encryption run in the browser and are covered separately. The central claim assumes the client encrypts correctly before transmitting; the server can guarantee it never receives a key, not that the ciphertext it stores was well made.

## Related documentation

| Document | What it covers |
|---|---|
| [`api.md`](./api.md) | Endpoint contract, error shapes, and the database schema |
| [`api-testing.md`](./api-testing.md) | Manual walkthroughs, including the cross-user isolation check |
