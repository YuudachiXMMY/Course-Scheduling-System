# PR Review: #5 — feat(phase-3): Calendar Publish (one-way) + PWA

**Reviewed**: 2026-09-13
**Author**: Jadyn Wu (YuudachiXMMY)
**Branch**: `worktree-prp-phase3-calendar-publish-plan` → `main`
**Status**: Draft → review posted as **COMMENT**
**Decision**: COMMENT (draft) — would be **REQUEST CHANGES** on the two HIGH path-mismatch findings before marking ready.

## Summary

Well-structured Phase-3 implementation. The `.ics`/`webcal` feed path has strong security
hygiene: unguessable `nanoid(32)` capability tokens, parameterized Drizzle queries (no
injection), a tightly-scoped and heavily-commented single `forTenant()` exception (P3-2), a
public route that 404s on bad/revoked tokens, correct VTIMEZONE handling verified by tests,
and stable PK-derived UIDs. No secrets, no XSS surface (React escaping, no
`dangerouslySetInnerHTML`), no `Notification.requestPermission()`.

The blocking concern is **not** in the feed logic — it is a `/dashboard/*` URL-path mismatch.
`(dashboard)` is a Next.js **route group**, so it contributes nothing to the URL. Every route
resolves at `/*` (confirmed via `.next/app-path-routes-manifest.json`), yet the nav link and
the new PWA `start_url` point at `/dashboard/*`, which 404s. This is a pre-existing Phase-2
convention (all sibling nav links + `revalidatePath` calls use it too), propagated here — but
this PR introduces two new, user-facing instances of it.

## Findings

### CRITICAL
None.

### HIGH

**H1 — PWA `start_url: '/dashboard/schedule'` opens a 404** (`src/app/manifest.ts:11`)
The build route manifest resolves the schedule page to `/schedule` and the dashboard home to
`/` — there is **no** `/dashboard/schedule` route (no `basePath`, no middleware, no rewrites;
`(dashboard)` is a route group). An installed PWA launched from its home-screen icon opens
`start_url`, so it would land on a 404 — directly breaking the headline "installable PWA"
deliverable. This surface is **new** in this PR.
*Fix*: set `start_url` (and keep `id`) to a real route — `'/schedule'` (or `'/'` for the
dashboard home). See H2 for the systemic root cause / alternative fix.

**H2 — Nav link `/dashboard/calendar` 404s → the new settings page is unreachable via the UI**
(`src/app/(dashboard)/layout.tsx:26`)
The page is served at `/calendar`. Clicking "日历订阅" navigates to `/dashboard/calendar`,
which does not exist. The feature is only reachable by typing `/calendar` directly.
Note this is a **pre-existing, codebase-wide pattern**: the sibling links (`/dashboard/schedule`,
`/dashboard/students`, `/dashboard/courses`) are broken the same way. Root cause is a route-group
(`(dashboard)`) vs literal-segment (`dashboard/`) mismatch.
*Fix — two directions (a team decision, not a unilateral one):*
- **(a) Match current reality**: change all nav links + `start_url` + `revalidatePath` from
  `/dashboard/*` to `/*` (`/calendar`, `/schedule`, …).
- **(b) Make `/dashboard/*` real**: rename `src/app/(dashboard)/` → `src/app/dashboard/`
  (literal segment). Then every existing `/dashboard/*` reference — including this PR's — becomes
  correct in one move, and the dashboard home shifts from `/` to `/dashboard`.
  This is Phase-2-wide scope.

### MEDIUM

**M1 — `revalidatePath('/dashboard/calendar')` is a no-op** (`src/app/(dashboard)/calendar/actions.ts:35,52,57,69`)
`revalidatePath` matches a literal route (`/calendar`) or a page-file path
(`/(dashboard)/calendar/page`) — `/dashboard/calendar` is neither, so the intended cache
invalidation never happens. **Practical impact is currently masked**: `feed-panel.tsx` calls
`router.refresh()` after each action and the page reads fresh via `getActiveFeed`, so the UI
still updates. Same pattern is used throughout Phase-2 actions. Fix alongside H2 (either
`/calendar` or the route-group rename).

