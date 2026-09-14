# Implementation Report: Phase 3 — Calendar Publish (one-way) + PWA

## Summary

Implemented the tutor-facing "publish outward" features on top of Phase-2 lessons:

1. **Read-only `.ics`/`webcal` subscription feed** — an unguessable, revocable capability
   token maps to a tenant's non-canceled lessons in a rolling `[now−8w, now+26w]` window,
   emitted as a valid `VCALENDAR` with a real `VTIMEZONE` for `Asia/Shanghai` and stable,
   PK-derived UIDs (no duplicates on refresh). Served with `Content-Type: text/calendar` so
   Apple/Google **subscribe** (not download), via a public, no-auth route.
2. **Installable PWA** — `app/manifest.ts` (auto-served at `/manifest.webmanifest`), PNG
   icons (192/512/512-maskable/apple-touch-180), `appleWebApp` metadata, and a minimal
   fetch-through service worker registered client-side with an unobtrusive install button.
   No offline caching, no push, no notification-permission request (P3-9/P3-10).

Postgres stays the single source of truth; nothing reads any external calendar.

> **Post-review route fix (2026-09-13):** `/ecc:code-review` on PR #5 found that `(dashboard)`
> was a Next.js *route group* (contributes no URL segment), so the intended `/dashboard/*` URLs
> 404'd — including the post-login `router.push('/dashboard')`, the whole nav, and this PR's PWA
> `start_url`. Fixed by renaming `src/app/(dashboard)/` → `src/app/dashboard/` (literal segment).
> Routes are now `/dashboard`, `/dashboard/schedule`, `/dashboard/calendar`, `/dashboard/courses`,
> `/dashboard/students`. The file paths and the build-route line below reflect the
> implementation-time `(dashboard)/` layout; on disk they now live under `dashboard/`. Also
> hardened the feed `Cache-Control` → `private, max-age=3600, must-revalidate` (M2). Details in
> `.claude/PRPs/reviews/pr-5-review.md`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium (~14–17 files) | Medium — 21 files touched (17 created, 4 updated) + 2 lockfiles + migration meta |
| Confidence | High (2 doc lookups, APIs verified) | Confirmed — one API-behavior deviation found & fixed (see Deviations) |
| Files Changed | ~16 | 22 (incl. 4 generated icons + migration + snapshots) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 0 | Add deps (`ical-generator`, `@touch4it/ical-timezones`) | ✅ Complete | Both lockfiles synced (PR #4 lesson) |
| 1 | `calendar_feed` schema + migration `0002` | ✅ Complete | Table + 3 indexes incl. global-unique token index; migration applies cleanly |
| 2 | `src/lib/ical-feed.ts` (`buildIcs` + `getFeedLessons` + `feedWindow`) | ✅ Complete | **Deviated** — Luxon values instead of native Date (see below) |
| 3 | Public feed route `api/calendar/[token]/route.ts` | ✅ Complete | 404 on bad/revoked token; `text/calendar`; `await params` |
| 4 | Feed management actions | ✅ Complete | `getOrCreateFeed`/`rotateFeed`/`revokeFeed`; RBAC via `lesson` perms |
| 5 | Settings `data.ts` + `page.tsx` | ✅ Complete | `webcal://` + `https://` links + 中文 subscribe instructions |
| 6 | `feed-panel.tsx` client component | ✅ Complete | Copy / regenerate / revoke; `window.confirm`; no QR dep (Phase-4 owns QR) |
| 7 | PWA `manifest.ts` | ✅ Complete | `MetadataRoute.Manifest`; static at `/manifest.webmanifest` |
| 8 | Root layout — Apple metadata + SW mount | ✅ Complete | `appleWebApp` + `icons.apple` + `<ServiceWorkerRegister/>` |
| 9 | Icons in `public/` | ✅ Complete | Generated via `sharp` — font-free calendar glyph placeholders at exact sizes |
| 10 | `sw.js` + `sw-register.tsx` | ✅ Complete | Minimal SW; typed `beforeinstallprompt`; no `Notification.requestPermission()` |
| 11 | Nav link (日历订阅) | ✅ Complete | Added to `(dashboard)/layout.tsx` |
| 12 | Tests `tests/ical-feed.test.ts` | ✅ Complete | 7 tests (shape, TZID, local wall-clock, stable UID, host, empty, window) |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (typecheck + lint) | ✅ Pass | `tsc --noEmit` and `eslint .` both clean |
| Unit Tests | ✅ Pass | 26 tests across 6 files (7 new in `ical-feed`) |
| Build | ✅ Pass | `next build` OK; `/api/calendar/[token]` ƒ, `/manifest.webmanifest` ○, `/dashboard/calendar` ƒ (post-fix; was `/calendar` pre-rename) |
| Integration / DB | ✅ Pass | Migration `0002` applies cleanly to a real Postgres; `calendar_feed` present with `uq_calendar_feed_token`; full suite green against live DB |
| Edge Cases | ✅ Pass | Empty feed → valid event-free VCALENDAR; canceled omitted (query filter); bad token → 404 |

### How the DB level was validated

The 3 DB-dependent suites (`tenant-isolation`, `conflict`, `materialize`) need a live
Postgres. Ran them against an **isolated throwaway** `postgres:17-alpine` container on port
`5434` (anonymous volume, removed afterward) so the user's own `:5432` database and the
compose `pgdata` volume were never touched. Migration applied cleanly; all 26 tests passed.

## Files Changed

| File | Action | Lines |
|---|---|---|
| `package.json` | UPDATED | +2 deps |
| `package-lock.json` | UPDATED | synced |
| `pnpm-lock.yaml` | UPDATED | synced |
| `src/db/schema/calendar-feed.ts` | CREATED | 26 |
| `src/db/schema/index.ts` | UPDATED | +1 export (before `./relations`) |
| `drizzle/0002_goofy_epoch.sql` (+ snapshot, journal) | CREATED | 13 |
| `src/lib/ical-feed.ts` | CREATED | 82 |
| `src/app/api/calendar/[token]/route.ts` | CREATED | 34 |
| `src/app/(dashboard)/calendar/actions.ts` | CREATED | 70 |
| `src/app/(dashboard)/calendar/data.ts` | CREATED | 15 |
| `src/app/(dashboard)/calendar/page.tsx` | CREATED | 48 |
| `src/app/(dashboard)/calendar/feed-panel.tsx` | CREATED | 130 |
| `src/app/(dashboard)/layout.tsx` | UPDATED | +3 (nav link) |
| `src/app/manifest.ts` | CREATED | 23 |
| `src/app/layout.tsx` | UPDATED | +7 (metadata + SW mount) |
| `src/app/sw-register.tsx` | CREATED | 42 |
| `public/sw.js` | CREATED | 5 |
| `public/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png` | CREATED | binary PNGs at exact sizes |
| `tests/ical-feed.test.ts` | CREATED | 81 |

`src/auth/permissions.ts` — verified only (no change): P3-8 reuses `lesson` perms.

## Deviations from Plan

1. **`buildIcs` passes Luxon `DateTime`, not native `Date`** (`src/lib/ical-feed.ts`).
   - **WHAT**: `start`/`end` are wrapped with `DateTime.fromJSDate(l.startAt, { zone: 'utc' })`
     before `cal.createEvent`, instead of the plan's raw `l.startAt`.
   - **WHY**: `ical-generator@11`'s date formatter uses **machine-local getters**
     (`getHours()`…) for a native `Date` even when an event `timezone` is set — so `08:00Z`
     rendered as the server's local wall-clock (observed `03:00` on a UTC−5 test host), not
     `16:00 Asia/Shanghai`. A Luxon value triggers `value.setZone(timezone)` internally →
     correct, machine-timezone-independent `DTSTART;TZID=Asia/Shanghai:...T160000`. Verified
     by the source of `ical-generator` and by the stable-UID / local-wall-clock unit tests.
   - Everything else in Task 2 matches the plan (server-only, drizzle ops, `ne(status,'canceled')`,
     `feedWindow`, VTIMEZONE generator, PK-derived UID).

2. **Icons generated with `sharp` drawing a font-free calendar glyph** (Task 9).
   - **WHAT**: No ImageMagick available; used the transitively-installed `sharp` to rasterize a
     pure-SVG calendar icon (dark rounded square + white calendar + blue header + day dots).
   - **WHY**: Rendering the "排" CJK glyph via librsvg risks missing-font tofu. Pure shapes
     render deterministically and are thematically appropriate. These are acknowledged
     placeholders (final art is a polish item, per the plan).

## Issues Encountered

- **No `node_modules` / no local `.env`**: created a gitignored `.env` (copy of `.env.example`)
  so `db:generate`/`vitest`/`build` tooling could run. `.env` is not committed.
- **Port 5432 already in use** by a pre-existing Postgres; the compose `pgdata` volume carried a
  different password (only honored on first init). Resolved by validating against an isolated
  throwaway container on `5434` — no user data touched. The compose `postgres` container was left
  `exited` (it was not the process holding `:5432`); run `docker-compose up -d postgres` to restore
  it if desired.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `tests/ical-feed.test.ts` | 7 | VCALENDAR shape, VTIMEZONE `TZID:Asia/Shanghai`, 08:00Z→16:00 local, stable PK-derived UID (×2 renders identical), host anchoring, empty-feed valid VCALENDAR, `feedWindow` ~34-week bounds |

## Security Note (P3-2 public read path)

The single `forTenant()` exception is confined to `src/lib/ical-feed.ts::getFeedLessons`,
scoped strictly by the resolved `feed.tenantId` (never a request param), and heavily commented.
The route resolves `token → non-revoked feed row` first (parameterized drizzle query — no
injection), returns 404 otherwise, exposes only lesson titles/locations, and is read-only. A
leaked token is mitigated by rotate/revoke. No secrets, no `Notification.requestPermission()`.

## Next Steps
- [ ] Manual subscribe test in real Apple Calendar / Google Calendar (edits update without dupes).
- [ ] Lighthouse PWA "installable" check + DevTools Manifest panel with final icon art.
- [ ] Code review via `/ecc:code-review`; PR opened as draft.
