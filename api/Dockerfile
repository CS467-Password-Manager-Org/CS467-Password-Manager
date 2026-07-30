# syntax=docker/dockerfile:1

# node:22-slim is glibc-based and already the repo's base image. argon2 ships
# prebuilt bindings for linux-x64/arm64 on both glibc and musl, so alpine would
# also work — slim is chosen to keep the native-module surface boring.
ARG NODE_IMAGE=node:22-slim

# ---------------------------------------------------------------------------
# deps — full dependency install, shared by the build and dev stages.
# Only the manifests are copied so this layer caches until a package.json moves.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
# `npm ci --workspace=api` succeeds without frontend/ or packages/crypto/ being
# present in the context, so the lockfile is honoured and no `rm package-lock.json`
# workaround is needed. Deleting the lockfile (as frontend/Dockerfile does) would
# let transitive dependencies float to unpinned versions in a security product.
RUN npm ci --workspace=api

# ---------------------------------------------------------------------------
# build — compile TypeScript. .dockerignore excludes dist, so this is hermetic:
# the image compiles its own output instead of inheriting whatever a developer
# happened to have on disk. Do not un-ignore dist to shortcut this.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY api ./api
COPY packages/shared ./packages/shared
RUN npm run build --workspace=api

# ---------------------------------------------------------------------------
# dev — watchers and source. Reachable ONLY via docker-compose.dev.yml; a plain
# `docker compose up` must never resolve here (OPS-03).
# ---------------------------------------------------------------------------
FROM deps AS dev
ENV NODE_ENV=development
COPY api ./api
COPY packages/shared ./packages/shared
EXPOSE 5000
CMD ["npm", "run", "dev", "--workspace=api"]

# ---------------------------------------------------------------------------
# prod-deps — runtime dependencies only. A separate `npm ci --omit=dev` rather
# than pruning `deps`, because pruning would mutate a layer `build` still
# depends on and defeat its cache.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --workspace=api --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# prod — the default target. Built output plus runtime deps, nothing else.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --chown=node:node api/package.json ./api/package.json
# npm ci links node_modules/@app/shared -> ../../packages/shared. Nothing in
# api/dist imports it at runtime (every @app/shared import is `import type`, so
# tsc erases it), but shipping the 2 KB package keeps the symlink resolvable if
# a value import is ever added.
COPY --chown=node:node packages/shared ./packages/shared
COPY --from=build --chown=node:node /app/api/dist ./api/dist

# The base image already ships a non-root user at uid/gid 1000 — no new account
# is created here. A root-running container turns an escape into host access.
USER node
EXPOSE 5000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "api/dist/index.js"]
