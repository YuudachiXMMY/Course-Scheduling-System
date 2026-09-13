# Implementation Report: Phase 1 — Foundation & Deploy

## Summary

Implemented the Phase 1 foundation **end-to-end** in the worktree: Next.js 16 (App Router, React 19, `src/` layout, Turbopack, `output: 'standalone'`) + PostgreSQL 17 + Drizzle ORM (postgres.js) + Better Auth 1.7 (Organization + Admin/RBAC), a data-layer tenant-isolation spine (`context` → `authorize` → `forTenant`), the full `tenant_id`-everywhere domain schema (18 tables, composite `(tenant_id, id)` FKs), and full containerization (multi-stage Dockerfile + docker-compose + CI + esbuild-bundled migrator). Deployed and **running locally in Docker** (app + postgres both healthy). Only Task 10 (Coolify **remote** deploy) is deferred — it is documented and the image builds + health-checks locally.

Execution was delegated to an implementation subagent working in the worktree; **every validation gate was then independently re-verified by the parent**, and two robustness gaps in the isolation test were found and fixed (see Deviations).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large → XL (~45 files) | XL — **59 files**, 15,385 lines |
| Confidence | 8.5/10 | Realized — all executable gates green on independent re-check |
| Files Changed | ~45 CREATE | 59 CREATE |
| DB tables | full core schema | 18 tables + `__drizzle_migrations` |
| Composite FKs | tenant-safe `(tenant_id,id)` | 16 `fk_*` composite constraints |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Scaffold Next.js 16 (src/) + base config | ✅ Complete | Skipped `create-next-app`; wrote every file directly (avoids non-empty-dir error) |
| 2 | Drizzle + postgres.js client & config | ✅ Complete | HMR-safe singleton, `casing:'snake_case'`, pinned `0.45.2`/`0.31.10`/`3.4.9` |
| 3 | Full domain schema (tenant_id everywhere) | ✅ Complete | 10 schema files + barrel re-exporting `../auth-schema` (R8) |
| 4 | Better Auth (org + admin/RBAC) + generate schema | ✅ Complete | `auth@latest` CLI (R4); `@better-auth/drizzle-adapter@1.7.4` (no R5 fallback); `nextCookies()` last (R6) |
| 5 | Authorization spine (context/authorize/forTenant/proxy) | ✅ Complete | grep guard clean; role re-derived from DB `member` row |
| 6 | Generate & apply first migration | ✅ Complete | `0000_*.sql`, 18 tables live; reordered indexes-before-FKs (deviation) |
| 7 | Login/dashboard stubs + example guarded mutation | ✅ Complete | verify→authorize→scope; owner-org seeding documented as runtime step |
| 8 | Containerization | ✅ Complete | Node 24 alpine non-root(1001), bundled migrator, healthcheck, entrypoint |
| 9 | CI + tenant-isolation test | ✅ Complete | vitest + GH Actions; test now **re-runnable** (parent fix) |
| 10 | Coolify remote deploy | ⏸️ Deferred | Remote infra; artifacts exist, image builds + health-checks locally |

## Validation Results (independently re-verified by parent)

| Level | Status | Evidence |
|---|---|---|
| Static — typecheck | ✅ Pass | `tsc --noEmit` exit 0 (re-run after parent edits) |
| Static — lint | ✅ Pass | `eslint .` exit 0 (native flat config) |
| Build | ✅ Pass | Turbopack build emits `.next/standalone/server.js` (artifact confirmed) |
| Migrate | ✅ Pass | 18 tables live; `lesson.start_at/end_at` = `timestamptz`; 16 composite FKs; migrator idempotent (advisory lock) |
| Unit — tenant isolation | ✅ Pass | **3/3, twice consecutively** via plain `npm run test` (IDOR read / update / insert-smuggle all blocked) |
| Docker health | ✅ Pass | `docker compose ps`: app + postgres both **healthy**; live `curl /api/health` → `{"ok":true}`; `--user 1001` → `uid=1001(nextjs)` |
| Security grep guard | ✅ Pass | no direct `db.*(` calls in `src/app`/`src/auth` (feature code uses `forTenant` only) |

## Files Changed

59 files created (0 modified — greenfield). Highlights:

