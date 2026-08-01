# API Testing Guide

How to run and manually test the backend by hand. Covers the account and session endpoints, the full MFA lifecycle, and the encrypted vault endpoints. Everything runs locally with Docker. You do not need the frontend for any of this.

This is the **runbook** — ordered walkthroughs you can paste into a terminal. For the full contract (every request shape, every error case, the database schema), see [`api.md`](./api.md).

## What this covers

- Account and session endpoints under `/api/v1/auth` — register, salt, login, session, logout
- MFA endpoints under `/api/v1/auth/mfa` — enroll, activate, the login challenge, disable
- Encrypted vault endpoints under `/api/v1/vault` — create, list, get, update, delete

The design is zero-knowledge. The server only ever stores an Argon2id hash of a client-derived key plus opaque encrypted blobs. It never sees a master password or any plaintext vault contents.

## Prerequisites

- **Docker Desktop with Docker Compose.** That is the only tool you need — no local Node, database, or frontend.
- **`./scripts/setup.sh` must have been run at least once.** It generates `.env` with fresh random secrets. The API deliberately refuses to start without them, so a fresh checkout will not boot until you run it. Copying `.env.example` by hand is not enough: it ships the secret values blank on purpose.

```bash
./scripts/setup.sh
```

Only `db` and `api` are needed for anything in this guide.

## 1. Run the API and database

From the repo root:

```bash
docker compose up -d db api
```

That builds the API as a production image — compiled output, no watchers. If you want the dev target with hot reload instead, pass both files explicitly:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db api
```

Confirm the API is up:

```bash
curl http://localhost:5001/api/health
# {"status":"ok"}
```

Connection details:

- API at `http://localhost:5001`
- Postgres at `localhost:5433`, database `app`, user `app`. The password is the generated `POSTGRES_PASSWORD` in your `.env` — it is no longer a fixed value.

Starting on an old database volume? `db/init/*.sql` runs **only when the volume is first created**, so a volume that predates a schema change will be missing columns and registration will fail with a 500 or a column error. Reset it:

```bash
./scripts/reset-db.sh
```

## 2. What to send when testing

In the real product the browser derives `authKey` from the master password and salt, and produces `encryptedData` by encrypting vault fields with AES-256-GCM. That client code is separate and is not needed to test the API:

- **`authKey`** — any string standing in for a password. It must match between register and login for the same account.
- **`salt`** — any string. The server stores it and hands it back.
- **`encryptedData`** — any string, 1 to 8192 characters. The server stores and returns it verbatim and never inspects it. Remember the server is not encrypting it; it only stores what you send.

## 3. Accounts and sessions

Base URL `http://localhost:5001/api/v1/auth`.

| Method | Path | Body or query | Success | Notes |
|--------|------|---------------|---------|-------|
| POST | `/register` | `{ email, authKey, salt }` | 201 `{ id, email }` | 409 if the email exists, 400 if a field is missing or invalid |
| GET | `/salt` | `?email=...` | 200 `{ salt }` | Unknown emails get a stable decoy salt so accounts cannot be enumerated |
| POST | `/login` | `{ email, authKey, code? }` | 200 `{ token, tokenType, expiresIn }` | 401 with the same message for a wrong key or an unknown email. `code` only when MFA is on |
| GET | `/me` | — | 200 `{ id, email, mfaEnabled }` | 401 without a valid token |
| POST | `/logout` | — | 204 | The token is blocked afterward and stops working |

Protected routes expect the token as a header: `Authorization: Bearer <token>`.

### Walkthrough

