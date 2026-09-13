# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.21.0-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS build
WORKDIR /app
# SKIP_ENV_VALIDATION: build context carries no secrets; env is validated at runtime/boot instead.
# The DATABASE_URL / BETTER_AUTH_* values here are BUILD-ONLY placeholders: Next 16 evaluates
# server modules (e.g. /api/auth/[...all] -> @/db) during page-data collection, and src/db/index.ts
# throws if DATABASE_URL is unset. No connection is made at build time, and the runtime stage below
# sets NO secrets — real values are injected at runtime by compose/Coolify.
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production SKIP_ENV_VALIDATION=1 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Self-contained migrator: bundle drizzle-orm + postgres into one .mjs (no drizzle-kit in runtime).
# The createRequire banner supplies a real `require` so CJS deps bundled into ESM output
# (dotenv/postgres internals calling require('fs') etc.) resolve at runtime instead of
# hitting esbuild's "Dynamic require is not supported" shim.
RUN node_modules/.bin/esbuild scripts/migrate.ts \
      --bundle --platform=node --format=esm --target=node24 \
      --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" \
      --external:cloudflare:sockets --outfile=dist/migrate.mjs

FROM build AS test
ENV NODE_ENV=test
CMD ["npm", "run", "test"]

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
# PHASE 4/5 ONLY: CJK fonts (apk add font-noto-cjk / switch to node:24-slim + fonts-noto-cjk) for Playwright/@react-pdf. NOT now.
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./entrypoint.sh"]
