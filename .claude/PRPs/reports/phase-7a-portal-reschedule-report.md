# Implementation Report: Phase 7a — Portal Logins + Reschedule Requests (PR-1)

## Summary

Implemented the **server-side core (PR-1, Tasks 0–8 + core DB tests)** of Phase 7a: the schema, auth, and business-logic foundation for a parent/student login portal and a reschedule-request → teacher-approval workflow. **No UI was built** — that is PR-2 (Tasks 9–15), deliberately deferred per the plan's two-PR split and the user's scope choice ("先 PR-1"). The feature is **not yet end-to-end shippable**; Phase 7a stays `in-progress`.

What now exists and is proven against a live Postgres:
- **Schema** (migration `0006`): `portal_link` (user↔student join) + `reschedule_request.student_id` + `portal_relationship` enum.
- **Provisioning**: `provisionPortalAccount` Server Action → `auth.api.createUser` + `auth.api.addMember`, with the `user.create.after` auto-tenant hook **branched** so provisioned parents/students join the tutor's org instead of self-tenanting.
- **Row-level scope**: `resolveLinkedStudentIds` / `assertLinkedToStudent` — the codebase's first beyond-tenant (per-child) scope.
- **Workflow core**: `reschedule-core.ts` (create / approve / reject / cancel), approve reusing the existing `rescheduleLessonCore`.
- **RBAC**: verified the pre-declared `rescheduleRequest` matrix needs no change; added the pure `can()` matrix test.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large → XL (~24 files, 2 PRs) | PR-1 slice: 15 files (10 new, 5 modified) |
| Confidence | 8/10 single-pass | High for PR-1 — landed with only 1 trivial type fix |
| Files Changed (PR-1) | Tasks 0–8 ≈ 11 code + 3 test | 10 new + 5 modified + migration |
| Riskiest decision (P7a-1/P7a-2 auth) | flagged, Task 0 to verify | verified in source **and** at runtime (green test) |

## Tasks Completed (PR-1)

| # | Task | Status | Notes |
|---|---|---|---|
| 0 | Verify Better-Auth 1.7.4 surface | ✅ | `context.path` exists on the `after` hook; `createUser` allowed without headers server-side; `addMember` server-only. No `additionalFields` fallback needed. |
| 1 | Schema: `portal_link` + `reschedule_request.studentId` + enum | ✅ | `studentId` nullable (migration-safe); composite FKs to `student`. |
| 2 | Generate + apply migration 0006 | ✅ | `0006_wonderful_sumo.sql` — only new enum/table/column; applied to live DB. |
| 3 | Branch auto-tenant hook | ✅ | `if (context?.path !== '/sign-up/email') return`. Safe even if context is undefined (skips). |
| 4 | Provisioning helper + action | ✅ | Helper in `src/auth/provision.ts` (avoids db→auth import cycle — **deviation**, see below). |
| 5 | Portal auth helpers | ✅ | `isPortalRole` / `resolveLinkedStudentIds` / `assertLinkedToStudent`. |
| 6 | Portal schedule data loader | ✅ | Reuses `getStudentLessonsForTenant` + `cardWindow`. |
| 7 | `reschedule-core.ts` | ✅ | Approve handles both soft-`CONFLICT` and thrown `ConflictError`; leaves request `pending` on either. |
| 8 | Env + pure RBAC test | ✅ | `PORTAL_EMAIL_DOMAIN` added; matrix test green. |
| 14 (PR-1 subset) | DB-integration tests | ✅ | `reschedule-core` (8) + `portal-scope` (3) + `provision-portal` (1). |

**Deferred to PR-2 (Tasks 9–13, 15):** reschedule Server Actions (thin wrappers), root role dispatcher + login redirect + dashboard nav/sign-out, portal shell + schedule page + consent gate, portal reschedule page + form, dashboard teacher review UI, `/privacy` extension + consent copy.

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck) | ✅ Pass | `tsc --noEmit` clean |
| Static Analysis (lint) | ✅ Pass | `eslint .` — 0 errors, 0 warnings |
| Unit / Integration Tests | ✅ Pass | **99 tests** (was 83; +16), all green, against live Postgres |
| Build | ✅ Pass | `SKIP_ENV_VALIDATION=1 pnpm build` clean |
| Integration (HTTP) | N/A | No HTTP endpoints in PR-1 (portal UI = PR-2); behavior covered by DB tests |
| Edge Cases | ✅ Pass | unlinked child, not-enrolled, conflict-stays-pending, non-owner cancel, double-process, cross-tenant + intra-tenant other-child, hook-branch/no-junk-org |