```bash
AUTH=http://localhost:5001/api/v1/auth
EMAIL=me@example.com
AUTHKEY=my-test-key
SALT=my-test-salt

# register a new account, expect 201
curl -i -X POST $AUTH/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"$AUTHKEY\",\"salt\":\"$SALT\"}"

# register again with the same email, expect 409
curl -i -X POST $AUTH/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"$AUTHKEY\",\"salt\":\"$SALT\"}"

# missing a field, expect 400 with an issues array naming the field
curl -i -X POST $AUTH/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"$AUTHKEY\"}"

# salt for a known email, expect the stored salt
curl -i "$AUTH/salt?email=$EMAIL"

# salt for an unknown email, expect a decoy salt — run it twice, it is identical
curl -i "$AUTH/salt?email=nobody@example.com"
curl -i "$AUTH/salt?email=nobody@example.com"

# login with the wrong key, expect 401 Invalid credentials
curl -i -X POST $AUTH/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"wrong-key\"}"

# login correctly, expect 200 with a token
curl -i -X POST $AUTH/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"$AUTHKEY\"}"
```

Grab a token for the protected routes. With `jq` installed:

```bash
TOKEN=$(curl -s -X POST $AUTH/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"$AUTHKEY\"}" | jq -r .token)

curl -i $AUTH/me -H "Authorization: Bearer $TOKEN"          # identity, expect 200
curl -i $AUTH/me                                            # no token, expect 401
curl -i $AUTH/me -H "Authorization: Bearer garbage"         # bad token, expect 401
curl -i -X POST $AUTH/logout -H "Authorization: Bearer $TOKEN"  # expect 204
curl -i $AUTH/me -H "Authorization: Bearer $TOKEN"          # reused after logout, expect 401
```

No `jq`? Copy the `token` value out of the login response by hand and paste it where `$TOKEN` goes.

Note the `WWW-Authenticate` header on the 401s. A rejected token adds `error="invalid_token"`; a missing token or a bad second factor does not, so a client can tell "your session died" apart from "that code was wrong".

## 4. Multi-factor authentication

Base URL `http://localhost:5001/api/v1/auth`. TOTP, six digits, 30-second steps. Every route needs a valid token.

| Method | Path | Body | Success | Notes |
|--------|------|------|---------|-------|
| POST | `/mfa/enroll` | none | 200 `{ secret, otpauthUri }` | 409 if MFA is already enabled. Stores the secret **pending** — MFA is not on yet |
| POST | `/mfa/activate` | `{ code }` | 200 `{ mfaEnabled: true }` | 400 `No pending enrollment` if you never enrolled, 401 `invalid_mfa_code` for a wrong code |
| DELETE | `/mfa` | `{ code }` | 200 `{ mfaEnabled: false }` | 400 `MFA is not enabled` if it is already off, 401 `invalid_mfa_code` for a wrong code |

Two error cases worth knowing apart, because they look similar:

- **`code` missing entirely, or not a string** → `400 { "error": "Invalid request", "issues": [...] }`. That is a client bug.
- **`code` present but wrong, replayed, or not six digits** → `401 { "error": "invalid_mfa_code" }`. A malformed code answers exactly like a wrong one on purpose, so clients only handle one case.

### Generating codes

Scan `otpauthUri` with any authenticator app, or generate codes from the terminal. From the repo root, using the `otplib` dependency the API itself uses:

```bash
SECRET=<paste-the-secret-from-enroll>
node -e "const {authenticator}=require('otplib'); console.log(authenticator.generate(process.argv[1]))" $SECRET
```

`oathtool --totp -b $SECRET` works too if you have oath-toolkit installed.

**Each code can be used only once.** The server records the time step it accepted and refuses to reuse it, so if you need a second code, wait for the next 30-second step rather than re-sending the same one.

### Walkthrough (full lifecycle)

Start with a fresh `$TOKEN` from a normal login.

