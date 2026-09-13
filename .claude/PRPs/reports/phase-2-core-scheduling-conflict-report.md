# Implementation Report: Phase 2 — Core Scheduling + Conflict（MVP 核心）

## Summary

Implemented the scheduling core on the Phase-1 foundation: pure RRULE→UTC recurrence expander (`rrule` floating enumerator + Luxon zone conversion), idempotent edit-preserving section→lessons materializer, two-layer teacher-conflict detection (app pre-check with free-slot suggestions **+** a Postgres GiST `EXCLUDE` constraint as the atomic backstop), a responsive `'use client'` FullCalendar UI fed by a Server Component, full Course/ClassSection/Student/Enrollment CRUD, and attendance + class-notes capture. All writes go through the Phase-1 `forTenant` spine + verify→authorize→validate→scope guarded-action shape.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large (~30 files) | Large — 27 files changed |
| Confidence | 8/10 | Matched: schema/conflict/materialize/RBAC landed cleanly; the two medium-confidence items resolved (FullCalendar pinned to stable v6; timezone via Luxon) |
| Files Changed | ~30 | 23 created, 4 updated (+ generated lockfile/snapshot) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Deps + GiST exclusion migration | ✅ Complete | `drizzle/0001_lesson_teacher_exclusion.sql`; `btree_gist` + `lesson_no_teacher_overlap` verified in DB. FullCalendar pinned **6.1.21** (no stable 7.x plugins) |
| 2 | Recurrence expander + RRULE builder | ✅ Complete | rrule floating enumerator + Luxon; DTSTART-less RRULEs; runaway guard (>500 occ / >2yr) |
| 3 | Conflict detection + errors | ✅ Complete | `checkTeacherConflict`/`suggestFreeSlots` via `forTenant().select(t,extra)`, `'[)'`; `ConflictError`/`isExclusionViolation` |
| 4 | Materializer | ✅ Complete | Denormalizes `teacherId`; `onConflictDoNothing` on slot key; per-occurrence `23P01` fallback returns `{inserted, conflicts}` |
| 5 | Student CRUD + UI | ✅ Complete | `getStudent`/`updateStudent`/`archiveStudent` (soft); list + form |
| 6 | Course + Section CRUD + recurrence form | ✅ Complete | capacity 1–15 zod guard; tenant `courseId` check; `materializeSectionAction` |
| 7 | Scheduling actions + calendar read | ✅ Complete | discriminated `ScheduleResult` (conflict returned, auth/validation thrown); reschedule uses `excludeLessonId` + `isException` |
| 8 | Calendar UI + lesson detail + nav | ✅ Complete | `'use client'` FullCalendar (no server-only imports); attendance/notes drawer; enrollment (capacity + reactivate-dropped) |
| 9 | Tests | ✅ Complete | 4 files / 18 tests, all green against real Postgres |
| 10 | Full validation sweep | ⚠️ Partial | typecheck/lint/tests/grep-guard green; **build fails pre-existingly** (see below) |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck) | ✅ Pass | `tsc --noEmit` — 0 errors (independently re-run by parent session) |
| Static Analysis (lint) | ✅ Pass | eslint exit 0; prettier applied |
| Unit + Integration Tests | ✅ Pass | **18/18 green** across 5 files vs real Postgres (independently re-run: `5 passed / 18 passed`) |
| Data-layer grep guard | ✅ Pass | no direct `db.*` in `src/app`/`src/lib` except documented `materialize.ts` |
| Build | ❌ Pre-existing fail | `pnpm build` errors prerendering Next's internal `/_global-error` (`useContext` null) on **Next 16.3.5 + React 19.3.0**. Confirmed identical failure on the untouched baseline (stash test) — **not introduced by Phase 2**; all Phase-2 routes compile/bundle successfully |
| Migration + constraint | ✅ Pass | `pnpm db:migrate` applied Phase-1 + Phase-2; `\dx` shows `btree_gist`, `\d lesson` shows the EXCLUDE constraint |

## Files Changed

