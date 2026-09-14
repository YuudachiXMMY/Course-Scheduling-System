#!/usr/bin/env bash
#
# dev.sh — one-command local development bootstrap.
#
# Local dev runs Postgres in Docker (docker compose service `postgres`, bound to
# 127.0.0.1) while Next.js runs on the host via `next dev` for fast hot-reload.
# This mirrors the "Local development" flow in README.md and makes it idempotent:
# safe to re-run any time.
#
#   ./dev.sh              # bootstrap env + deps + db, then start `next dev`
#   ./dev.sh --setup-only # do everything except start the dev server
#   ./dev.sh --full       # run EVERYTHING in containers (postgres + app) via compose
#   ./dev.sh --down       # stop the local Postgres container
#   ./dev.sh --reset-db   # drop the pgdata volume and re-migrate from scratch
#
set -euo pipefail

# --- locate repo root so the script works from any cwd -----------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- pretty logging ----------------------------------------------------------
c_reset=$'\033[0m'; c_blue=$'\033[34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'
log()  { printf '%s[dev]%s %s\n' "$c_blue"  "$c_reset" "$*"; }
ok()   { printf '%s[dev]%s %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%s[dev]%s %s\n' "$c_yellow" "$c_reset" "$*"; }
die()  { printf '%s[dev]%s %s\n' "$c_red"   "$c_reset" "$*" >&2; exit 1; }

# --- pick the package manager (repo declares pnpm@10; fall back to npm) -------
if command -v pnpm >/dev/null 2>&1; then
  PM=pnpm
elif command -v npm >/dev/null 2>&1; then
  PM=npm
  warn "pnpm not found — falling back to npm (repo declares packageManager: pnpm@10)."
else
  die "Neither pnpm nor npm found on PATH. Install Node.js first."
fi

# --- resolve the compose command (v2 plugin vs legacy binary) ----------------
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  die "docker compose is not available. Install Docker Desktop / the compose plugin."
fi

require_docker_running() {
  command -v docker >/dev/null 2>&1 || die "docker CLI not found on PATH."
  docker info >/dev/null 2>&1 || die "Docker daemon is not running. Start Docker Desktop and retry."
}

# --- .env bootstrap: create from example + fill in real secrets --------------
# Cross-platform in-place sed (BSD/macOS needs a '' arg to -i; GNU does not).
sed_i() {
  if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi
}

gen_secret() { openssl rand -base64 32; }
# URL-safe password (no @ / : / / that would break the DATABASE_URL DSN).
gen_password() { openssl rand -hex 24; }

ensure_env() {
  if [ -f .env ]; then
    log ".env already exists — leaving it untouched."
    return
  fi
  [ -f .env.example ] || die ".env.example is missing; cannot bootstrap .env."
  command -v openssl >/dev/null 2>&1 || die "openssl not found — needed to generate secrets."

  log "Creating .env from .env.example with fresh secrets…"
  cp .env.example .env

  local secret password
  secret="$(gen_secret)"
  password="$(gen_password)"

  # Better Auth secret.
  sed_i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${secret}|" .env
  # Postgres password + the matching DATABASE_URL (must use the same password).
  sed_i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${password}|" .env
  sed_i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://app:${password}@localhost:5432/course_scheduling|" .env

  ok "Wrote .env (BETTER_AUTH_SECRET + POSTGRES_PASSWORD auto-generated)."
}

# --- deps --------------------------------------------------------------------
ensure_deps() {
  if [ -d node_modules ]; then
    log "node_modules present — skipping install (delete it to force a clean install)."
    return
  fi
  log "Installing dependencies with $PM…"
  if [ "$PM" = "pnpm" ]; then pnpm install; else npm install; fi
  ok "Dependencies installed."
}

# --- postgres container ------------------------------------------------------
start_postgres() {
  require_docker_running
  log "Starting Postgres container…"
  "${DC[@]}" up -d postgres

  log "Waiting for Postgres to become healthy…"
  local i
  for i in $(seq 1 60); do
    local status
    status="$("${DC[@]}" ps --format '{{.Health}}' postgres 2>/dev/null || true)"
    if [ "$status" = "healthy" ]; then
      ok "Postgres is healthy."
      return
    fi
    sleep 1
  done
  die "Postgres did not become healthy within 60s. Check: ${DC[*]} logs postgres"
}

# --- schema + migrations -----------------------------------------------------
run_migrations() {
  # Better Auth CLI writes src/db/auth-schema.ts; only generate if it's missing
  # so we don't clobber a checked-in / hand-edited schema on every run.
  if [ ! -f src/db/auth-schema.ts ]; then
    log "Generating Better Auth schema (auth:generate)…"
    $PM run auth:generate
  fi

  # Drizzle SQL from the schema; safe to re-run (no-op when nothing changed).
  log "Generating Drizzle migrations (db:generate)…"
  $PM run db:generate

  log "Applying migrations (db:migrate — advisory-locked, idempotent)…"
  $PM run db:migrate
  ok "Database is migrated."
}

# --- subcommands -------------------------------------------------------------
cmd_down() {
  require_docker_running
  # Every compose command interpolates POSTGRES_PASSWORD (:? mandatory form),
  # so it needs .env to even parse. No .env => nothing was ever started.
  [ -f .env ] || { warn "No .env found — nothing to stop."; return; }
  log "Stopping local Postgres container…"
  "${DC[@]}" stop postgres
  ok "Postgres stopped (data volume preserved). Use --reset-db to wipe data."
}

cmd_reset_db() {
  require_docker_running
  ensure_env   # compose needs .env to interpolate POSTGRES_PASSWORD
  warn "This DROPS the pgdata volume — all local data will be lost."
  "${DC[@]}" down -v
  start_postgres
  run_migrations
  ok "Database reset and re-migrated."
}

cmd_full() {
  require_docker_running
  ensure_env
  log "Building and starting the full stack (postgres + app) in containers…"
  "${DC[@]}" up --build -d
  ok "Stack is up. App: http://localhost:3000  (health: curl -sf http://localhost:3000/api/health)"
  log "Follow logs with: ${DC[*]} logs -f app"
}

cmd_dev() {
  local setup_only="${1:-false}"
  ensure_env
  ensure_deps
  start_postgres
  run_migrations
  if [ "$setup_only" = "true" ]; then
    ok "Setup complete. Start the dev server with: $PM run dev"
    return
  fi
  ok "Setup complete — starting Next.js dev server on http://localhost:3000"
  exec $PM run dev
}

# --- arg parsing -------------------------------------------------------------
case "${1:-}" in
  --full)       cmd_full ;;
  --down)       cmd_down ;;
  --reset-db)   cmd_reset_db ;;
  --setup-only) cmd_dev true ;;
  -h|--help)
    # Print only the leading comment block (stop at the first non-comment line).
    awk 'NR>1 && !/^#/ {exit} NR>1 {sub(/^# ?/,""); print}' "$0"
    ;;
  "")           cmd_dev false ;;
  *)            die "Unknown option: $1  (try --help)" ;;
esac