```bash
AUTH=http://localhost:5001/api/v1/auth

# 1. enroll, expect 200 with a secret and an otpauth:// URI
curl -i -X POST $AUTH/mfa/enroll -H "Authorization: Bearer $TOKEN"
SECRET=<paste-the-secret>

# MFA is NOT on yet — confirm mfaEnabled is still false
curl -s $AUTH/me -H "Authorization: Bearer $TOKEN"

# 2. activate with a wrong code, expect 401 invalid_mfa_code
curl -i -X POST $AUTH/mfa/activate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"000000"}'

# omit the code entirely, expect 400 Invalid request (not 401)
curl -i -X POST $AUTH/mfa/activate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# 3. activate with a real code, expect 200 {"mfaEnabled":true}
CODE=$(node -e "const {authenticator}=require('otplib'); console.log(authenticator.generate(process.argv[1]))" $SECRET)
curl -i -X POST $AUTH/mfa/activate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}"

# replay that same code, expect 401 invalid_mfa_code — codes are consumed
curl -i -X POST $AUTH/mfa/activate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}"

# enroll again while enabled, expect 409
curl -i -X POST $AUTH/mfa/enroll -H "Authorization: Bearer $TOKEN"
```

Now the login challenge:

```bash
# 4. log in without a code, expect 401 {"error":"mfa_required"}
curl -i -X POST $AUTH/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"$AUTHKEY\"}"

# with a wrong code, expect 401 {"error":"invalid_mfa_code"}
curl -i -X POST $AUTH/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"$AUTHKEY\",\"code\":\"000000\"}"

# with a fresh code, expect 200 and a token
CODE=$(node -e "const {authenticator}=require('otplib'); console.log(authenticator.generate(process.argv[1]))" $SECRET)
curl -i -X POST $AUTH/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"authKey\":\"$AUTHKEY\",\"code\":\"$CODE\"}"
```

`mfa_required` is the challenge, not a rejection — it means the auth key was correct. Because that check runs only after the key is verified, the prompt never tells an unauthenticated caller whether an account exists.

Finally, disable. This needs a current code as well as a valid token, so a stolen session cannot turn MFA off by itself:

```bash
TOKEN=<token from the MFA login above>

# 5. wrong code, expect 401 invalid_mfa_code
curl -i -X DELETE $AUTH/mfa -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"000000"}'

# a fresh code, expect 200 {"mfaEnabled":false}
CODE=$(node -e "const {authenticator}=require('otplib'); console.log(authenticator.generate(process.argv[1]))" $SECRET)
curl -i -X DELETE $AUTH/mfa -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}"

# disable again when it is already off, expect 400 MFA is not enabled
curl -i -X DELETE $AUTH/mfa -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"123456"}'
```

## 5. Vault endpoints

Base URL `http://localhost:5001/api/v1/vault`. Every route requires `Authorization: Bearer <token>`.

| Method | Path | Body | Success | Notes |
|--------|------|------|---------|-------|
| POST | `/items` | `{ encryptedData }` | 201 `{ id, encryptedData, createdAt, updatedAt }` | 1 to 8192 chars, stored verbatim. 400 if missing or empty |
| GET | `/items` | none | 200 `{ items: [...] }` | Only the caller's own items, newest first |
| GET | `/items/:id` | none | 200 the item | 404 if missing or owned by another user, 400 if the id is not a UUID |
| PATCH | `/items/:id` | `{ encryptedData }` | 200 the updated item | Replaces the blob and bumps `updatedAt`. 404 / 400 as above |
| DELETE | `/items/:id` | none | 204 | 404 if missing or owned by another user, 400 if the id is not a UUID |

### Walkthrough (single user)

Reusing `$TOKEN` from a fresh login:

```bash
V=http://localhost:5001/api/v1/vault

# create an item, expect 201 with encryptedData echoed back unchanged
curl -i -X POST $V/items -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"encryptedData":"BLOB-1234"}'

# copy the returned id, then
ITEM=<paste-the-id-here>

curl -i $V/items -H "Authorization: Bearer $TOKEN"            # list, expect 200 with the item
curl -i $V/items/$ITEM -H "Authorization: Bearer $TOKEN"      # get by id, expect 200
curl -i $V/items                                              # no token, expect 401
curl -i $V/items/not-a-uuid -H "Authorization: Bearer $TOKEN" # malformed id, expect 400

# empty blob, expect 400
curl -i -X POST $V/items -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"encryptedData":""}'
```

