#!/bin/sh
set -e
echo "[entrypoint] applying migrations"
node /app/dist/migrate.mjs           # idempotent + advisory-locked; non-zero abort => never serve a half-migrated schema
echo "[entrypoint] seeding default admin (idempotent)"
node /app/dist/seed-admin.mjs        # idempotent + advisory-locked; skips (exit 0) if ADMIN_* unset, aborts on real error
echo "[entrypoint] starting next standalone server"
exec node /app/server.js
