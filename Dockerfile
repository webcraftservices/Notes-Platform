# ============================================================================
# Zenote — Multi-Stage Production Dockerfile (Stage A)
#
# Targets:
#   - migrator : Runs `prisma migrate deploy` against PostgreSQL
#   - web      : Next.js 14 standalone server (`zenote-web`)
#   - worker   : Compiled BullMQ worker (`zenote-worker`, `dist/workers/index.cjs`)
#
# Base image pinned to Node 22.22.2 Bookworm slim:
#   - Satisfies `jsdom` >= 22.22.2 and `package.json` engines (`>=22.22.2`)
#   - Includes glibc + OpenSSL 3.0 compatible with Prisma & Sharp prebuilds
# ============================================================================

FROM node:22.22.2-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ----------------------------------------------------------------------------
# Full dependencies (dev + prod) with patch-package and generated Prisma Client
# ----------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY patches ./patches
COPY prisma ./prisma
RUN npm ci \
  && npx prisma generate

# ----------------------------------------------------------------------------
# Production-only dependencies (avoids devDependencies / tsx / patch-package)
# ----------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=deps /app/node_modules/pptx2html ./node_modules/pptx2html

# ----------------------------------------------------------------------------
# Database migration runner (one-shot job target)
# ----------------------------------------------------------------------------
FROM base AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs migrator \
  && chown -R migrator:nodejs /app
USER migrator
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# ----------------------------------------------------------------------------
# Build Next.js standalone bundle and compiled CJS worker bundle
# ----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_SITE_URL="https://zenote.app"
ARG NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY=""
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=""
ARG NEXT_PUBLIC_ZENOTE_DOWNLOAD_URL=""
ARG STORAGE_ENDPOINT=""
ARG CSP_EXTRA_CONNECT_SRC=""
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY=${NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY}
ENV NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION}
ENV NEXT_PUBLIC_ZENOTE_DOWNLOAD_URL=${NEXT_PUBLIC_ZENOTE_DOWNLOAD_URL}
ENV STORAGE_ENDPOINT=${STORAGE_ENDPOINT}
ENV CSP_EXTRA_CONNECT_SRC=${CSP_EXTRA_CONNECT_SRC}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
  && npm run build:worker \
  && rm -rf .next/standalone/.env* .next/standalone/.storage

# ----------------------------------------------------------------------------
# Runtime Target 1: Web Container (`zenote-web`)
# ----------------------------------------------------------------------------
FROM base AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV BULLMQ_DEDICATED_WORKER=true
ENV BULLMQ_EMBEDDED_WORKER=false
ENV BULLMQ_EMBEDDED_MAINTENANCE=false
ENV AZURE_CLOUD_ROLE_NAME=zenote-web
ENV DD_SERVICE=zenote-web
ENV ZENOTE_SERVICE_ROLE=zenote-web
ENV LOG_FORMAT=json

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p .next/cache/images /tmp/zenote-local-storage \
  && chown -R nextjs:nodejs /app/.next /tmp/zenote-local-storage \
  && chmod 775 /tmp/zenote-local-storage

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]

# ----------------------------------------------------------------------------
# Runtime Target 2: Dedicated Background Worker (`zenote-worker`)
# ----------------------------------------------------------------------------
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV BULLMQ_ENABLED=true
ENV BULLMQ_DEDICATED_WORKER=true
ENV WORKER_HEALTH_PORT=3001
ENV WORKER_SHUTDOWN_TIMEOUT_MS=25000
ENV AZURE_CLOUD_ROLE_NAME=zenote-worker
ENV DD_SERVICE=zenote-worker
ENV ZENOTE_SERVICE_ROLE=zenote-worker
ENV LOG_FORMAT=json

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs worker

COPY --from=prod-deps --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /app/prisma ./prisma
COPY --from=builder --chown=worker:nodejs /app/dist ./dist
RUN mkdir -p /tmp/zenote-local-storage \
  && chown -R worker:nodejs /tmp/zenote-local-storage \
  && chmod 775 /tmp/zenote-local-storage

USER worker
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/workers/index.cjs"]