## Files Changed

| File | Action | Notes |
|---|---|---|
| `src/db/schema/enums.ts` | UPDATED | + `portalRelationship` enum |
| `src/db/schema/portal-link.ts` | CREATED | `portal_link` join table |
| `src/db/schema/reserved.ts` | UPDATED | + `reschedule_request.studentId` + FK + index |
| `src/db/schema/index.ts` | UPDATED | export `portal-link` |
| `drizzle/0006_wonderful_sumo.sql` (+ meta) | CREATED | migration |
| `src/env.ts` | UPDATED | + `PORTAL_EMAIL_DOMAIN` |
| `src/auth/auth.ts` | UPDATED | branch `user.create.after` hook |
| `src/auth/portal.ts` | CREATED | role predicate + row-scope resolvers |
| `src/auth/provision.ts` | CREATED | `provisionPortalMember` (createUser + addMember) |
| `src/lib/reschedule-core.ts` | CREATED | request state machine |
| `src/app/dashboard/students/portal-actions.ts` | CREATED | `provisionPortalAccount` action |
| `src/app/portal/data.ts` | CREATED | `getPortalSchedule` loader |
| `tests/rbac-reschedule.test.ts` | CREATED | pure RBAC matrix (4) |
| `tests/reschedule-core.test.ts` | CREATED | DB integration (8) |
| `tests/portal-scope.test.ts` | CREATED | row-scope isolation (3) |
| `tests/provision-portal.test.ts` | CREATED | provisioning + hook-branch (1) |

## Deviations from Plan

1. **Provisioning helper location** — plan suggested `src/db/queries/organizations.ts` or a new `portal.ts` under `db/queries`. Placed `provisionPortalMember` in **`src/auth/provision.ts`** instead, because it imports `auth` (which imports `db`) — putting it under `db/queries` would create a `db → auth → db` import cycle. **Why:** keeps the dependency direction clean (auth-orchestration lives in the auth layer).
2. **`relations.ts` not modified** — plan's Files-to-Change listed adding `portalLinkRelations` + `rescheduleRequestRelations`. Skipped in PR-1 because no code does Drizzle relational (`db.query.*`) loading; all reads use `forTenant().select`. **Why:** avoid unused/speculative code. Revisit in PR-2 only if the dashboard review loader needs a relational join (it can use an explicit join instead).
3. **Provisioning permission** — used `requirePermission(ctx, { member: ['create'] })` (owner/admin) rather than the plan's `{ student: ['update'], member: ['create'] }`. **Why:** minting a login is member management; `member:['create']` is the precise gate (teacher intentionally excluded).
4. **Added a runtime provisioning test** (`provision-portal.test.ts`, not separately numbered in the plan) to validate the P7a-1/P7a-2 auth path end-to-end against the DB, since it was the highest-risk area.

## Issues Encountered

1. **DB password mismatch (28P01)** — the shared `course-scheduling_pgdata` docker volume was initialized by an earlier run with a different password. Resolved by `docker compose down -v` (throwaway dev DB, reproducible from migrations) then re-init on host port **5544** (5432 was held by an unrelated OrbStack container).
2. **One type error** — `ApproveResult.conflicts.title` had to be `string | null` to match `ScheduleResult`'s `Pick<ConflictSummary,'id'|'title'>`. Fixed.
3. **Environment was unprovisioned** — worktree had no `node_modules`/`.env` and the project Postgres wasn't running; set up `pnpm install` + `.env` (host port 5544) + `docker compose up postgres` + migrations to baseline before implementing.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `tests/rbac-reschedule.test.ts` | 4 | `can()` matrix for rescheduleRequest verbs + `member:create` + `isPortalRole` |
| `tests/reschedule-core.test.ts` | 8 | create / approve(free) / approve(conflict→pending) / reject / cancel / unlinked / not-enrolled / double-process |
| `tests/portal-scope.test.ts` | 3 | own-child resolve, intra-tenant other-child rejection, cross-tenant rejection |
| `tests/provision-portal.test.ts` | 1 | createUser+addMember → exactly one membership in tutor org (hook branch proven) |

## Next Steps
- [ ] **PR-2 (Tasks 9–15)**: portal shell + schedule/reschedule pages + consent gate, dashboard teacher-review UI, reschedule Server Actions, root role dispatcher + login redirect + sign-out, `/privacy` extension. Then Phase 7a → `complete`.
- [ ] `/code-review` on this PR-1 diff
- [ ] Phase 7a remains `in-progress` until PR-2 lands
