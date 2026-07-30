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

A plain `docker compose up` builds the API as a compiled production image with no watchers; the frontend still runs its Vite dev server. Pass both `-f` flags above to get the API dev target with source mounted and hot reload.

Shared frontend/backend types live in `packages/shared`.

## Backend and API

The API is Node.js + Express + TypeScript over PostgreSQL, served at `http://localhost:5001` with routes under `/api/v1`. It handles registration, sign in, sessions, TOTP multi-factor authentication, and CRUD for encrypted vault items, with every vault query scoped to its owner.

It is zero-knowledge by construction: the master password and the master key never leave the browser, so the server only ever receives a client-derived auth key (which it stores as an Argon2id hash) and opaque ciphertext blobs. No column in the database holds a plaintext credential or any key that could decrypt a vault.

- **[docs/api.md](docs/api.md)** — full endpoint reference, error contract, and database schema
- **[docs/api-testing.md](docs/api-testing.md)** — manual curl runbook for testing the API locally

## Testing

```bash
npm test --workspace=api        # integration tests (needs Docker running)
npm test --workspace=frontend
npm test --workspace=packages/crypto
```
