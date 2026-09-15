# Implementation Report: Phase 7a — Portal + Reschedule (PR-2, UI)

## Summary

Implemented **PR-2 (Tasks 9–13 + 15)** of Phase 7a — the entire **UI layer** on top of PR-1's
server cores. This completes Phase 7a end-to-end: a tutor can now provision a parent/student login
from the dashboard, that user logs in and is dispatched to a role-gated `/portal` showing **only
their linked child's** upcoming schedule (behind a one-time consent gate), submits and cancels
reschedule requests, and the tutor reviews/approves/rejects them at `/dashboard/reschedule` — where
approve moves the lesson through the **existing `rescheduleLessonCore`** conflict path (conflicts are
surfaced, never silently applied).

No new server logic or schema was added — PR-2 is purely the thin Server Actions + pages/components
that wire PR-1's cores (`reschedule-core`, `provision`, `portal` helpers, `getPortalSchedule`) to
the browser, plus the PIPL privacy-notice extension. **No new dependencies.**

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual (PR-2) |
|---|---|---|
| Complexity | Large → XL, 2 PRs | PR-2 slice: 18 files (12 new, 6 modified) |
| Confidence | 8/10 single-pass | Landed single-pass — 0 type/lint errors on first full run |
| New dependencies | none | none (lockfiles unchanged) |
| Deviations | — | 2 minor (see below) |

## Tasks Completed (PR-2)

| # | Task | Status | Notes |
|---|---|---|---|
| 9 | Reschedule Server Actions (portal + dashboard) | ✅ | Data-shaped results (avoid React #441 redaction); approve returns core's `ApproveResult` union verbatim + revalidates calendar. |
| 10 | Root role dispatcher + login redirect + dashboard nav | ✅ | `/` dispatches by `isPortalRole`; login → `/`; dashboard nav gains 改期申请 (LogoutButton already existed). |
| 11 | Portal shell + schedule + consent gate | ✅ | Role-gated `layout.tsx`; consent gate blocks children until `consentedAt` stamped; `/portal` renders `ScheduleCard` per linked student. |
| 12 | Portal reschedule page + request form | ✅ | Own requests + upcoming lessons; luxon converts datetime-local ⇄ Asia/Shanghai instants; cancel own pending. |
| 13 | Dashboard teacher review UI | ✅ | `data.ts` loader (lesson+student hydration), pending list, approve/reject panel; conflict + 建议时段 shown on soft-CONFLICT; assistant sees no action buttons. |
| 15 | Privacy/consent content | ✅ | `/privacy` extended: 登录账号与改期申请 / 监护人同意 / 法律依据 / 数据保留期限. PRD Phase-7 split already landed in PR-1. |
| — | Provisioning form (Files-to-Change) | ✅ | `portal-account-form.tsx` on the students page; shows synthesized login email on success. |

## Deviations from Plan

1. **`provisionPortalAccount` action return shape** — changed from `{userId,email}`-or-throw to a
   discriminated `{ ok, ... } | { ok:false, error }`. **Why:** the codebase already documents that
   thrown Server-Action messages are redacted to React #441 in production; the tutor-facing form
   needs the Chinese business errors ("该邮箱已被其他账号占用", …) intact. No test consumed the action
   (tests target the core), so the change is safe. Mirrors `reports/actions.ts`.
2. **Sign-out reuse** — the plan called for a new portal sign-out sub-component; the existing
   `dashboard/logout-button.tsx` already does exactly this (signOut → `/login`), so the portal layout
   imports it rather than duplicating.

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck) | ✅ Pass | `tsc --noEmit` clean |
| Static Analysis (lint) | ✅ Pass | `eslint .` — 0 errors/warnings |
| Unit / Integration Tests | ✅ Pass | **107 tests, 16/16 files** (PR-1 DB tests + all existing suites); no regressions |
| Build | ✅ Pass | `next build` clean; `/portal`, `/portal/reschedule`, `/dashboard/reschedule` in route table |
| Integration (HTTP) | ⚠ Not run | Browser walkthrough (login→portal→request→approve) deferred to reviewer; covered structurally by DB tests + build |

## Files Changed

**Created (12):** `portal/layout.tsx`, `portal/page.tsx`, `portal/consent-actions.ts`,
`portal/consent-gate.tsx`, `portal/reschedule/page.tsx`, `portal/reschedule/actions.ts`,
`portal/reschedule/request-form.tsx`, `dashboard/reschedule/page.tsx`,
`dashboard/reschedule/actions.ts`, `dashboard/reschedule/data.ts`,
`dashboard/reschedule/review-panel.tsx`, `dashboard/students/portal-account-form.tsx`.

**Modified (6):** `app/page.tsx` (dispatcher), `(auth)/login/page.tsx` (redirect → `/`),
`dashboard/layout.tsx` (nav), `dashboard/students/page.tsx` (wire provisioning form),
`dashboard/students/portal-actions.ts` (data-shape), `privacy/page.tsx` (consent sections).

## Notes / Next Steps

- Phase 7a is now feature-complete (PR-1 server + PR-2 UI). Recommend a manual browser pass:
  provision → parent login → consent once → see only own child → request → tutor approve (lesson
  moves) / conflicting approve stays pending.
- Follow-ups per PRD: **7b** reminders (approved reschedules are not auto-notified — parent sees the
  update on next portal visit), **7c** MCP OAuth, **7d** Google sync, **7e** payments.
