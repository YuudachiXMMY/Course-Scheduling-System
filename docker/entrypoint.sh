#!/bin/sh
set -e
echo "[entrypoint] applying migrations"
node /app/dist/migrate.mjs           # idempotent + advisory-locked; non-zero abort => never serve a half-migrated schema
echo "[entrypoint] starting next standalone server"
exec node /app/server.js
