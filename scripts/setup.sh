#!/usr/bin/env bash
# One-time (or occasional) setup: writes .env with generated secrets, builds images.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Hex, not base64: POSTGRES_PASSWORD is interpolated into DATABASE_URL by
# docker-compose.yml, and base64's "+" and "/" corrupt the URL's authority.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    # Not `tr -dc … < /dev/urandom | head -c 64`: head closes the pipe as soon
    # as it has enough bytes, the upstream takes SIGPIPE and exits 141, and
    # `set -o pipefail` turns that into a silent abort partway through.
    # dd reads a bounded amount instead, so nothing is left writing to a
    # closed pipe.
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'
  fi
}

if [ -f .env ]; then
  echo ".env already exists — leaving it untouched."
else
  # Generated up front so `set -e` aborts on a failed draw rather than writing
  # a .env with an empty secret in it.
  pg_password="$(gen_secret)"
  jwt_secret="$(gen_secret)"
  salt_pepper="$(gen_secret)"

  umask 077
  cat > .env <<EOF
POSTGRES_USER=app
POSTGRES_PASSWORD=${pg_password}
POSTGRES_DB=app
POSTGRES_PORT=5433

API_PORT=5001
FRONTEND_PORT=5173

JWT_SECRET=${jwt_secret}
SALT_PEPPER=${salt_pepper}
JWT_EXPIRES_IN_SECONDS=900

FRONTEND_ORIGIN=http://localhost:5173
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=100
AUTH_VERIFY_RATE_LIMIT_WINDOW_MS=900000
AUTH_VERIFY_RATE_LIMIT_MAX_PER_ACCOUNT=10
AUTH_VERIFY_RATE_LIMIT_MAX_PER_IP=30
EOF
  chmod 600 .env
  echo "Created .env with freshly generated secrets (owner-readable only)."
fi

docker compose build
echo "Setup complete. Run ./scripts/start.sh to start the app."
echo "Note: if you ever rotate POSTGRES_PASSWORD, run ./scripts/reset-db.sh first —"
echo "Postgres only applies it when the data directory is initialized, so an"
echo "existing volume keeps the old password and the API cannot connect."
