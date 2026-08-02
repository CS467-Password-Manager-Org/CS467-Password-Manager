# syntax=docker/dockerfile:1

# Matches api/Dockerfile and the node-version pin in .github/workflows/ci.yml.
ARG NODE_IMAGE=node:22-slim
# Alpine keeps the served image small; nothing here needs glibc, because the
# prod stage runs no Node code at all — only static files and a proxy.
ARG NGINX_IMAGE=nginx:1.29-alpine

# ---------------------------------------------------------------------------
# deps — dependency install shared by the dev and build stages. Only manifests
# are copied so this layer caches until a package.json moves.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/crypto/package.json ./packages/crypto/package.json

# `npm ci`, not `npm install`: the lockfile is the contract. This works on both
# linux/x64 and linux/arm64 because the root package.json pins the native
# toolchain binaries for both — npm records optional platform packages only for
# the host that generated the lockfile (npm/cli#4828), and a lockfile written on
# a Mac would otherwise leave a Linux build with no rolldown binding at all.
#
# This file used to run `rm -f package-lock.json && npm install` to work around
# that. Deleting the lockfile let every transitive dependency float to whatever
# had published most recently, which is not acceptable in a security product.
RUN npm ci --workspace=frontend --workspace=@app/shared --workspace=@app/crypto

# ---------------------------------------------------------------------------
# dev — Vite dev server with HMR. Reachable ONLY via docker-compose.dev.yml;
# a plain `docker compose up` must never resolve here.
# ---------------------------------------------------------------------------
FROM deps AS dev
ENV NODE_ENV=development
COPY frontend ./frontend
COPY packages/shared ./packages/shared
COPY packages/crypto ./packages/crypto
WORKDIR /app/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# ---------------------------------------------------------------------------
# build — type-check and bundle. .dockerignore excludes dist, so the image
# always compiles its own output instead of inheriting a developer's local
# build. Do not un-ignore dist to shortcut this.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY frontend ./frontend
COPY packages/shared ./packages/shared
COPY packages/crypto ./packages/crypto
RUN npm run build --workspace=frontend

# ---------------------------------------------------------------------------
# prod — the default target. Static bundle behind nginx, which also proxies
# /api to the api service so the browser talks to a single origin.
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS prod
# No Node runtime, no source, no node_modules: nothing but the built assets and
# the proxy config reaches production.
#
# The config is a template, not a finished nginx.conf: the API upstream differs
# per environment (a sibling container under Compose, a platform ingress once
# deployed) and baking it in would mean a separate image per environment. The
# base image's entrypoint renders it with envsubst at startup.
COPY frontend/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Without a filter, the entrypoint substitutes every environment variable it can
# see, which would blank out nginx's own $host, $uri and $request_uri. Pin the
# substitution to exactly the placeholders the template declares.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
ENV NGINX_ENVSUBST_FILTER="^(API_UPSTREAM|NGINX_LOCAL_RESOLVERS)$"
# Opts into the base image's 15-local-resolvers.envsh, which exports
# NGINX_LOCAL_RESOLVERS from /etc/resolv.conf before the template is rendered.
# nginx cannot read resolv.conf itself and the address differs per platform
# (127.0.0.11 under Docker, something else on a managed container host), so
# hardcoding either one would break the other environment.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
# Overridden per deployment; this default is the Compose service name.
ENV API_UPSTREAM=http://api:5000

# The base image already ships this unprivileged user; the template keeps the
# pid file and temp paths in /tmp so the master process needs no root. /etc/nginx
# has to be writable because that is where the rendered config lands — the
# entrypoint runs as this same user and cannot write a root-owned directory.
RUN chown -R nginx:nginx /etc/nginx
USER nginx
EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:5173/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