Update and delete:

```bash
# PATCH, expect 200 with the new blob and a bumped updatedAt (createdAt unchanged)
curl -i -X PATCH $V/items/$ITEM -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"encryptedData":"BLOB-UPDATED"}'

# PATCH with no encryptedData field, expect 400
curl -i -X PATCH $V/items/$ITEM -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# PATCH an id that does not exist, expect 404
curl -i -X PATCH $V/items/11111111-1111-4111-8111-111111111111 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"encryptedData":"X"}'

# DELETE, expect 204 with no body
curl -i -X DELETE $V/items/$ITEM -H "Authorization: Bearer $TOKEN"

# read it back, expect 404
curl -i $V/items/$ITEM -H "Authorization: Bearer $TOKEN"

# delete the same id again, expect 404
curl -i -X DELETE $V/items/$ITEM -H "Authorization: Bearer $TOKEN"
```

### Walkthrough (two users, the important isolation check)

This proves one user can never read, modify, or delete another user's items — the core security property of the vault.

> This exact scenario is also covered automatically by the integration suite in `api/src/__tests__/vault.test.ts`, so it is a regression test as well as a manual check. Run it with `npm test --workspace=api`.

```bash
AUTH=http://localhost:5001/api/v1/auth
V=http://localhost:5001/api/v1/vault

# user A
curl -s -X POST $AUTH/register -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","authKey":"ka","salt":"sa"}' >/dev/null
TA=$(curl -s -X POST $AUTH/login -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","authKey":"ka"}' | jq -r .token)

# user B
curl -s -X POST $AUTH/register -H 'Content-Type: application/json' \
  -d '{"email":"b@example.com","authKey":"kb","salt":"sb"}' >/dev/null
TB=$(curl -s -X POST $AUTH/login -H 'Content-Type: application/json' \
  -d '{"email":"b@example.com","authKey":"kb"}' | jq -r .token)

# A creates an item and we capture its id
ITEM=$(curl -s -X POST $V/items -H "Authorization: Bearer $TA" \
  -H 'Content-Type: application/json' -d '{"encryptedData":"A-SECRET"}' | jq -r .id)

curl -i $V/items/$ITEM -H "Authorization: Bearer $TA"   # A reads own item, expect 200
curl -i $V/items/$ITEM -H "Authorization: Bearer $TB"   # B reads A's id, expect 404 not 403
curl -i $V/items -H "Authorization: Bearer $TB"         # B lists, expect {"items":[]}

# B cannot write to it either
curl -i -X PATCH $V/items/$ITEM -H "Authorization: Bearer $TB" \
  -H 'Content-Type: application/json' -d '{"encryptedData":"HACKED"}'   # expect 404
curl -i -X DELETE $V/items/$ITEM -H "Authorization: Bearer $TB"          # expect 404

# and A's item is untouched
curl -i $V/items/$ITEM -H "Authorization: Bearer $TA"   # expect 200, still "A-SECRET"
```

Every cross-user attempt returns **404 rather than 403**, on purpose, so B cannot even confirm that A's item exists.

## 6. Inspect the database

```bash
docker compose exec db psql -U app -d app
```

Useful queries once inside:

```sql
\dt                          -- list tables (users, vault_items)
SELECT email, left(auth_hash, 20) AS hash, user_salt, mfa_enabled FROM users;
SELECT substring(id::text,1,8) AS id, substring(user_id::text,1,8) AS owner, encrypted_data FROM vault_items;
\q
```

What to look for:

- `auth_hash` starts with `$argon2id$` and is never a plaintext key.
- `encrypted_data` is exactly the blob you sent — the server stores it untouched.
- `totp_secret` is null until you enroll, and returns to null when you disable MFA.
- `last_used_totp_step` records the most recent code consumed, which is what blocks replays.

