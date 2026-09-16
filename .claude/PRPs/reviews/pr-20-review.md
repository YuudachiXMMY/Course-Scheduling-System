# PR Review: #20 — feat(portal): Phase 7a PR-2 — parent/student portal UI + reschedule review

**Reviewed**: 2026-09-15
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: worktree-phase-7a-pr2-portal-ui → main
**Decision**: REQUEST CHANGES (draft PR → posted as COMMENT)

## Summary

The UI layer is clean, mirrors existing patterns faithfully (data-shaped Server Action
results to dodge React #441, `requireAuthContext → requirePermission → core → revalidatePath`,
luxon Asia/Shanghai boundary handling), and correctly reuses PR-1's headless cores. One **serious
broken-access-control gap** breaks Phase 7a's central row-scope guarantee: a parent/student can view
the tenant-wide reschedule queue by navigating to `/dashboard/reschedule` directly. Everything else
is minor.

## Findings

### CRITICAL

**C1 — Portal roles can read the whole tenant's reschedule queue at `/dashboard/reschedule`
(broken access control / minor-PII leak).**

- `src/app/dashboard/reschedule/page.tsx:11` gates with `requirePermission(ctx, { rescheduleRequest: ['list'] })`.
- But `parent` and `student` roles **hold** `rescheduleRequest: ['create','read','list','cancel']`
  (`src/auth/permissions.ts:67,71`) — the `list` verb is shared with the portal's own
  `/portal/reschedule` page, so this check passes for them.
- `src/app/dashboard/layout.tsx:10-11` only redirects unauthenticated users — it does **not** role-gate,
  and there is **no `middleware.ts`** in the repo. So a logged-in portal user can load any `/dashboard/*`
  route whose permission verb they happen to hold.
- `listRescheduleRequests` (`src/app/dashboard/reschedule/data.ts:26-33`) is **tenant-scoped only**
  (filters by `status`) — no `requestedById` / `portalLink` row filter.

**Result:** a parent who manually visits `/dashboard/reschedule` sees **every family's** pending
requests — student names, lesson titles, and reschedule reasons — defeating the row-scope isolation
(a parent should see only their own child) and exposing other minors' personal information (PIPL-sensitive).
Read-only, same-tenant, and requires manual URL entry (no link is shown to portal users), but it is a
genuine authorization bypass.

**Recommended fix (pick one; the first is the most robust):**
1. Role-gate `DashboardLayout` symmetrically to `PortalLayout` — redirect portal roles out of the
   whole `/dashboard` tree:
   ```ts
   // src/app/dashboard/layout.tsx, after the null check
   if (isPortalRole(ctx.role)) redirect('/portal')
   ```
   This closes the entire dashboard tree, not just this page.
2. Or gate the review queue on a staff-only verb instead of the overloaded `list`, e.g.
   `requirePermission(ctx, { rescheduleRequest: ['approve'] })` — but `assistant` has `list` without
   `approve` and is meant to view the queue, so this would also lock assistants out. Fix #1 is cleaner.

Add a regression test asserting a `parent`-role ctx is redirected/blocked from `/dashboard/reschedule`.

### HIGH

None.

### MEDIUM

None.

### LOW

**L1 — `listRescheduleRequests` is N+1** (`data.ts:36-42`): one `findById(lesson)` + one
`findById(student)` per pending request. Explicitly documented as "single-tutor scale" and acceptable
for now; worth a join/batch if the pending queue ever grows.

**L2 — Consent gate is skipped for a link-less portal user** (`portal/layout.tsx:24`):
`needsConsent = links.length > 0 && …`, so a portal account with zero `portalLink` rows bypasses the
consent screen. Harmless today (an unlinked user sees an empty portal — `getPortalSchedule` returns
nothing), but if any data is ever shown pre-link this would leak past consent.

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Type check | Pass | `tsc --noEmit` clean (re-run on review) |
| Lint | Pass | `eslint .` 0/0 (re-run on review) |
| Tests | Pass | 107 tests / 16 files — verified at commit on this identical tree (no changes since) |
| Build | Pass | `next build` clean — verified at commit; `/portal`, `/portal/reschedule`, `/dashboard/reschedule` in route table |

Note: no automated check catches C1 — there is no test for cross-role dashboard access, which is
exactly why the gap slipped through a green suite.

## Files Reviewed

**Source (18):**
- `src/app/page.tsx` (M) — role dispatcher
- `src/app/(auth)/login/page.tsx` (M) — redirect → `/`
- `src/app/dashboard/layout.tsx` (M) — nav; **missing role gate (C1)**
- `src/app/dashboard/reschedule/{page,actions,data,review-panel}.tsx/ts` (A) — **C1, L1**
- `src/app/dashboard/students/{page,portal-account-form,portal-actions}.tsx/ts` (A/M)
- `src/app/portal/{layout,page}.tsx` (A) — **L2**
- `src/app/portal/{consent-actions,consent-gate}.ts/tsx` (A)
- `src/app/portal/reschedule/{page,actions,request-form}.tsx/ts` (A)
- `src/app/privacy/page.tsx` (M) — PIPL sections
- `src/lib/reschedule-core.ts` (context; PR-1) — confirmed cores re-parse input & enforce row scope

**Docs (3):** plan (archived), PRD (status → complete), PR-2 report — not reviewed for code.