| Area | Files | Notes |
|---|---|---|
| App config | `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `.prettierrc.json`, `src/env.ts` | Standalone, CSRF origins, env fail-fast, Tailwind v4 |
| DB / schema | `src/db/index.ts`, `src/db/tenant.ts`, `src/db/schema/*` (10), `src/db/auth-schema.ts` (generated), `drizzle.config.ts`, `scripts/migrate.ts`, `drizzle/0000_*.sql` | 18 tables, composite FKs, conflict indexes |
| Auth / RBAC | `src/auth/{auth,permissions,client,context,authorize}.ts`, `src/app/api/auth/[...all]/route.ts`, `proxy.ts` | Two AC universes, data-layer spine |
| App routes | `src/app/{layout,page,globals.css}`, `(auth)/*`, `(dashboard)/*`, `api/health/route.ts` | zh-Hans + CJK stack |
| Infra | `Dockerfile`, `docker/entrypoint.sh`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/ci.yml` | test==prod on one image |
| Tests | `vitest.config.ts`, `tests/{tenant-isolation.test.ts,server-only-stub.ts}` | Phase-1 success signal |

## Deviations from Plan

All are justified engineering reconciliations (the schema/security/architecture are exactly as planned):

1. **Skipped `create-next-app`** — wrote all files directly (avoids non-empty-dir scaffold error; deterministic).
2. **Tailwind v4 wiring added** — `tailwindcss@^4` + `@tailwindcss/postcss@^4` + `postcss.config.mjs` (plan's `globals.css` implied it but didn't list it).
3. **vitest wiring** — `vite-tsconfig-paths` for the `@` alias + a `server-only` stub (poison-pill would abort test on `@/db` import).
4. **ESLint uses `eslint-config-next@16` native flat configs** — `FlatCompat.extends('next/…')` crashes ESLint 9 (`Converting circular structure to JSON`); native arrays apply identical rules.
5. **Migration SQL reordered** — `CREATE [UNIQUE] INDEX` before composite-FK `ALTER` (drizzle-kit emits FKs first → Postgres 42830). This is the exact composite-FK ordering issue the plan's research flagged.
6. **`SKIP_ENV_VALIDATION` + build-only env placeholders** — Next 16 evaluates server modules during build; `src/db/index.ts` throws if `DATABASE_URL` unset. The runtime image bakes **no** secrets; real values come from Coolify/compose.
7. **esbuild `--banner` injecting `createRequire`** — the ESM-bundled migrator's CJS `dotenv` needs a real `require`.
8. **npm instead of pnpm** — the plan's Dockerfile deps stage uses `npm ci`; one `package-lock.json` serves local + container (no lockfile drift). Run-scripts identical.
9. **compose postgres host port overridable (5432 default, 5433 locally)** — 5432 was occupied; intra-compose + prod/CI stay 5432.
10. **`auth generate` temporarily neutralized `server-only`** — the CLI can't resolve a config whose import chain hits the poison-pill; swapped for the single generate call and restored.
11. **Parent fix — isolation test made robust (2 changes):**
    - `vitest.config.ts`: added `setupFiles: ['dotenv/config']` so `npm run test` auto-loads `.env` (vitest, unlike Next, does not).
    - `tests/tenant-isolation.test.ts`: `beforeAll`/`afterAll` now clean fixtures (`org` cascade + `user`) so the suite is **re-runnable against a persistent DB**, not only a fresh CI service. Fixed a duplicate-key failure on re-run; the security assertions are unchanged and pass 3/3 repeatably.

## Issues Encountered & Resolved

- **Isolation test not idempotent** (found by parent re-verification): first run seeded `org_a/org_b/user_a/user_b` into the persistent docker volume; re-run hit `organization_pkey` duplicate → `beforeAll` threw → 3 skipped. **Resolved** by clean-before-insert (Deviation 11). The security logic was always correct (passed on clean DB).
- **`npm run test` missing env** (found by parent): vitest doesn't auto-load `.env`. **Resolved** via `setupFiles: ['dotenv/config']`.
- All other issues (Tailwind, ESLint flat config, migration ordering, esbuild ESM/CJS, build-time env) were resolved by the implementation agent during its validation loop.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `tests/tenant-isolation.test.ts` | 3 | Cross-tenant IDOR read blocked; cross-tenant update blocked (0 rows); insert cannot smuggle a foreign `tenantId` (overwritten from ctx) — the Phase-1 success signal, re-runnable |

## Next Steps
- [ ] `/code-review` the diff before merge (optional; recommended for the security spine)
- [x] Report created; PRD Phase 1 → complete; plan archived
- [ ] **Task 10 (deferred)**: provision Coolify — managed Postgres 17 + S3 backups, app via Dockerfile build pack, secret env vars (`DATABASE_URL`/`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`), domain + auto SSL, push-to-deploy. Then verify `https://<domain>/api/health`.
- [ ] Seed the first owner + organization in prod (sign up → `organization.create`) so login yields an active tenant.
- [ ] Proceed to **Phase 2 — Core Scheduling + Conflict** (`/prp-plan` on the PRD). The schema already supports it (RRULE fields, conflict indexes, `uq_lesson_section_slot`); consider adding the GiST exclusion constraint for hard overlap prevention.