**CREATED (23)**
| File | Lines |
|---|---|
| `src/lib/recurrence.ts` | +70 |
| `src/lib/rrule-build.ts` | +31 |
| `src/lib/conflict.ts` | +85 |
| `src/lib/errors.ts` | +19 |
| `src/lib/materialize.ts` | +84 |
| `src/app/(dashboard)/schedule/types.ts` | +21 |
| `src/app/(dashboard)/schedule/data.ts` | +31 |
| `src/app/(dashboard)/schedule/actions.ts` | +158 |
| `src/app/(dashboard)/schedule/enrollment-actions.ts` | +92 |
| `src/app/(dashboard)/schedule/attendance-actions.ts` | +127 |
| `src/app/(dashboard)/schedule/page.tsx` | +23 |
| `src/app/(dashboard)/schedule/calendar.tsx` | +115 |
| `src/app/(dashboard)/schedule/lesson-detail.tsx` | +150 |
| `src/app/(dashboard)/courses/actions.ts` | +168 |
| `src/app/(dashboard)/courses/page.tsx` | +50 |
| `src/app/(dashboard)/courses/course-form.tsx` | +79 |
| `src/app/(dashboard)/courses/section-form.tsx` | +176 |
| `src/app/(dashboard)/students/page.tsx` | +50 |
| `src/app/(dashboard)/students/student-form.tsx` | +113 |
| `drizzle/0001_lesson_teacher_exclusion.sql` | +14 |
| `tests/recurrence.test.ts` | +88 |
| `tests/conflict.test.ts` | +153 |
| `tests/materialize.test.ts` | +111 |
| `tests/rbac-scheduling.test.ts` | +24 |

**UPDATED (4 + generated)**: `src/app/(dashboard)/students/actions.ts` (+~40), `src/app/(dashboard)/layout.tsx` (nav), `package.json` (deps), `drizzle/meta/_journal.json`; generated `pnpm-lock.yaml`, `drizzle/meta/0001_snapshot.json`.

## Deviations from Plan

1. **FullCalendar pinned to `6.1.21`** (all packages), not `7.1.0`. The `daygrid`/`timegrid`/`interaction` plugins have **no stable 7.x** (only `7.0.0-rc.0`); mixing them with a 7.1.0 core mismatched. 6.1.21 is the latest stable line, supports React 19, and auto-injects CSS (so the plan's "verify CSS import" note is moot).
2. **`isExclusionViolation` walks the `.cause` chain.** Drizzle 0.45 wraps postgres.js's `PostgresError` in a `DrizzleQueryError`, so the `23P01` SQLSTATE lives on `.cause`, not the top-level error — the plan's literal `e.code` check would never match. Correctness fix.
3. **Conflict overlap SQL binds bounds as ISO strings with `::timestamptz` casts.** postgres.js cannot infer the type of a bare `Date` param inside `tstzrange(...)`; casting fixes it while keeping `'[)'` semantics.
4. **Postgres host port 5433** (local dev) — 5432 was already bound by another container; set `POSTGRES_HOST_PORT=5433` in a local (untracked) `.env`.
5. **Integration-test cleanup deletes feature tables explicitly.** `course`/`class_section`/`lesson` carry `tenant_id` but have **no FK to `organization`**, so deleting the org does not cascade — leftover lessons would trip the GiST constraint on re-run.
6. **Ad-hoc `createLessonAction` lessons set `isException=true`** with null `originalStartAt`, so they don't collide on the slot unique index.

## Issues Encountered

- **`pnpm build` fails on Next's internal `/_global-error` prerender** — open, **pre-existing** (reproduces on the untouched baseline via stash test), an environment/version issue (Next 16.3.5 + React 19.3.0), out of Phase-2 scope. Recommend a Next patch bump in a follow-up. Does not affect typecheck/lint/tests or the compiled Phase-2 routes.
- The worktree had **no `node_modules` and no committed `pnpm-lock.yaml`**; `pnpm install` generated the lockfile (now committed with Phase 2, since deps changed anyway).

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `tests/recurrence.test.ts` | 4 | Pure RRULE expansion: weekly window, count, no-DST invariant, runaway cap |
| `tests/conflict.test.ts` | 5 | Overlap detect+suggest, back-to-back allowed, canceled ignored, GiST `23P01` direct insert, null-teacher exemption (real PG) |
| `tests/materialize.test.ts` | 2 | Idempotency, edit/cancel preservation (real PG) |
| `tests/rbac-scheduling.test.ts` | 4 | P2-9 role matrix (assistant/parent/teacher) |

## Next Steps
- [ ] Resolve the pre-existing `/_global-error` build failure (likely a Next 16.3.x patch bump) — tracked separately, not a Phase-2 regression.
- [ ] Commit `pnpm-lock.yaml` alongside (done with this phase).
- [ ] Code review via `/ecc:code-review`.
- [ ] Phase 3 (Calendar Publish + PWA) and Phase 4 (Parent Sharing) can now proceed — both depend only on Phase 2's lesson data.
</content>
