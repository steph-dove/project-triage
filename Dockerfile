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
# npm ci does not generate the Prisma client in this repo.
RUN npx prisma generate
# Route modules open the database on import, so give the build a throwaway file to open.
RUN DATABASE_URL=file:/tmp/build.db npm run build
RUN npm run build:worker

# Its own stage because the Prisma CLI needs the full dev install, which the runtime image leaves out.
FROM deps AS migrate
COPY prisma ./prisma
RUN npx prisma generate
USER node
# `migrate deploy` fails with "database is locked" while web and workers hold the file, so skip it unless something is pending.
CMD ["sh", "-c", "if npx prisma migrate status >/dev/null 2>&1; then echo 'Schema is up to date.'; else exec npx prisma migrate deploy; fi"]

FROM base AS runner
ENV NODE_ENV=production PORT=3000
# Docker sets HOSTNAME to the container id, and the standalone server binds to it.
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist/worker.js ./dist/worker.js
# The worker bundle is outside Next's file trace, so it can't rely on the server pulling Prisma in.
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client

# uid 1000, which matches the usual host user, so the ./data bind mount stays writable.
RUN mkdir -p data && chown node:node data
USER node

EXPOSE 3000
CMD ["node", "server.js"]