**M2 — `Cache-Control: public, max-age=3600` on the capability feed** (`src/app/api/calendar/[token]/route.ts:31`)
The feed serves tenant-private lesson data (titles/locations) gated only by the URL token.
`public` permits shared/intermediary caches (CDN, corporate proxy) to store the response.
The unguessable token is in the URL, so the cache key is unique per feed → **no cross-tenant
leak**. But after rotate/revoke an intermediary cache may keep serving the old `.ics` for up to
an hour, which softens the UI's "旧链接会立即失效 / 立即失效" promise (revocation is only
immediate at the origin).
*Fix*: prefer `private, max-age=<short>` (or `no-cache`/`must-revalidate`) so revocation
propagates promptly. Calendar clients poll on their own cadence regardless of `max-age`.

### LOW

**L1 — `getOrCreateFeed` mints a public capability under read-tier permission**
(`src/app/(dashboard)/calendar/actions.ts:24-37`)
Creating a feed row is a write that publishes an unauthenticated public URL, yet it is gated by
`lesson:['read']` (per plan P3-8: "viewing auto-creates"). Exposure is bounded — a read
principal already sees all lessons, and the feed exposes only what read can see — but a
read-only user can create a *durable public capability*. Acceptable as designed; flagging for
awareness. Consider gating creation behind `lesson:['update']` while keeping view read-tier.

**L2 — No DB guarantee of one active feed per tenant; `rows[0]` is order-undefined**
(`src/app/(dashboard)/calendar/actions.ts:18`, `data.ts:13`)
`findActiveFeed`/`getActiveFeed` return `rows[0]` with no `orderBy`. Concurrent
`getOrCreateFeed`/`rotateFeed` (rotate's "no existing → insert" branch) could create two active
rows, and reads would then pick a non-deterministic one. Low probability for a single-tutor MVP
and documented in comments. Consider a partial unique index
`(tenant_id) WHERE revoked_at IS NULL` and/or an explicit `orderBy(createdAt)`.

## Strengths (verified)

- Capability tokens: `nanoid(32)` ≈ 190 bits — unguessable; rotate/revoke tombstoning is clean.
- P3-2 exception is confined to `getFeedLessons`, scoped strictly by resolved `feed.tenantId`
  (never a request param), and clearly commented. All other paths use `forTenant()`.
- Parameterized queries throughout — no SQL injection surface.
- VTIMEZONE correctness (Luxon deviation) is real and correctly justified; covered by
  wall-clock + stable-UID unit tests.
- Global-unique `uq_calendar_feed_token` index matches the tokenless public lookup — correct.
- PWA restraint per plan: no offline cache, no push, no notification-permission request.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Tests (`vitest`) — `ical-feed` | Pass (7/7); full suite 26/26 per report (3 DB suites need live PG) |
| Build (`next build`) | Pass (routes: `/api/calendar/[token]` ƒ, `/manifest.webmanifest` ○, `/calendar` ƒ) |

## Files Reviewed

| File | Change |
|---|---|
| `src/lib/ical-feed.ts` | Added |
| `src/app/api/calendar/[token]/route.ts` | Added |
| `src/app/(dashboard)/calendar/actions.ts` | Added |
| `src/app/(dashboard)/calendar/data.ts` | Added |
| `src/app/(dashboard)/calendar/page.tsx` | Added |
| `src/app/(dashboard)/calendar/feed-panel.tsx` | Added |
| `src/app/(dashboard)/layout.tsx` | Modified (nav link) |
| `src/db/schema/calendar-feed.ts` | Added |
| `src/db/schema/index.ts` | Modified |
| `drizzle/0002_goofy_epoch.sql` (+ snapshot/journal) | Added |
| `src/app/manifest.ts` | Added |
| `src/app/layout.tsx` | Modified (metadata + SW mount) |
| `src/app/sw-register.tsx` | Added |
| `public/sw.js` | Added |
| `public/{icon-192,icon-512,icon-512-maskable,apple-touch-icon}.png` | Added |
| `tests/ical-feed.test.ts` | Added |
| `.claude/PRPs/*` (plan/prd/report) | Docs |

## Recommendation

Resolve **H1** and **H2** (pick fix direction (a) or (b) — a route-structure decision) before
marking ready; fold in **M1** with the same change. **M2** is a quick hardening of the
revocation guarantee. **L1/L2** are optional. The feed's core security model is sound.
