#!/bin/sh
set -e
echo "[entrypoint] cleaning orphan tenant rows (pre-migrate)"
node /app/dist/cleanup-orphan-tenants.mjs  # B1: idempotent + advisory-locked + fresh-DB-safe. MUST run
                                           # before migrate: 0016 adds tenant_id FKs and would crash-loop
                                           # the container on any DB holding orphan rows. No-op on a clean
                                           # or brand-new DB (0 rows / no schema yet).
echo "[entrypoint] clearing pre-0015 room overlaps (pre-migrate)"
node /app/dist/cleanup-room-overlaps.mjs --fix  # F4: idempotent (skips once 0015's EXCLUDE constraint
                                                # exists) + advisory-locked + fresh-DB-safe. MUST run
                                                # before migrate: 0015 adds an EXCLUDE constraint that
                                                # crash-loops the container on any pre-0015 DB holding
                                                # same-room time-overlapping lessons (app-layer never
                                                # checked room conflicts before 0015). --fix cancels the
                                                # later lesson of each overlap; no-op on a clean DB.
echo "[entrypoint] applying migrations"
node /app/dist/migrate.mjs           # idempotent + advisory-locked; non-zero abort => never serve a half-migrated schema
echo "[entrypoint] seeding default admin (idempotent)"
node /app/dist/seed-admin.mjs        # idempotent + advisory-locked; skips (exit 0) if ADMIN_* unset, aborts on real error
echo "[entrypoint] starting next standalone server"
exec node /app/server.js
