# JurisAI API server (Node/Express + Prisma).
# IMPORTANT: build context must be the REPO ROOT, because the server reads the
# catalog from ../content (resolves to /content in the image), which lives
# outside the server/ folder.
#   docker build -f server/Dockerfile -t ghcr.io/rit-services/jurisai-server:latest .

# --- Build stage: production dependencies + generated Prisma client ---
FROM node:20-alpine AS build

# Prisma needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

# Production dependencies only: the test runner, nodemon and their tooling never
# reach the runtime image. The prisma CLI is a regular dependency because the
# container runs `prisma db push` on every start.
COPY server/package*.json ./
RUN npm ci --omit=dev

# Generate the Prisma client.
COPY server/prisma ./prisma
RUN npx prisma generate

# Server source.
COPY server/ ./

# --- Runtime stage ---
FROM node:20-alpine

# npm, npx, yarn and corepack are removed: the server never runs them, and the
# packages they bundle carry known CVEs. The start command calls node directly.
RUN apk add --no-cache openssl \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

WORKDIR /app
COPY --from=build /app /app

# Catalog content (seed JSON, law/profile content). The server resolves it at
# ../../content from /app/prisma and /app/services/... -> /content.
COPY content /content

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Run as the image's built-in unprivileged user (uid 1000). /app stays
# root-owned and read-only to it; the only writable path is the uploads volume,
# made group-writable by the pod's fsGroup (see k8s manifests).
USER node

# Sync schema, seed the catalog (idempotent; demo users skipped in production),
# encrypt any pre-existing plaintext (idempotent), then run the API.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate && node prisma/seed.js && node scripts/backfillEncryption.js && node index.js"]
