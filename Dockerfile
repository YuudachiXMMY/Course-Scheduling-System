# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.21.0-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# P4-6: alpine cannot run Playwright's bundled Chromium; the runtime stage uses SYSTEM chromium.
# Skip the ~300 MB browser download so `npm ci` doesn't fail fetching a browser we never use here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS build
WORKDIR /app
# M5: NEXT_PUBLIC_* is INLINED into the client bundle at `next build` and CANNOT be overridden at
# runtime. Pass the real public origin as a build ARG (compose/CI supply it) so serverActions
# allowedOrigins resolves to the deployed domain instead of the localhost fallback.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
# P7b: VAPID public key inlined into the client bundle at build (compose/CI supply it). Empty default
# → Web Push subscribe button stays hidden and subscribeToPush() returns null (best-effort feature).
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=
# SKIP_ENV_VALIDATION: build context carries no secrets; env is validated at runtime/boot instead.
# The DATABASE_URL / BETTER_AUTH_* values here are BUILD-ONLY placeholders: Next 16 evaluates
# server modules (e.g. /api/auth/[...all] -> @/db) during page-data collection, and src/db/index.ts
# throws if DATABASE_URL is unset. No connection is made at build time, and the runtime stage below
# sets NO secrets — real values are injected at runtime by compose/Coolify.
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production SKIP_ENV_VALIDATION=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY} \
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
# B1: self-contained orphan-tenant cleanup, run by the entrypoint BEFORE migrate so an upgrade of a DB
# holding orphan tenant_id rows no longer crash-loops at 0016. Same shape as migrate (postgres + dotenv
# only, no @/ imports), so the same bundle flags apply.
RUN node_modules/.bin/esbuild scripts/cleanup-orphan-tenants.ts \
      --bundle --platform=node --format=esm --target=node24 \
      --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" \
      --external:cloudflare:sockets --outfile=dist/cleanup-orphan-tenants.mjs
# Self-contained admin seed: bundle better-auth + drizzle + postgres into one .mjs. Unlike migrate,
# seed-admin reuses @/db & @/auth/auth, which transitively `import 'server-only'` — the extra
# --conditions=react-server resolves that to an empty module (same trick as db:seed:e2e) so the bundle
# runs under plain Node. The createRequire banner covers CJS deps' dynamic require() (better-auth/postgres).
RUN node_modules/.bin/esbuild scripts/seed-admin.ts \
      --bundle --platform=node --format=esm --target=node24 --conditions=react-server \
      --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" \
      --external:cloudflare:sockets --outfile=dist/seed-admin.mjs

FROM build AS test
# Re-enable env validation for the test run. The build stage set SKIP_ENV_VALIDATION=1 (build
# context carries no secrets) and `FROM build` inherits it — but with validation skipped,
# @t3-oss/env returns raw process.env and NEVER applies zod .default()s. That left
# PORTAL_EMAIL_DOMAIN (and every other defaulted var) undefined at test runtime, so portal
# provisioning synthesized `portal_<id>@undefined`, which better-auth rejects → "Invalid email".
# CI injects the real required env at run time, so validation now passes AND applies defaults.
ENV NODE_ENV=test SKIP_ENV_VALIDATION=""
CMD ["npm", "run", "test"]

# P4-6: Debian runtime (NOT alpine) so Playwright can drive SYSTEM chromium; fonts-noto-cjk stops
# CJK 豆腐 in the rendered PNG (PRD's #1 risk). PLAYWRIGHT_CHROMIUM_PATH points browser.ts at it.
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Next's standalone file tracing misses playwright-core/browsers.json (loaded via a runtime-computed
# path), so the export routes 500 at import. Copy the full packages into the runtime node_modules to
# guarantee resolution. No browser binaries ship (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD during install) —
# we drive the SYSTEM chromium installed above via PLAYWRIGHT_CHROMIUM_PATH.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/playwright ./node_modules/playwright
COPY --from=build --chown=nextjs:nodejs /app/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=build --chown=nextjs:nodejs /app/dist/cleanup-orphan-tenants.mjs ./dist/cleanup-orphan-tenants.mjs
COPY --from=build --chown=nextjs:nodejs /app/dist/seed-admin.mjs ./dist/seed-admin.mjs
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./entrypoint.sh"]
