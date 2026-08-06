# Secure Password Manager

A zero-knowledge password manager. The browser derives the keys and encrypts the data; the server stores ciphertext it cannot read.

## Setup

```bash
./scripts/setup.sh   # generates .env with fresh random secrets, builds images
./scripts/start.sh   # starts db, api, frontend
```

`setup.sh` is required on a fresh checkout — the API refuses to start without generated secrets, and it leaves an existing `.env` untouched.

Then open:

- Frontend: http://localhost:5173
- API health check: http://localhost:5001/api/health

### Running with Compose directly

```bash
docker compose up                                                    # production (default)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up    # dev, opt-in
```

A plain `docker compose up` builds both app images as production: the API is compiled TypeScript run by Node, and the frontend is a static Vite bundle served by nginx. Neither has watchers, source mounts, or dev dependencies. Pass both `-f` flags above to get the dev targets instead — the API under `tsx watch` and the frontend on the Vite dev server with hot reload, both with source mounted.

In production the frontend container also reverse-proxies `/api` to the API container, so the browser talks to a single origin and the bundle contains no hardcoded API URL. `http://localhost:5173/api/health` therefore works too, and the API stays reachable directly on `http://localhost:5001` for the curl runbook.

Shared frontend/backend types live in `packages/shared`.

### Deploying to Azure

The stack runs on Azure Container Apps in `rg-pwmgr-dev`: `ca-pwmgr-web-dev-001` (nginx + bundle) and `ca-pwmgr-api-dev-001` (API), against the `psql-pwmgr-dev-1ce74e` flexible server. Images are built in the registry rather than locally, which avoids cross-compiling for `linux/amd64` from an Apple Silicon machine:

```bash
az acr build --registry crpwmgrdev1ce74e --image pwmgr-web:v2 \
  --file frontend/Dockerfile --target prod --platform linux/amd64 .
az containerapp update -n ca-pwmgr-web-dev-001 -g rg-pwmgr-dev \
  --image crpwmgrdev1ce74e.azurecr.io/pwmgr-web:v2
```

The same image serves both environments; only `API_UPSTREAM` differs. It defaults to the Compose service (`http://api:5000`) and is set on the deployed app to the API's public FQDN, because a bare container app name only resolves for apps with internal ingress. If the API's URL ever changes, update that variable and the API's own `FRONTEND_ORIGIN` — nothing is baked into the bundle.

## Backend and API

The API is Node.js + Express + TypeScript over PostgreSQL, served at `http://localhost:5001` with routes under `/api/v1`. It handles registration, sign in, sessions, TOTP multi-factor authentication, and CRUD for encrypted vault items, with every vault query scoped to its owner.

It is zero-knowledge by construction: the master password and the master key never leave the browser, so the server only ever receives a client-derived auth key (which it stores as an Argon2id hash) and opaque ciphertext blobs. No column in the database holds a plaintext credential or any key that could decrypt a vault.

- **[docs/api.md](docs/api.md)** — full endpoint reference, error contract, and database schema
- **[docs/threat-model.md](docs/threat-model.md)** — assets, threats, mitigations, and explicit non-goals
- **[docs/api-testing.md](docs/api-testing.md)** — manual curl runbook for testing the API locally

## Client-side cryptography

All key derivation and encryption happens in the browser, in `packages/crypto`. A master password and a per-user salt go through one Argon2id run (64 MiB, 3 iterations by default) to produce a master key, which is then split via HKDF into two independent keys: an `authKey` (raw bytes, sent to the server as the login credential — the only key-derived material that ever leaves the browser) and an `encryptionKey` (a non-extractable AES-256-GCM `CryptoKey` that never leaves, not even in principle — `crypto.subtle.exportKey` on it rejects).

Vault items are encrypted with AES-256-GCM under a fresh random 12-byte nonce per call and encoded as `version‖nonce‖ciphertext`, base64-encoded, before being sent to the API — this is the `encryptedData` the server stores and never parses. To survive a page reload without re-deriving the key, `frontend/src/keyStore.ts` persists the `CryptoKey` handle itself (not its bytes) in IndexedDB, scoped to the session and cleared when it ends.

- **[docs/crypto-threat-model.md](docs/crypto-threat-model.md)** — key derivation, encryption, payload handling, and their non-goals (XSS, decrypted plaintext in memory)

## Testing

```bash
npm test --workspace=api        # integration tests (needs Docker running)
npm test --workspace=frontend
npm test --workspace=packages/crypto
```