A GUI such as TablePlus, DBeaver, or pgAdmin also works. Connect to host `localhost`, port `5433`, database `app`, user `app`, and the `POSTGRES_PASSWORD` from your `.env`.

## 7. Expected results at a glance

| Step | Expected |
|------|----------|
| register new | 201 `{ id, email }` |
| register duplicate | 409 |
| register missing field | 400 with an `issues` array |
| salt known email | 200 with the stored salt |
| salt unknown email | 200 with a stable decoy salt |
| login wrong key or unknown email | 401, same generic message |
| login correct | 200 with a token and `expiresIn` 900 |
| me with token | 200 `{ id, email, mfaEnabled }` |
| me without or with a bad token | 401 |
| logout | 204, then the same token fails everywhere |
| mfa enroll | 200 `{ secret, otpauthUri }`, `mfaEnabled` still false |
| mfa enroll when already enabled | 409 |
| mfa activate without enrolling | 400 `No pending enrollment` |
| mfa activate, code field missing | 400 `Invalid request` |
| mfa activate, wrong or malformed code | 401 `invalid_mfa_code` |
| mfa activate, valid code | 200 `{ mfaEnabled: true }` |
| mfa activate, replayed code | 401 `invalid_mfa_code` |
| login with MFA on, no code | 401 `mfa_required` |
| login with MFA on, wrong code | 401 `invalid_mfa_code` |
| login with MFA on, valid code | 200 with a token |
| mfa disable, valid code | 200 `{ mfaEnabled: false }` |
| mfa disable when already off | 400 `MFA is not enabled` |
| vault create | 201, `encryptedData` echoed unchanged |
| vault create empty blob | 400 |
| vault list | 200, only the caller's items |
| vault get own item | 200 |
| vault patch own item | 200, `updatedAt` bumped |
| vault delete own item | 204, then 404 on re-read |
| vault get, patch, or delete another user's item | 404 |
| vault get non-existent UUID | 404 |
| vault malformed id | 400 |
| any vault call without a token | 401 |

## 8. Stop and clean up

```bash
docker compose down        # stop, keep the data volume
docker compose down -v     # stop and wipe the database
```

## Troubleshooting

- **Compose refuses to start, naming a missing variable.** Your `.env` is absent or incomplete. Run `./scripts/setup.sh`.
- **The api container starts and immediately exits.** Check `docker compose logs api`. If it names a secret set to a known default value, run `./scripts/setup.sh` — the API rejects placeholder secrets by design.
- **Registration returns a 500 or a column error.** You are on an old schema; `db/init/*.sql` only runs on a fresh volume. Run `./scripts/reset-db.sh`.
- **The API cannot connect to Postgres after rotating `POSTGRES_PASSWORD`.** Postgres only applies the password when its data directory is first initialized, so the old volume keeps the old one. Run `./scripts/reset-db.sh`.
- **Connection refused on 5001.** The API is still starting or not running. Check `docker compose ps` and `docker compose logs api`, then retry the health check.
- **Login returns 401 with the right email.** The `authKey` must match the one used at register exactly.
- **Token rejected right after login.** The header must be `Authorization: Bearer <token>`, with a space after `Bearer`.
- **A token stopped working.** Tokens expire after 15 minutes, and logout blocks a token immediately. Log in again for a fresh one.
- **A TOTP code is rejected even though it looks right.** Each code is single-use, and codes are tied to a 30-second window. Wait for the next code rather than resending the last one, and check your clock is accurate.
- **Everything returns 429.** You hit a rate limit. The window is 15 minutes by default; the `Retry-After` header says how long to wait.

## See also

- [`api.md`](./api.md) — full endpoint contract, error shapes, and database schema
- [`threat-model.md`](./threat-model.md) — why these controls exist and what they defend against
