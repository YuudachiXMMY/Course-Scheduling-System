# Plan: Re-land PR #1 review fixes on main with a working migration

## Summary
PR #2 (H1/H2 + 7 MEDIUM fixes for PR #1) was auto-closed unmerged when PR #1's base branch was
deleted on merge, so none of the fixes reached `main`. Its regenerated migration was also broken
(composite FKs emitted before the unique indexes they reference → migrate aborts). This plan re-lands
the fixes on top of `main` with the migration statement order corrected, on a fresh branch, opened as
a new draft PR targeting `main`.

## User Story
As the repo maintainer, I want the reviewed Phase-1 fixes on `main` with a migration that actually
applies, so that a fresh deploy/CI can boot the app and the fixes take effect.

## Problem → Solution
`main` has PR #1's original code (cascade deletes, cookieCache revocation gap, signup dead-end) and the
fixes are stranded on a closed PR with a broken migration → the single fix commit is rebased onto `main`,
the migration is reordered (indexes before FKs), verified against Postgres, and reopened as a draft PR.

## Metadata
- **Complexity**: Small (git ops + 1 SQL file reorder)
- **Source PRD**: N/A
- **PRD Phase**: N/A (follow-up to PR #1 review)
- **Estimated Files**: 18 (17 from cherry-pick, 1 migration edited)

## UX Design
Internal change — no user-facing UX transformation.

## Root cause of the broken migration
`drizzle/0000_awesome_supreme_intelligence.sql` (regenerated in PR #2) ordered statements as
types → tables → `ADD CONSTRAINT fk_*` → `CREATE [UNIQUE] INDEX`. PostgreSQL requires the referenced
unique index (e.g. `uq_course_tenant_id` on `course(tenant_id,id)`) to exist **before** the composite FK
that references it. drizzle's migrator (`drizzle-orm/postgres-js/migrator`) runs the file's statements in
order, split on `--> statement-breakpoint`, so file order is execution order. Reproduced:
`ERROR: there is no unique constraint matching given keys for referenced table "course"` at the first FK.

## Fix
Reorder the `.sql` so all `CREATE [UNIQUE] INDEX` precede every `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`.
Snapshot (`0000_snapshot.json`) and journal (`_journal.json`) describe schema **state**, not statement
order — they stay valid and are untouched. No prod DB has run this migration (greenfield), so no stored
migration-hash mismatch.

## Files to Change
| File | Action | Justification |
|---|---|---|
| (17 files from cherry-pick 2b36670) | REPLAY | The reviewed H1/H2/M1–M7 fixes, verified correct |
| `drizzle/0000_awesome_supreme_intelligence.sql` | UPDATE | Reorder: indexes before FKs so migrate succeeds |

## NOT Building
- No re-review of the 9 fixes' logic (already verified in the prior review — all correct).
- No RLS implementation (M1 defers it via ADR — unchanged).
- No soft-delete paths (H1 RESTRICT is intended; delete helper limitation noted as advisory).
- No force-push / no rewriting the old `pr-1-fixes-h1-h2-medium` branch.

## Step-by-Step Tasks
### Task 1: Isolate in a worktree from main — DONE
- Worktree `phase1-review-fixes`, branch `worktree-phase1-review-fixes` from `origin/main` (d5ca3c1).

### Task 2: Rebase the fixes onto main — DONE
- `git cherry-pick 2b36670` (the single fix commit; equivalent to rebasing 1 commit onto main). Clean.

### Task 3: Fix migration statement order — DONE
- Reorder `.sql`: 64 non-FK statements, then 22 FK statements.

### Task 4: Verify migration — DONE
- Applied against `postgres:17-alpine` with `ON_ERROR_STOP=1`: no errors; 18 tables, 22 FKs,
  7 RESTRICT FKs (H1), `uq_enrollment_student_section` partial unique index (M6) present.

### Task 5: Commit, push, open draft PR to main
- Separate commit for the migration reorder; push new branch; `gh pr create --draft --base main`.

## Validation Commands
### Database Validation
```bash
sed 's/--> statement-breakpoint//g' drizzle/0000_awesome_supreme_intelligence.sql > /tmp/verify.sql
# apply against a throwaway postgres:17-alpine with ON_ERROR_STOP=1
```
EXPECT: applies with no errors; 18 tables; 7 RESTRICT FKs. ✅ verified

### Static Analysis / Tests
```bash
npm run typecheck && npm run lint && npm run build   # unchanged from PR #2 (SQL-only edit here)
```
EXPECT: pass (author validated on PR #2; this branch changes only SQL statement order).

## Acceptance Criteria
- [x] Fixes replayed onto main
- [x] Migration applies cleanly against Postgres
- [x] No force-push; old branch untouched
- [ ] Draft PR opened targeting main

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| drizzle-kit re-emits bad order on future `db:generate` | Medium | Migrate breaks again | Documented root cause here; verify migrate in CI (PR targets main → CI runs) |
| Snapshot/order drift vs regenerated migration | Low | Confusing diff | Snapshot untouched; only statement order changed, schema state identical |

## Notes
The prior review artifact and reproduction live in the GitHub comment on PR #2. This branch is the
corrected re-land. CI will now actually exercise the migration because the new PR targets `main`.
