# Implementation Report: Phase 4 — Parent Sharing & Export (WeChat-first)

## Summary

Implemented the Phase-4 plan end to end: one styled React schedule template (`src/lib/schedule-card.tsx`) drives **three parent-facing renders** — a WeChat-friendly **PNG** (headless Chromium at `deviceScaleFactor: 2`, CJK fonts, embedded scan-to-open QR), a public **read-only web page** at an unguessable `/s/<token>` (`noindex` + PIPL notice footer), and a **`.ics`** attachment (reusing Phase-3's `buildIcs`/`feedWindow`). A small-group **batch export** streams a `.zip` (via `archiver`) with one folder per enrolled student, each sliced to that student's own non-canceled lessons in a rolling window. A new per-student `share_link` capability table (revocable, one-active-per-student partial-unique) is the token model; the public read path is the **second and last** sanctioned `forTenant` exception (`src/lib/share.ts`), scoped strictly by the token-resolved `tenantId`/`studentId`. Postgres stays the single source of truth — nothing reads an external calendar.

**Status**: implemented, reviewed (**PR #6 — APPROVE**, no CRITICAL/HIGH), and **merged** (`e76535d`). Two post-implementation fixes landed on the branch before merge: Playwright singleton recovery (review M1) and a Turbopack CI build fix. This report is the **closeout**: the phase was re-validated on the current tree (typecheck, lint, full test suite, migrations, `next build`) before flipping the PRD status to `complete`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large (~22 files) | Large — 29 files in the feature commit (`+5648/−17`), incl. both lockfiles + the drizzle snapshot; +1 unplanned file from the CI fix (`schedule-card-render.tsx`) |
| Confidence | (plan implied single-pass) | Confirmed — landed in one feature commit + 2 small fixes; no architectural change |
| Migration number | predicted `0003` (coordinate with Phase 3) | Actual `drizzle/0003_nostalgic_jack_flag.sql` — matched; Phase 3 did not collide |
| New deps | `playwright`, `qrcode`, `archiver` (+`@types/*`) | Present in `package.json` + both lockfiles synced |
| The one hard risk (CJK 豆腐) | Docker + `fonts-noto-cjk` mitigation | Runtime stage switched to `node:24-slim` + `chromium` + `fonts-noto-cjk`; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in deps/build stages |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 0 | Deps + lockfile sync | ✅ Complete | `playwright`/`qrcode`/`archiver` + `@types/*`; both `pnpm-lock.yaml` and `package-lock.json` synced (the PR #4 drift lesson) |
| 1 | `share_link` schema + migration | ✅ Complete | `0003_nostalgic_jack_flag.sql`: table + global-unique `token` + partial-unique active-per-student + composite FK cascade |
| 2 | Public read exception (`src/lib/share.ts`) | ✅ Complete | `getShareByToken` + `getStudentScheduleForShare(tenantId, studentId)`; early-return `[]` on empty enrollment (no `inArray([])`); scoped by resolved ids only |
| 3 | Shared card template (`src/lib/schedule-card.tsx`) | ✅ Complete | Inline-styled `<ScheduleCard>` (no Tailwind — won't apply under `setContent`); Asia/Shanghai formatting; 12-row PNG cap + `+N 节更多` |
| 4 | Playwright singleton + PNG (`src/lib/browser.ts`) | ✅ Complete | Memoized browser + 1-at-a-time mutex + `renderCardPng`; **hardened by review M1 fix** (see Deviations) |
| 5 | QR helper (`src/lib/qr.ts`) | ✅ Complete | `qrDataUrl` at `errorCorrectionLevel: 'H'` (survives WeChat recompression) |
| 6 | Share data + actions + 3 export routes | ✅ Complete | `share-data.ts` (forTenant spine) + `share-actions.ts` (read/update RBAC split) + PNG/.ics/ZIP route handlers (auth-gated, `private, no-store`); `cardWindow` added to `ical-feed.ts` |
| 7 | Public page + not-found + `/privacy` | ✅ Complete | `/s/[token]` RSC (`noindex`), `not-found.tsx`, PIPL notice page |
| 8 | `next.config.ts` externals + noindex header | ✅ Complete | `serverExternalPackages: ['playwright','archiver']` + `X-Robots-Tag` for `/s/:token*` |
| 9 | `src/env.ts` — Chromium path | ✅ Complete | Optional `PLAYWRIGHT_CHROMIUM_PATH` (dev bundled / prod `/usr/bin/chromium`) |
| 10 | Dockerfile — Debian runtime + CJK fonts | ✅ Complete | Runtime → `node:24-slim` + `chromium` + `fonts-noto-cjk` + `fc-cache`; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in deps/build |
| 11 | Dashboard UI — export panel + section batch | ✅ Complete | `export-panel.tsx` (copy/rotate/revoke + download anchors); `students/page.tsx` + `courses/page.tsx` mounts |
| 12 | Tests | ✅ Complete | `schedule-card.test.ts` + `share-slicing.test.ts` (pure, no DB/Playwright) |

## Validation Results (closeout re-verification)

Re-run on the current tree in an isolated worktree; a throwaway Postgres (ephemeral container, port 5435, non-shared volume) was used for migrations + DB-backed suites, then torn down.

| Level | Status | Notes |
|---|---|---|
| Static Analysis | ✅ Pass | `pnpm typecheck` (`tsc --noEmit`) + `pnpm lint` (`eslint .`) — zero errors |
| Migrations | ✅ Pass | `pnpm db:migrate` applies `0000`→`0005` cleanly to a fresh Postgres; `share_link` created with all 3 indexes + FK |
| Unit + Integration Tests | ✅ Pass | `pnpm test` → **11 files, 83 tests** pass, including Phase-4's `schedule-card` + `share-slicing` **and** the DB-integration suites (`tenant-isolation`, `report-db`, `mcp-tools`) that the PR #6 review had to skip for lack of an online Postgres |
| Build | ✅ Pass | `pnpm build` (Turbopack, `next build`) compiles + type-checks + generates 13/13 pages; standalone output with `playwright`/`archiver` traced as external. (Build's page-data collection requires a non-empty `DATABASE_URL` because `src/db/index.ts` throws on import if unset — a pre-existing, phase-agnostic trait; postgres-js connects lazily so a dummy URL suffices.) |
| CJK 豆腐 gate (Docker image) | ⏸ Not re-run here | The definitive glyph check needs a built Docker image + visual eyeball of a rendered PNG. Covered by the plan's Task-10 gate and the pre-merge fixes; requires Docker image build + human inspection, out of scope for an automated closeout. Left as a documented manual gate. |

## Files Changed (feature commit `197ce4e` + fixes `f853c0c`, `261b283`)

| File | Action | Notes |
|---|---|---|
| `src/db/schema/share-link.ts` | CREATE | capability-token table |
| `src/db/schema/index.ts` | UPDATE | `export * from './share-link'` before `./relations` |
| `drizzle/0003_nostalgic_jack_flag.sql` (+ `meta/`) | CREATE | `share_link` migration + snapshot |
| `src/lib/share.ts` | CREATE | public read exception (P4-2) |
| `src/lib/schedule-card.tsx` | CREATE | inline-styled `<ScheduleCard>` |
| `src/lib/schedule-card-render.tsx` | CREATE (CI fix) | **unplanned** — PNG-only `renderScheduleCardHtml` split out (see Deviations) |
| `src/lib/browser.ts` | CREATE (+ M1 fix) | Playwright singleton + mutex + recovery |
| `src/lib/qr.ts` | CREATE | QR data-URL |
| `src/lib/ical-feed.ts` | UPDATE | added `cardWindow` (feedWindow untouched) |
| `src/app/dashboard/students/share-data.ts` | CREATE | forTenant reads/ensure |
| `src/app/dashboard/students/share-actions.ts` | CREATE | getOrCreate/rotate/revoke |
| `src/app/dashboard/students/export-panel.tsx` | CREATE | client export UI |
| `src/app/dashboard/students/page.tsx` | UPDATE | mount `<ExportPanel>` per row |
| `src/app/dashboard/courses/page.tsx` | UPDATE | per-section 批量导出(ZIP) link |
| `src/app/api/export/student/[studentId]/png/route.ts` | CREATE | auth-gated PNG |
| `src/app/api/export/student/[studentId]/ics/route.ts` | CREATE | auth-gated .ics |
| `src/app/api/export/section/[sectionId]/route.ts` | CREATE | auth-gated ZIP |
| `src/app/s/[token]/page.tsx` | CREATE | public read-only page (noindex) |
| `src/app/s/[token]/not-found.tsx` | CREATE | bad/revoked token UI |
| `src/app/privacy/page.tsx` | CREATE | PIPL data-processing notice |
| `next.config.ts` | UPDATE | serverExternalPackages + X-Robots-Tag |
| `src/env.ts` | UPDATE | optional `PLAYWRIGHT_CHROMIUM_PATH` |
| `Dockerfile` | UPDATE | Debian runtime + Chromium + CJK fonts |
| `tests/schedule-card.test.ts`, `tests/share-slicing.test.ts` | CREATE | pure-fn unit tests |
| `package.json`, `pnpm-lock.yaml`, `package-lock.json` | UPDATE | 3 deps + 2 dev types; both lockfiles synced |

## Deviations from Plan

1. **New file `src/lib/schedule-card-render.tsx`** (fix `261b283`). The plan kept `renderScheduleCardHtml` inside `schedule-card.tsx`. Next 16 / Turbopack rejects any module in the App graph that **statically** imports `react-dom/server` alongside a component ("You're importing a component that imports react-dom/server"), even in a route handler where render-to-string is valid — because `schedule-card.tsx` is also imported by the RSC page `/s/[token]/page.tsx`. **Fix**: move the PNG-only render path to a separate `schedule-card-render.tsx` that defers `react-dom/server` via a dynamic `await import(...)`, making `renderScheduleCardHtml` **async**. Callers are already async route handlers that await it. No behavior change; the CJK font-family wrapper block is preserved.

2. **`src/lib/browser.ts` singleton hardening** (fix `f853c0c`, review **M1**). The initial memoized `browserP` cached a *rejected* promise on a transient `chromium.launch()` failure (or resolved a *disconnected* `Browser` after a crash), permanently breaking PNG/ZIP export in a long-lived standalone server. **Fix**: reset `browserP = null` on launch failure (allow retry) and check `browser.isConnected()` before use, rebuilding if disconnected.

Neither deviation changes the plan's architecture or security posture; both are refinements from building against the real Next 16/Turbopack + Playwright runtime.

## Security Review (PR #6 — APPROVE, no CRITICAL/HIGH)

Multi-tenant / single-student slicing reviewed with **no cross-tenant or cross-student leak**: token → exactly one tenant+student; both slice paths (public `share.ts`, authenticated `share-data.ts`) filter by the resolved `studentId`; export routes verify student/section tenant ownership; ZIP folders are per-student. Export routes are all `requireAuthContext` + `requirePermission`; the capability token is a 32-char `nanoid`, rotatable/revocable; `/s/<token>` carries double `noindex` (metadata + `X-Robots-Tag`) + a PIPL notice. No new RBAC statement (reuses `student`/`lesson`, forward-compatible with `parent`/`student` roles).

### Known low-severity follow-ups (from PR #6; non-blocking, not addressed at closeout)
- **L1** — `ensureActiveShare` race: two concurrent creates both read `null`, the partial-unique index rejects the second (23505 → 500). The index correctly prevents *duplicate data*; the code doesn't gracefully catch-and-re-read. Rare at single-tutor scale (the client already disables the button via `useTransition`). *Suggested*: catch unique-violation → re-select the active row.
- **L2** — render mutex has no per-render timeout / queue bound: one hung Playwright render blocks all subsequent exports; repeated authenticated requests grow the queue unbounded. Low risk (authenticated). *Suggested*: add a per-render timeout.
- **L3 (nit)** — `drizzle/0003_*.sql` missing a trailing newline (drizzle-generated; harmless).

These are intentionally deferred: they are LOW, non-blocking on already-merged/reviewed/green code, and touching `browser.ts`/`share-data.ts` at closeout carries more regression risk than value. Candidates for Phase-7 hardening (alongside the reminder/queue work).

## Tests Written

| Test File | Coverage |
|---|---|
| `tests/schedule-card.test.ts` | `renderScheduleCardHtml` output: student name + `的课表`, one row per lesson, `HH:mm` in Asia/Shanghai (08:00Z → 16:00), `<img src="data:image/png"` QR when set, `Noto Sans SC` font-family, `+N 节更多` truncation at >12, `近期暂无排课` empty state; `cardWindow` ~4-week Asia/Shanghai edges |
| `tests/share-slicing.test.ts` | section→lesson slicing: active-enrollment only, canceled + out-of-window excluded, empty active set → `[]` (no `inArray([])`) |

(Both are pure — no DB, no Playwright — loading via `tests/server-only-stub.ts` + `vite-tsconfig-paths`, per the repo's Vitest wiring.)

## Next Steps
- [x] Code review (PR #6 — APPROVE) and merge (`e76535d`)
- [x] Closeout re-validation (typecheck, lint, 83 tests, migrations, build)
- [ ] **Manual CJK 豆腐 gate** on a built Docker image before the next production deploy: render a PNG with a Chinese student name and eyeball the glyphs (Noto CJK, not boxes)
- [ ] Deploy env: ensure `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium` and a `NEXT_PUBLIC_APP_URL` on the HK/no-redirect domain (WeChat-openable QR target)
- [ ] Optional Phase-7 hardening: PR #6 L1 (race catch-and-reread) + L2 (render timeout)
