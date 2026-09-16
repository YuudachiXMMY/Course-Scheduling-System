# 课程排课系统 · Course Scheduling System

Phase 1 foundation: Next.js 16 (App Router, React 19) + PostgreSQL + Drizzle ORM + Better Auth
(Organization + Admin/RBAC), a data-layer-enforced multi-tenant authorization spine, and full
containerization (multi-stage Dockerfile + docker-compose + Coolify deploy).

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (Turbopack default, App Router, `output: 'standalone'`) |
| DB / ORM | PostgreSQL 17 + Drizzle ORM (`postgres.js` driver) |
| Auth | Better Auth 1.7 (organization + admin plugins) |
| IDs | `text` + `nanoid` (non-guessable, tenant-safe) |
| Tenancy | every domain table carries `tenant_id`; the only trusted tenant is `session.activeOrganizationId` |

## Local development

```bash
./dev.sh                        # one command: .env + deps + Postgres + migrate + `next dev`
```

`dev.sh` is idempotent (safe to re-run). Other modes: `./dev.sh --setup-only`,
`./dev.sh --full` (everything in containers), `./dev.sh --down`, `./dev.sh --reset-db`.

<details><summary>Manual steps (what <code>dev.sh</code> automates)</summary>

```bash
cp .env.example .env            # then set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npm install
docker compose up -d postgres   # local Postgres 17
npm run auth:generate           # writes src/db/auth-schema.ts (Better Auth CLI)
npm run db:generate             # writes ./drizzle/0000_*.sql
npm run db:migrate              # applies migrations (advisory-locked)
npm run dev                     # http://localhost:3000
```

</details>

## Validation

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run build       # Next 16 Turbopack -> .next/standalone/server.js
npm run test        # vitest — tenant-isolation suite (needs a running Postgres)
```

### End-to-end (Playwright)

Full user-flow coverage across login/signup, dashboard (schedule, courses, students, reschedule,
reports, calendar feed), the parent/student portal, and public share links. Runs against the **real
running app** + a dedicated, auto-seeded fixture tenant in its Postgres.

```bash
cp .env.e2e.example .env.e2e   # set E2E_DATABASE_URL to the app's DB (docker: host port, often 5433)
npm run test:e2e               # global-setup seeds the fixture + signs roles in, then runs the suite
npm run test:e2e:ui            # interactive
npm run test:e2e:report        # open the last HTML report
npm run db:seed:e2e            # (re)seed only — idempotent; wipes + recreates the E2E tenant
```

Requires the app reachable at `E2E_BASE_URL` (default `http://localhost:3000` — e.g. `./dev.sh` or the
compose stack) and a migrated DB. The seed (`scripts/seed-e2e.ts`) writes ONLY to a dedicated
`e2e_org_main` tenant + `@e2e.local` accounts, so it is safe against a shared dev database. Spec
authoring conventions live in [`tests/e2e/AUTHORING.md`](tests/e2e/AUTHORING.md).

## Containers

```bash
docker build --target runtime -t app:prod .
docker compose up --build -d          # postgres + app; migrates on boot, serves on :3000
curl -sf http://localhost:3000/api/health   # {"ok":true}
docker compose --profile test run --rm test # migrate + tenant-isolation tests in-container
```

## Security model

- Authorization is enforced **in the data layer** (`src/auth/context.ts`, `src/auth/authorize.ts`,
  `src/db/tenant.ts`), never in `proxy.ts` alone (CVE-2025-29927 — spoofable middleware header).
- `proxy.ts` (Next 16, not `middleware.ts`) is redirect-only UX; every Server Action / Route Handler
  re-checks `requireAuthContext()` + `requirePermission()`.
- `forTenant(ctx)` is the only sanctioned way to touch tenant data: it injects `tenant_id` from the
  verified session on insert and scopes every read/update/delete to the caller's tenant.

## Deploy (Coolify — Phase 1, Task 10)

- App: **Dockerfile build pack**, exposes port `3000`, push-to-deploy, auto Let's Encrypt via Traefik.
- Postgres: a **separate managed PostgreSQL 17** resource; enable S3 backups (cron `0 */4 * * *`, retention ≥ 7).
- Env vars set as **secrets**: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`.
- Migrations run on container boot from `docker/entrypoint.sh` (bundled `dist/migrate.mjs`).
