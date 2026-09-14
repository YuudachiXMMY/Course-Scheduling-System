# PR Review: #8 — feat(phase-5): Progress Reports — Claude-drafted, teacher-approved PDF

**Reviewed**: 2026-09-14
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-prp-phase5-progress-reports-plan → main
**Decision**: COMMENT (draft PR) — no CRITICAL/HIGH; two MEDIUM design issues worth addressing before "ready"

## Summary
Solid, well-layered implementation of Phase 5. Pure/DB/action split mirrors the existing `schedule-core` convention, tenant isolation flows through `forTenant(ctx)` everywhere, RBAC is enforced at every entry point, and the hardest risk (CJK-in-PDF) is de-risked by a real render smoke test. The findings below are correctness/semantics and hygiene refinements, not blockers.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — Approved reports are not reproducible; numbers can drift from the frozen narrative.**
`getReportViewModel` (`src/lib/report-core.ts:73-96`) recomputes attendance/grades from the **live** DB at PDF time for *every* report, including `approved` ones. The narrative is frozen on the row, but the numbers are not — if anyone edits an attendance/grade record after approval, the "已定稿" PDF silently shows different numbers while the prose stays the same. An approved report is meant to be a finalized academic record; today it is only deterministic if the underlying rows never change. The code comment ("deterministic given the period") assumes immutable source data, which isn't guaranteed.
*Suggestion*: snapshot the computed stats (attendance summary + grade items + average) into the row (e.g. a `jsonb stats` column) at **approve** time, and have the PDF read the snapshot for approved reports while still recomputing live for drafts.

**M2 — Per-term (section-level) grades bypass the period window.**
In `getReportData` (`src/lib/report-data.ts:60-68`), grades are matched by either `lessonId ∈ window-lessons` **or** `sectionId ∈ active-enrolled sections`. The section branch has **no date filter**, so a per-term grade (`lessonId = null, sectionId` set) recorded outside `[from, to]` still appears in a period-scoped report. `grade` has a `gradedAt` column (`src/db/schema/grade.ts`) that could bound it. Result: a "3月报告" can include grades from outside March.
*Suggestion*: filter section-level grades by `gradedAt`/`createdAt` within the window, or document that section grades are intentionally term-wide and label them as such in the PDF.

### LOW

**L1 — Unbounded reads.** `getReportData` fetches *all* grades for a student (`report-data.ts:60`) then filters in memory; `listReports` (`actions.ts:69-73`) and `getReportsPageData` (`data.ts:28-30`) `select` the whole `progress_report` table with no pagination. Fine at pilot/small-class scale, will degrade as history grows. Consider bounding by window in SQL and paginating the list.

**L2 — Read-then-write race in the approve/edit gate.** `updateReportNarrativeCore` and `approveReportCore` (`report-core.ts:47-69`) do `findById` → check `status` → `update` without a transaction or conditional write. Two concurrent requests (e.g. approve + edit) can both pass the check and interleave, letting an edit land after approval. Very low likelihood (single teacher), but a conditional `UPDATE ... WHERE status = 'draft'` would close it cheaply.

**L3 — 18MB variable font committed to git without LFS/subsetting.** `public/fonts/NotoSansSC-Regular.ttf` is the full variable `NotoSansSC[wght]` face. It works (verified), but it permanently bloats the repo and every clone. Consider a static single-weight subset (the PDF only uses one weight) or Git LFS.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Tests (`vitest run tests/report.test.ts`) | Pass — 13/13 |
| Build (`next build`) | Pass (per implementation report; not re-run this pass) |

## Files Reviewed
- `src/db/schema/progress-report.ts` (Added), `src/db/schema/enums.ts` (Modified), `src/db/schema/index.ts` (Modified)
- `src/auth/permissions.ts` (Modified) — `report` statement + six-role matrix
- `src/env.ts` (Modified)
- `src/lib/report-stats.ts` (Added, pure), `src/lib/report-data.ts` (Added), `src/lib/report-prompt.ts` (Added, pure), `src/lib/report-draft.ts` (Added), `src/lib/report-pdf.tsx` (Added), `src/lib/report-core.ts` (Added)
- `src/app/dashboard/reports/{page,report-panel,actions,data}.ts[x]` (Added), `src/app/dashboard/layout.tsx` (Modified)
- `src/app/api/reports/[reportId]/pdf/route.ts` (Added), `src/app/api/reports/section/[sectionId]/route.ts` (Added)
- `tests/report.test.ts` (Added), `tests/report-db.test.ts` (Added)
- `drizzle/0004_broken_cyclops.sql` + meta (Added, generated)

## Notes on things done well
- Tenant isolation via `forTenant(ctx)` on every read/write; `tenantId` never from params. Verified by `report-db.test.ts` cross-tenant assertion.
- RBAC enforced at page, action, and both route handlers; `approve` gated separately from `update`.
- Claude call is correct for Opus 4.8: versioned rubric cached in the `system` block, data in the user turn, no `temperature`/`budget_tokens`, missing-key fail-fast, and the anti-fabrication rubric ("绝不得编造"). Numbers render from the DB, not the model — the core PRD safety property holds.
- `createReportDraftCore` validates the student (via `getReportData`) **before** the Claude call, so an invalid student never burns an API request.
- Empty `inArray([])` guards on lessons/attendance avoid invalid SQL.
