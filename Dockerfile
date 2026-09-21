# One runtime image: web and worker differ only in command (see compose.yaml).

FROM node:24-bookworm-slim AS base
# Prisma's query engine links against OpenSSL; slim images leave it out.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# npm ci does not generate the client in this repo, so do it explicitly.
RUN npx prisma generate
# Route modules open the database on import. A throwaway file keeps the build from logging
# connection errors; nothing from /tmp reaches the runtime image.
RUN DATABASE_URL=file:/tmp/build.db npm run build
RUN npm run build:worker

# Runs `prisma migrate deploy` once before web and worker start. It carries the full dev
# toolchain, which is why it is its own stage rather than part of the runtime image.
FROM deps AS migrate
COPY prisma ./prisma
RUN npx prisma generate
USER node
# Compose re-runs this on every `up`, including while web and workers are live. Prisma's
# migrate engine cannot take its lock while any other connection has the file open, so deploy
# would fail every time. `migrate status` only reads, and exits 0 when nothing is pending.
CMD ["sh", "-c", "if npx prisma migrate status >/dev/null 2>&1; then echo 'Schema is up to date.'; else exec npx prisma migrate deploy; fi"]

FROM base AS runner
ENV NODE_ENV=production PORT=3000
# Docker sets HOSTNAME to the container id, and the standalone server binds to it.
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist/worker.js ./dist/worker.js
# The worker is bundled outside Next's file trace, so bring the Prisma client over explicitly
# rather than relying on the server happening to import it too.
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client

# uid 1000, which matches the usual host user, so the ./data bind mount stays writable.
RUN mkdir -p data && chown node:node data
USER node

EXPOSE 3000
CMD ["node", "server.js"]
