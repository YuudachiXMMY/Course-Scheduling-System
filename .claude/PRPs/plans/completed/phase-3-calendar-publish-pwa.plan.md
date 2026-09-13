# Plan: Phase 3 — Calendar Publish (one-way) + PWA

## Summary

Turn the Phase-2 scheduling data into two zero-friction outputs for the tutor: (1) a **read-only `.ics`/`webcal` subscription feed** — an unguessable, capability-token URL that Apple Calendar and Google Calendar can subscribe to, so every lesson the tutor schedules shows up (one-way) on their own phone/desktop calendar with **no credentials, no OAuth**; and (2) an **installable PWA** — a web app manifest, icons, and a minimal service worker so the app can be added to the home screen on desktop and mobile. Both are pure "publish outward" features on top of the existing `lesson` rows; neither reads any external calendar (Postgres stays the single source of truth).

## User Story

As **the independent tutor**, I want **the lessons I schedule to appear automatically in my own Apple/Google calendar via a subscription link, and I want to install the app to my phone's home screen**, so that **I can glance at my teaching schedule alongside my personal calendar without re-entering anything, and open the scheduler like a native app — all without logging any calendar credentials into the system.**

## Problem → Solution

**Current state**: Phase 2 delivers full CRUD, recurrence materialization, conflict detection, and a responsive FullCalendar UI at `/dashboard/schedule`. Lessons live in the `lesson` table (`timestamptz` UTC instants, `Asia/Shanghai` wall-clock semantics). There is **no way to see the schedule outside the app** and **no PWA manifest/installability** — the app is a plain website behind auth.

**Desired state**: The tutor opens a **日历订阅** settings page, gets a `webcal://.../api/calendar/<token>` URL (copy button + QR), and subscribes to it in Apple Calendar / Google Calendar. Lessons appear as events at the correct `Asia/Shanghai` local times; editing/canceling a lesson is reflected on the calendar's next refresh **without duplicates** (stable UID per lesson). Separately, the browser offers "安装到主屏幕" via a valid manifest + icons + service worker; installed, the app opens standalone. All scoped correctly: the feed token exposes exactly one tenant's lessons and nothing else.

## Metadata

- **Complexity**: **Medium** (~14–17 files: 1 schema + 1 migration, 2 lib modules, 1 public feed route, 1 actions module, 1 settings page + 1 client component, PWA manifest + SW + registration + install-prompt + icons, tests; new deps: `ical-generator`, `@touch4it/ical-timezones`)
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: Phase 3 — Calendar Publish (one-way) + PWA (`pending` → `in-progress`)
- **Depends on**: Phase 2 — Core Scheduling + Conflict (**complete**). Runs **in parallel with Phase 4** (both depend only on Phase 2; Phase 4 owns parent export/share tokens, this phase owns the tutor's calendar feed — no shared files except `package.json` and `drizzle/`).
- **Estimated Files**: ~16 (mostly `CREATE`; `UPDATE` to `package.json`, `src/db/schema/index.ts`, `src/app/layout.tsx`, `src/app/(dashboard)/layout.tsx`, `src/auth/permissions.ts`)
- **Research basis**: 2 external doc lookups (ical-generator timezone/UID/HTTP headers; Next.js 16 App Router `manifest.ts` + PWA). Versions/APIs verified 2026-09. See **External Documentation**.

---

## Reconciliation Decisions (READ FIRST — binding choices for implementation)

The Phase-1/2 schema and conventions constrain the *shape*. These decisions resolve the *how* for Phase 3:

| # | Decision | Chosen | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| P3-1 | **Feed identity / access model** | A new tenant-scoped `calendar_feed` table holding an **unguessable token** (32-char `nanoid`), `tenantId`, optional `teacherId` scope, `label`, `revokedAt`. The token **is the capability**; the feed URL carries no auth. | Derive token from `tenantId`; a signed JWT; put the feed behind login | PRD requires "不可猜 token、无鉴权墙" so Apple/Google can poll it. A stored, revocable, rotatable token is safer than a derived one (can be rotated if leaked) and forward-compatible with per-student feeds (Phase 4 uses its OWN share token — kept separate). |
| P3-2 | **Feed route auth = NONE (deliberate `forTenant` exception)** | The feed route handler resolves `token → calendar_feed` row, then queries `lesson` **directly via `db`** scoped by `eq(lesson.tenantId, feed.tenantId)` — it does **not** call `requireAuthContext()`/`forTenant()` because there is no principal. | Force the feed through `forTenant()` | `forTenant()` requires an `AuthContext` (a verified principal); a public subscription has none. The token IS the row-level capability. This is the **only sanctioned public read path** — it is confined to one file (`src/lib/ical-feed.ts`), takes the resolved `feed.tenantId` (never a request param), and is heavily commented. Mirrors the tenant-isolation ADR's intent (no cross-tenant leak) while acknowledging the capability model. |
| P3-3 | **Feed route location** | `src/app/api/calendar/[token]/route.ts` (outside every route group, so **no dashboard/auth layout applies**). Content-Type `text/calendar; charset=utf-8`. | `app/(feed)/calendar/[token]/route.ts`; a `.ics` extension in the path | Placing it under `app/api/**` guarantees the `(dashboard)` auth-guard layout never wraps it and there's no accidental redirect-to-login. Clients drive off Content-Type, not extension; set `Content-Disposition: inline; filename="schedule.ics"` for the minority that sniff a name. |
| P3-4 | **Timezone emission** | Emit real `VTIMEZONE` for `Asia/Shanghai` via `ical-generator` + `@touch4it/ical-timezones` `getVtimezoneComponent`; each `VEVENT` uses `TZID=Asia/Shanghai`. `lesson.start_at/end_at` are UTC instants → ical-generator renders them in the calendar TZID. | Emit UTC `Z` times; `event.floating(true)` | PRD mandates explicit `TZID=Asia/Shanghai`. China is fixed **UTC+8, no DST**, so the VTIMEZONE is trivial and stable. Floating time is wrong for a subscription (client reinterprets in its own zone). |
| P3-5 | **Stable UID (no duplicates on refresh)** | `VEVENT.UID = ${lesson.id}@<host>` where `<host>` is the hostname of `NEXT_PUBLIC_APP_URL`. `lesson.id` is the DB nanoid PK → deterministic and permanent. Set `LAST-MODIFIED`/`DTSTAMP` from `lesson.updatedAt`; bump `SEQUENCE` is unnecessary for subscriptions (whole feed is re-fetched). | Random UID per render; UID from `originalStartAt` | A subscription client reconciles events **by UID**; a changing UID duplicates every event on each poll (the #1 .ics bug the PRD calls out). PK-derived UID is stable across edits, reschedules, and re-materialization. |
| P3-6 | **Canceled + window semantics** | Emit only `status != 'canceled'` lessons within a **rolling window** `[now − 8 weeks, now + 26 weeks]` (Asia/Shanghai calendar-day bounds). Canceled lessons are **omitted** (they disappear on next client refresh). | Emit all lessons ever; emit canceled as `STATUS:CANCELLED` | Bounds feed size (subscriptions poll repeatedly). Omission is correct for subscriptions: the client removes any UID no longer present. `STATUS:CANCELLED` only matters for one-shot invites, not feeds. |
| P3-7 | **Feed content = teacher's lessons (whole tenant, MVP)** | The feed exposes **all non-canceled lessons of the feed's tenant** (the tutor is the sole teacher). `teacherId` column on `calendar_feed` is stored for forward-compat but MVP filters by `tenantId` only. | Per-teacher / per-student feeds now | MVP is single-tutor; per-student parent feeds are Phase 4's share tokens (a different table + noindex web page), not this calendar subscription. Keep this feed = "my whole teaching schedule". |
| P3-8 | **RBAC for feed management** | Reuse existing statements (per P2-9 precedent): viewing the feed URL requires `lesson: ['read']`; **create/rotate/revoke** the token requires `lesson: ['update']`. No new AC statement. | Add a `calendarFeed` statement to the role matrix | Avoids expanding the role matrix mid-MVP. Managing the outward publication of lessons maps intuitively to editing-tier lesson permission. A dedicated statement is a Phase-7 concern (documented). |
| P3-9 | **PWA scope (MVP)** | `app/manifest.ts` (`MetadataRoute.Manifest`, auto-served at `/manifest.webmanifest`), PNG icons in `public/` (192, 512, 512-maskable, apple-touch-icon 180), `appleWebApp` metadata, and a **minimal service worker** (`public/sw.js`, fetch pass-through) registered client-side purely to satisfy installability. **No offline caching, no push.** | Use `next-pwa`/Serwist; full offline cache; push notifications | PRD Phase 3 = "可安装 PWA"; push/offline are explicitly deferred (Phase 7 reminders). A hand-written 20-line SW avoids a heavy build-time plugin and keeps `output: 'standalone'` simple. `public/` is already copied into the runtime image (Dockerfile line copies `/app/public`). |
| P3-10 | **Install prompt ordering** | Capture `beforeinstallprompt`, stash it, show an unobtrusive "安装到主屏幕" button. **No `Notification.requestPermission()` anywhere in MVP** — so the PRD's "安装提示排在通知权限请求之前" holds trivially. | Auto-fire prompt on load; request notifications | iOS ignores `beforeinstallprompt` (uses manual Add-to-Home-Screen) — a button + apple-touch-icon covers both. Never auto-nag. |

---

## UX Design

### Before
```
┌───────────────────────────────────────────────────────────┐
│ /dashboard/schedule → FullCalendar (Phase 2), auth-gated.   │
│ No way to see the schedule outside the app.                 │
│ Plain website: no manifest, no "install", no home-screen.   │
└───────────────────────────────────────────────────────────┘
```

### After
```
┌───────────────────────────────────────────────────────────────────┐
│ /dashboard/calendar  ← new 日历订阅 settings page                    │
│   • shows: webcal://host/api/calendar/<token>  [复制] [二维码]        │
│   • 「在 Apple 日历订阅」/「在 Google 日历订阅」说明                    │
│   • [重新生成链接] (rotate) → old link 404s   [停用] (revoke)          │
│                                                                       │
│ Apple/Google Calendar (external): subscribe once → lessons appear    │
│   at correct Asia/Shanghai times; edits update on refresh, no dupes. │
│                                                                       │
│ Browser: address-bar "安装" / in-app 「安装到主屏幕」button →         │
│   app installs standalone (own icon, no browser chrome).             │
└───────────────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| See schedule in personal calendar | impossible | subscribe to `webcal://…/api/calendar/<token>` | one-way, zero credentials |
| Feed link management | none | `/dashboard/calendar`: view/copy/rotate/revoke | rotate invalidates old token |
| Edit/cancel a lesson | updates DB + in-app calendar | also reflected in subscribed calendar on next poll | stable UID → no duplicates; canceled disappears |
| Install app | not installable | manifest + icons + SW → home-screen install | standalone display; iOS via Add-to-Home-Screen |

---

## Mandatory Reading

Files that MUST be read before implementing (all paths repo-relative):

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/tenant.ts` | 1-55 | The `forTenant` spine + the M1 comment explaining it's the ONLY sanctioned tenant path. P3-2 is a *documented exception* — read this to write the exception correctly. |
| P0 | `src/db/schema/_helpers.ts` | 1-20 | `primaryId()/tenantId()/createdAt()/updatedAt()` — the exact column helpers the new `calendar_feed` table must reuse. |
| P0 | `src/db/schema/course.ts` | 16-67 | Canonical table definition style: `pgTable`, `uniqueIndex('uq_..._tenant_id')`, `index('idx_...')`, composite-FK pattern. Mirror for `calendar_feed`. |
| P0 | `src/app/(dashboard)/schedule/actions.ts` | 1-149 | The Server Action pattern: `'use server'`, `requireAuthContext()` → `requirePermission()` → `zod.parse()` → `forTenant()` → `revalidatePath()`. Mirror for feed actions. |
| P0 | `src/lib/materialize.ts` | 1-97 | `server-only`, Luxon zone handling, `localDayBound` helper (reuse the windowing idea for the feed's rolling window), UTC-instant conventions. |
| P1 | `src/app/(dashboard)/schedule/data.ts` | 1-31 | The `server-only` read pattern (`forTenant(ctx).select(lesson, and(...))`) — the feed query mirrors this but scopes by resolved `feed.tenantId` instead of `ctx`. |
| P1 | `src/auth/permissions.ts` | 14-49 | Existing statements/roles. P3-8 reuses `lesson` perms — confirm no new statement needed. |
| P1 | `src/app/layout.tsx` | 1-16 | Root layout — where `appleWebApp` metadata + `<ServiceWorkerRegister/>` mount. |
| P1 | `src/app/api/health/route.ts` | 1-6 | Route Handler conventions: `export const runtime = 'nodejs'`, `export const dynamic`, `GET()` returning a `Response`. |
| P1 | `src/env.ts` | 1-16 | `NEXT_PUBLIC_APP_URL` (client) is the source for the feed host/UID domain and the `webcal://` URL. |
| P2 | `Dockerfile` | (runtime stage) | Confirms `public/` is copied to the runtime image → PWA icons + `sw.js` ship. Note the "PHASE 4/5 ONLY: CJK fonts" line — Phase 3 needs **no** font/Playwright changes. |
| P2 | `src/db/schema/index.ts` | 1-11 | Barrel — add `export * from './calendar-feed'` here so drizzle-kit + `db` see the new table. |
| P2 | `.claude/PRPs/plans/completed/phase-2-core-scheduling-conflict.plan.md` | all | Style/format reference and the P2-* decisions this plan builds on. |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| ical-generator timezone | `/sebbo2002/ical-generator` (README) | `cal.timezone({ name: 'Asia/Shanghai', generator: getVtimezoneComponent })` + per-event `.timezone('Asia/Shanghai')`. Requires companion dep `@touch4it/ical-timezones`. Emits a real `VTIMEZONE`. |
| ical-generator HTTP headers | `/sebbo2002/ical-generator` (quick-start "Production Considerations") | For **subscriptions** serve `Content-Type: text/calendar` + caching headers (NOT `application/octet-stream`, which forces a one-time download instead of a subscription). |
| ical-generator API | `/sebbo2002/ical-generator` | `import ical from 'ical-generator'` → `const cal = ical({...})` → `cal.createEvent({ start, end, summary, ... })` → `event.uid(...)` → `cal.toString()`. |
| Next.js PWA manifest | `/vercel/next.js` (progressive-web-apps guide) | `app/manifest.ts` exports `default function manifest(): MetadataRoute.Manifest`. Next auto-serves it at `/manifest.webmanifest` with `application/manifest+json`, cache `public, max-age=0, must-revalidate`, and **injects `<link rel="manifest">` automatically** — no manual `<link>` needed. |
| Next.js icons/apple | `/vercel/next.js` | Icons referenced by manifest live in `public/` (served at root). Apple needs `apple-touch-icon` + `appleWebApp` metadata in the root layout. |

```
KEY_INSIGHT: ical-generator needs @touch4it/ical-timezones to emit a VTIMEZONE; without it, TZID events fall back to floating/UTC.
APPLIES_TO: Task 2 (src/lib/ical-feed.ts), Task 0 (deps)
GOTCHA: install BOTH `ical-generator` and `@touch4it/ical-timezones`; the generator fn is passed to cal.timezone({generator}).

KEY_INSIGHT: Next 16 auto-routes app/manifest.ts to /manifest.webmanifest AND auto-injects <link rel="manifest">.
APPLIES_TO: Task 7 (manifest), Task 8 (root layout)
GOTCHA: Do NOT also hand-add <link rel="manifest"> — you'll get a duplicate. Only add apple-touch-icon + appleWebApp via the Metadata object.

KEY_INSIGHT: A subscription feed must be text/calendar; application/octet-stream turns it into a one-time download.
APPLIES_TO: Task 3 (feed route)
GOTCHA: Set Content-Type: 'text/calendar; charset=utf-8' and Cache-Control for polling; use Content-Disposition: inline (not attachment).
```

---

## Patterns to Mirror

Follow these exactly. All snippets are verbatim from the current codebase.

### NAMING_CONVENTION — table definition + indexes
```ts
// SOURCE: src/db/schema/course.ts:16-34
export const course = pgTable(
  'course', // reusable TEMPLATE, tenant-scoped
  {
    id: primaryId(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    // ...
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_course_tenant_id').on(t.tenantId, t.id),
    index('idx_course_tenant').on(t.tenantId),
  ],
)
```

### COLUMN_HELPERS
```ts
// SOURCE: src/db/schema/_helpers.ts:5-20
export const primaryId = () => text('id').primaryKey().$defaultFn(() => nanoid())
export const tenantId = () => text('tenant_id').notNull()
export const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
export const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow().$onUpdate(() => new Date())
```

### SERVER_ACTION_PATTERN
```ts
// SOURCE: src/app/(dashboard)/schedule/actions.ts:1-9,44-49,82
'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
// ...
export async function createLessonAction(input: z.input<typeof createSchema>): Promise<ScheduleResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['create'] })
  const data = createSchema.parse(input)
  // ... forTenant(ctx).insert/update/select ...
  revalidatePath('/dashboard/schedule')
}
```

### SERVER_ONLY_READ (tenant-scoped)
```ts
// SOURCE: src/app/(dashboard)/schedule/data.ts:1-21
import 'server-only'
import { and, gte, lt, ne } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { lesson } from '@/db/schema'

const rows = (await forTenant(ctx).select(
  lesson,
  and(gte(lesson.startAt, from), lt(lesson.startAt, to), ne(lesson.status, 'canceled')),
)) as (typeof lesson.$inferSelect)[]
```
> **P3-2 divergence**: the feed's read has NO `ctx`. It uses `db` directly with `eq(lesson.tenantId, feed.tenantId)` — see Task 2. Everything else (server-only, drizzle operators, `ne(status,'canceled')`) is identical.

### LUXON_ZONE_WINDOWING
```ts
// SOURCE: src/lib/materialize.ts:2,24,30-40
import { DateTime } from 'luxon'
const zone = 'Asia/Shanghai'
// Snap a Date to the FULL local calendar day so edge occurrences aren't clipped:
const localDayBound = (d: Date, edge: 'start' | 'end') => {
  const utc = DateTime.fromJSDate(d, { zone: 'utc' })
  const local = DateTime.fromObject({ year: utc.year, month: utc.month, day: utc.day }, { zone })
  return (edge === 'start' ? local.startOf('day') : local.endOf('day')).toUTC().toJSDate()
}
```

### ROUTE_HANDLER
```ts
// SOURCE: src/app/api/health/route.ts:1-6
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET() {
  return Response.json({ ok: true, ts: Date.now() }, { status: 200 })
}
```

### TEST_STRUCTURE (Vitest, pure-fn, uses server-only stub)
```ts
// SOURCE: tests/recurrence.test.ts:1-32
import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { expandRecurrence } from '@/lib/recurrence'

describe('expandRecurrence', () => {
  it('weekly Monday over a 4-week window yields 4 occurrences at 16:00 local (08:00 UTC)', () => {
    // build inputs with Luxon → call fn → assert getUTCHours()/lengths
    expect(occ).toHaveLength(4)
  })
})
```
> Note `tests/server-only-stub.ts` exists so importing modules with `import 'server-only'` works under Vitest. Keep the `.ics` **builder** a pure function (`buildIcs(lessons, opts): string`) so it's unit-testable without a DB, exactly as `expandRecurrence` is separated from `materializeSection`.

### PERMISSIONS (reuse, don't extend)
```ts
// SOURCE: src/auth/permissions.ts:16-18,42-49
lesson: ['create', 'read', 'list', 'update', 'delete'],
// teacher role already has: lesson: ['create','read','list','update']
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` | UPDATE | Add deps `ical-generator`, `@touch4it/ical-timezones`. |
| `src/db/schema/calendar-feed.ts` | CREATE | New `calendar_feed` table (P3-1). |
| `src/db/schema/index.ts` | UPDATE | `export * from './calendar-feed'` so drizzle-kit + `db` see it. |
| `drizzle/0002_*.sql` (+ `meta/`) | CREATE | Generated migration for the new table (`pnpm db:generate`). |
| `src/lib/ical-feed.ts` | CREATE | Pure `buildIcs()` builder + `getFeedLessons(tenantId)` public read (P3-2/4/5/6). |
| `src/app/api/calendar/[token]/route.ts` | CREATE | Public, no-auth feed route (P3-3). |
| `src/app/(dashboard)/calendar/actions.ts` | CREATE | `getOrCreateFeed` / `rotateFeed` / `revokeFeed` server actions (P3-8). |
| `src/app/(dashboard)/calendar/data.ts` | CREATE | `server-only` read of the current tenant's feed row (for the settings page). |
| `src/app/(dashboard)/calendar/page.tsx` | CREATE | 日历订阅 settings page (Server Component). |
| `src/app/(dashboard)/calendar/feed-panel.tsx` | CREATE | `'use client'` copy/rotate/revoke UI + `webcal://` link. |
| `src/app/(dashboard)/layout.tsx` | UPDATE | Add 日历订阅 nav link. |
| `src/app/manifest.ts` | CREATE | PWA manifest (P3-9). |
| `src/app/layout.tsx` | UPDATE | `appleWebApp` metadata + mount `<ServiceWorkerRegister/>`. |
| `src/app/sw-register.tsx` | CREATE | `'use client'` service-worker registration + `beforeinstallprompt` install button (P3-9/10). |
| `public/sw.js` | CREATE | Minimal fetch-through service worker (installability only). |
| `public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png`, `public/apple-touch-icon.png` | CREATE | Manifest + Apple icons (see Task 9 for generation). |
| `src/auth/permissions.ts` | (NO CHANGE) | P3-8 reuses `lesson` perms — verify only. |
| `tests/ical-feed.test.ts` | CREATE | Unit tests for `buildIcs()` (UID stability, TZID, canceled omission, window). |

## NOT Building

- **Two-way sync / reading external calendars** — one-way publish only; Postgres remains authoritative (PRD "NOT Building", Phase 7 optional).
- **Google user-OAuth, service accounts, `watch` push channels, syncToken polling** — none needed for a read-only `.ics`; explicitly Phase 7.
- **Per-student / per-parent calendar feeds** — Phase 4 owns parent sharing via its own share-token + noindex web page + PNG/ZIP. This feed is the *tutor's whole schedule*.
- **Offline caching, background sync, push notifications** — the SW is installability-only (P3-9). Push/reminders are Phase 7.
- **CalDAV / iCloud write** — Won't (now) per PRD.
- **Auto-firing install prompts or notification-permission requests** — never nag (P3-10).
- **New RBAC statement for feeds** — reuse `lesson` perms (P3-8); split is a Phase-7 concern.

---

## Step-by-Step Tasks

### Task 0: Add dependencies
- **ACTION**: Add `ical-generator` and `@touch4it/ical-timezones` to `dependencies` in `package.json`, then install.
- **IMPLEMENT**: `pnpm add ical-generator @touch4it/ical-timezones` (project declares `packageManager: pnpm@10.0.0`).
- **GOTCHA**: The repo maintains **both** `pnpm-lock.yaml` (local) and `package-lock.json` (CI/Docker `npm ci`). After `pnpm add`, also run `npm install --package-lock-only` to sync `package-lock.json`, or the Docker build's `npm ci` fails (this exact failure sank PR #4). Commit **both** lockfiles.
- **VALIDATE**: `pnpm install` clean; `npm install --package-lock-only` produces no drift; `git diff` shows both lockfiles updated.

### Task 1: `calendar_feed` schema + migration
- **ACTION**: Create `src/db/schema/calendar-feed.ts`; export it from the barrel; generate a migration.
- **IMPLEMENT**:
  ```ts
  import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
  import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'

  export const calendarFeed = pgTable(
    'calendar_feed',
    {
      id: primaryId(),
      tenantId: tenantId(),
      token: text('token').notNull(),        // 32-char nanoid capability; unguessable; rotatable
      teacherId: text('teacher_id'),          // forward-compat scope (MVP: null → whole-tenant feed)
      label: text('label'),                   // e.g. "我的教学日历"
      revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('uq_calendar_feed_tenant_id').on(t.tenantId, t.id),
      uniqueIndex('uq_calendar_feed_token').on(t.token), // fast, unique token lookup for the public route
      index('idx_calendar_feed_tenant').on(t.tenantId),
    ],
  )
  ```
  Then add `export * from './calendar-feed'` to `src/db/schema/index.ts` (before `./relations`).
- **MIRROR**: NAMING_CONVENTION + COLUMN_HELPERS.
- **GOTCHA**: `uq_calendar_feed_token` is a **global** unique index (not tenant-prefixed) — the public route looks up by token alone with no tenant context. This is intentional and safe (token → its own tenant).
- **VALIDATE**: `pnpm db:generate` creates `drizzle/0002_*.sql` with the table + indexes; `pnpm typecheck` passes.

### Task 2: `.ics` builder + public read (`src/lib/ical-feed.ts`)
- **ACTION**: Create a **pure** `buildIcs()` (unit-testable) and a `getFeedLessons()` public DB read.
- **IMPLEMENT**:
  ```ts
  import 'server-only'
  import ical from 'ical-generator'
  import { getVtimezoneComponent } from '@touch4it/ical-timezones'
  import { DateTime } from 'luxon'
  import { and, eq, gte, lt, ne } from 'drizzle-orm'
  import { db } from '@/db'
  import { lesson } from '@/db/schema'

  const ZONE = 'Asia/Shanghai'

  export interface FeedLesson { id: string; title: string | null; startAt: Date; endAt: Date; location: string | null }

  // Rolling window in Asia/Shanghai calendar days: [now-8w, now+26w]. Reuse the localDayBound idea from materialize.ts.
  export function feedWindow(now = new Date()): { from: Date; to: Date } {
    const n = DateTime.fromJSDate(now).setZone(ZONE)
    return {
      from: n.minus({ weeks: 8 }).startOf('day').toUTC().toJSDate(),
      to: n.plus({ weeks: 26 }).endOf('day').toUTC().toJSDate(),
    }
  }

  // P3-2 EXCEPTION: NO AuthContext here. The token already resolved to `tenantId` (a verified capability).
  // Scope STRICTLY by that tenantId — never by a request param. Do NOT use forTenant() (it needs a principal).
  export async function getFeedLessons(tenantId: string): Promise<FeedLesson[]> {
    const { from, to } = feedWindow()
    const rows = (await db
      .select({ id: lesson.id, title: lesson.title, startAt: lesson.startAt, endAt: lesson.endAt, location: lesson.location })
      .from(lesson)
      .where(and(eq(lesson.tenantId, tenantId), gte(lesson.startAt, from), lt(lesson.startAt, to), ne(lesson.status, 'canceled')))
    )
    return rows
  }

  export function buildIcs(lessons: FeedLesson[], opts: { host: string; name?: string }): string {
    const cal = ical({ name: opts.name ?? '课程排课', prodId: { company: 'course-scheduler', product: 'schedule' } })
    cal.timezone({ name: ZONE, generator: getVtimezoneComponent })
    for (const l of lessons) {
      const e = cal.createEvent({
        start: l.startAt,          // UTC instant; rendered in TZID below
        end: l.endAt,
        timezone: ZONE,            // → TZID=Asia/Shanghai
        summary: l.title ?? '课节',
        location: l.location ?? undefined,
      })
      e.uid(`${l.id}@${opts.host}`) // P3-5: stable, PK-derived UID → no duplicates on refresh
    }
    return cal.toString()
  }
  ```
- **MIRROR**: SERVER_ONLY_READ (drizzle operators, `ne(status,'canceled')`), LUXON_ZONE_WINDOWING.
- **IMPORTS**: `ical` (default) from `ical-generator`; `getVtimezoneComponent` from `@touch4it/ical-timezones`; `DateTime` from `luxon`; drizzle ops; `db`, `lesson`.
- **GOTCHA**: (1) Keep `buildIcs` pure (no DB) so the test can pass fabricated lessons — mirrors `expandRecurrence` vs `materializeSection`. (2) `cal.timezone({generator})` is REQUIRED for a real VTIMEZONE; without it TZID events silently degrade. (3) Do not select canceled rows.
- **VALIDATE**: `pnpm typecheck`; covered by Task 10 tests.

### Task 3: Public feed route (`src/app/api/calendar/[token]/route.ts`)
- **ACTION**: Resolve token → feed row (not revoked) → build + return `.ics`. No auth.
- **IMPLEMENT**:
  ```ts
  import { and, eq, isNull } from 'drizzle-orm'
  import { db } from '@/db'
  import { calendarFeed } from '@/db/schema'
  import { getFeedLessons, buildIcs } from '@/lib/ical-feed'
  import { env } from '@/env'

  export const runtime = 'nodejs'
  export const dynamic = 'force-dynamic'

  export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params           // Next 16: params is a Promise
    const [feed] = await db.select().from(calendarFeed)
      .where(and(eq(calendarFeed.token, token), isNull(calendarFeed.revokedAt))).limit(1)
    if (!feed) return new Response('Not found', { status: 404 })

    const lessons = await getFeedLessons(feed.tenantId)
    const host = new URL(env.NEXT_PUBLIC_APP_URL).host
    const body = buildIcs(lessons, { host, name: feed.label ?? '课程排课' })

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="schedule.ics"',
        'Cache-Control': 'public, max-age=3600',   // subscription poll cadence
      },
    })
  }
  ```
- **MIRROR**: ROUTE_HANDLER (`runtime='nodejs'`, `GET` returning `Response`).
- **GOTCHA**: (1) Next 16 makes `params` a **Promise** — `await params` (matches `headers()`/`cookies()` async change already used in `src/auth/context.ts`). (2) Return 404 (not 401/redirect) for bad/revoked tokens — no auth semantics, and it's outside `(dashboard)` so no login redirect (P3-3). (3) `text/calendar`, NOT `application/octet-stream` (else it downloads instead of subscribing). (4) A leaked token exposes only that tenant's lessons; that's the capability model — revoke rotates it.
- **VALIDATE**: `curl -i http://localhost:3000/api/calendar/<token>` returns `200 text/calendar` with `BEGIN:VCALENDAR`…`VTIMEZONE`…`TZID:Asia/Shanghai`; a bad token returns 404.

### Task 4: Feed management actions (`src/app/(dashboard)/calendar/actions.ts`)
- **ACTION**: `getOrCreateFeed` (idempotent: one active feed per tenant), `rotateFeed` (new token, keep row), `revokeFeed` (set `revokedAt`).
- **IMPLEMENT**: `'use server'`; each starts `const ctx = await requireAuthContext()`. `getOrCreateFeed` requires `lesson: ['read']`; `rotate`/`revoke` require `lesson: ['update']`. Use `forTenant(ctx)` for all writes/reads of `calendarFeed` (it's a normal tenant table here — only the PUBLIC route bypasses forTenant). Token = `nanoid(32)`. `getOrCreateFeed`: `forTenant(ctx).select(calendarFeed, isNull(revokedAt))`; if none, `forTenant(ctx).insert(calendarFeed, { token: nanoid(32), label: '我的教学日历' })`. `revalidatePath('/dashboard/calendar')`.
- **MIRROR**: SERVER_ACTION_PATTERN.
- **IMPORTS**: `nanoid` from `nanoid`; `requireAuthContext`, `requirePermission`, `forTenant`, `calendarFeed`, `revalidatePath`, drizzle `isNull`.
- **GOTCHA**: `rotate` = update existing row's `token` (don't create duplicates); old URL 404s immediately because the route matches on exact token. Keep exactly one non-revoked feed per tenant (the `getOrCreate` guard).
- **VALIDATE**: `pnpm typecheck`; manual: call `getOrCreateFeed` twice → same row/token; `rotateFeed` → token changes.

### Task 5: Feed settings read + page (`data.ts` + `page.tsx`)
- **ACTION**: `server-only` `getActiveFeed(ctx)` read; Server Component page rendering the `webcal://` URL and controls.
- **IMPLEMENT**: `data.ts`: `import 'server-only'`; `forTenant(ctx).select(calendarFeed, isNull(calendarFeed.revokedAt))` → first row or null. `page.tsx`: `const ctx = await requireAuthContext(); requirePermission(ctx, { lesson: ['read'] })`; fetch feed; compute `const base = env.NEXT_PUBLIC_APP_URL; const httpsUrl = \`${base}/api/calendar/${feed.token}\`; const webcalUrl = httpsUrl.replace(/^https?:/, 'webcal:')`; render `<FeedPanel httpsUrl webcalUrl hasFeed=… />` + Apple/Google subscribe instructions (中文).
- **MIRROR**: SERVER_ONLY_READ; `src/app/(dashboard)/page.tsx` for the page shell/Tailwind.
- **GOTCHA**: `webcal://` is just `https://` with the scheme swapped — Apple/Google interpret it as "subscribe" vs "download". Show both (webcal for one-tap subscribe, https for manual paste).
- **VALIDATE**: Visit `/dashboard/calendar` while logged in → shows a `webcal://…` link; typecheck passes.

### Task 6: Feed panel client component (`feed-panel.tsx`)
- **ACTION**: `'use client'` — copy-to-clipboard, "重新生成链接" (calls `rotateFeed`), "停用" (calls `revokeFeed`), and a QR of the webcal URL (optional; if no QR lib, show the URL only — do NOT add a QR dep in this phase).
- **IMPLEMENT**: Buttons call the server actions (imported from `./actions`), then `router.refresh()`. Copy via `navigator.clipboard.writeText`. Confirm before rotate/revoke (window.confirm is fine — this is a dashboard, not a dialog-sensitive automated page).
- **MIRROR**: existing `'use client'` components under `schedule/` (e.g. `lesson-detail.tsx`) for the action-call + refresh idiom.
- **GOTCHA**: Don't build QR here (would add a dep and overlap Phase 4, which owns QR for parent PNGs). Plain URL + copy button meets the Phase-3 success signal.
- **VALIDATE**: Click copy → clipboard has the URL; rotate → page shows a new token after refresh.

### Task 7: PWA manifest (`src/app/manifest.ts`)
- **ACTION**: Export a `MetadataRoute.Manifest`.
- **IMPLEMENT**:
  ```ts
  import type { MetadataRoute } from 'next'
  export default function manifest(): MetadataRoute.Manifest {
    return {
      name: '课程排课系统',
      short_name: '排课',
      description: '独立教师的学生、课程与排课管理系统',
      id: '/',
      start_url: '/dashboard/schedule',
      scope: '/',
      display: 'standalone',
      lang: 'zh-Hans',
      background_color: '#ffffff',
      theme_color: '#ffffff',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
  }
  ```
- **MIRROR**: External Documentation (Next.js manifest snippet). Reuse the app title/description from `src/app/layout.tsx:5-8`.
- **GOTCHA**: Next auto-serves this at `/manifest.webmanifest` and auto-injects `<link rel="manifest">`. **Do NOT** hand-add the link. `start_url` points at the schedule (the app's real home behind auth).
- **VALIDATE**: `curl -i http://localhost:3000/manifest.webmanifest` → `application/manifest+json` JSON; Chrome DevTools → Application → Manifest shows no errors (once icons exist).

### Task 8: Root layout — Apple metadata + SW registration
- **ACTION**: Extend `metadata` with `appleWebApp` + `icons.apple`; mount `<ServiceWorkerRegister/>` in `<body>`.
- **IMPLEMENT** (edit `src/app/layout.tsx`):
  ```ts
  export const metadata: Metadata = {
    title: '课程排课系统',
    description: '独立教师的学生、课程与排课管理系统',
    manifest: '/manifest.webmanifest',            // explicit is fine; Next also auto-injects
    appleWebApp: { capable: true, statusBarStyle: 'default', title: '排课' },
    icons: { apple: '/apple-touch-icon.png' },
  }
  // ...in <body>, after {children}: <ServiceWorkerRegister />
  ```
- **MIRROR**: current `src/app/layout.tsx` structure (keep `lang="zh-Hans"`, `min-h-dvh`).
- **GOTCHA**: `<ServiceWorkerRegister/>` is a client component; importing it into a server layout is fine (it self-marks `'use client'`). Keep the layout itself a Server Component.
- **VALIDATE**: typecheck; page `<head>` has `apple-touch-icon` + a single manifest link.

### Task 9: Icons in `public/`
- **ACTION**: Add `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png` (180×180).
- **IMPLEMENT**: Generate simple branded placeholders (solid `theme_color` bg + "排" glyph). If ImageMagick is available: `convert -size 512x512 xc:'#ffffff' -gravity center -pointsize 320 -annotate 0 '排' public/icon-512.png` then downscale for 192/180; maskable = same art with ~20% safe-area padding. Otherwise commit any valid PNGs of the right dimensions as placeholders and note that final art is a polish item.
- **GOTCHA**: `output: 'standalone'` does NOT auto-copy `public/`, but the **Dockerfile already** `COPY --from=build /app/public ./public` — so icons ship in the container. No Dockerfile change needed. Files must be real PNGs of the declared sizes or Chrome flags the manifest.
- **VALIDATE**: `file public/icon-512.png` → PNG 512×512; DevTools Manifest panel shows icons with no size warnings.

### Task 10: Service worker + registration/install (`public/sw.js` + `src/app/sw-register.tsx`)
- **ACTION**: Minimal SW (installability only) + client registration that also wires the install button.
- **IMPLEMENT**:
  - `public/sw.js`:
    ```js
    // Minimal SW: installability only (no offline cache, no push). Phase 7 may add caching.
    self.addEventListener('install', () => self.skipWaiting())
    self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
    self.addEventListener('fetch', () => {}) // pass-through; presence of a fetch handler enables install
    ```
  - `src/app/sw-register.tsx`:
    ```tsx
    'use client'
    import { useEffect, useState } from 'react'
    export function ServiceWorkerRegister() {
      const [deferred, setDeferred] = useState<Event | null>(null)
      useEffect(() => {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
        const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e) }
        window.addEventListener('beforeinstallprompt', onPrompt)
        return () => window.removeEventListener('beforeinstallprompt', onPrompt)
      }, [])
      if (!deferred) return null
      return (
        <button
          onClick={async () => { await (deferred as any).prompt(); setDeferred(null) }}
          className="fixed bottom-4 right-4 rounded bg-neutral-900 px-3 py-2 text-sm text-white shadow"
        >安装到主屏幕</button>
      )
    }
    ```
- **GOTCHA**: (1) Register SW only client-side, guarded by `'serviceWorker' in navigator` (SSR-safe). (2) **Never** call `Notification.requestPermission()` — keeps P3-10's ordering invariant trivially true. (3) SW must be at origin root (`/sw.js`) to control the whole scope — that's why it lives in `public/`, not `app/`. (4) iOS won't fire `beforeinstallprompt` (returns null → no button); Add-to-Home-Screen + `apple-touch-icon` covers iOS.
- **VALIDATE**: DevTools → Application → Service Workers shows `sw.js` activated; Lighthouse PWA "installable" check passes; on desktop Chrome the install affordance appears.

### Task 11: Nav link
- **ACTION**: Add a 日历订阅 link to the dashboard nav.
- **IMPLEMENT**: In `src/app/(dashboard)/layout.tsx`, add `<Link href="/dashboard/calendar" className="text-neutral-700 hover:underline">日历订阅</Link>` alongside 排课/学生/课程.
- **MIRROR**: existing `<Link>` entries (lines 17-25).
- **VALIDATE**: Nav shows 日历订阅; it routes to the settings page.

### Task 12: Tests (`tests/ical-feed.test.ts`)
- **ACTION**: Unit-test the pure `buildIcs()` + `feedWindow()`.
- **IMPLEMENT** (mirror `tests/recurrence.test.ts`):
  - Given two lessons with known UTC instants, `buildIcs(..., {host:'example.com'})` output contains `BEGIN:VCALENDAR`, `BEGIN:VTIMEZONE` with `TZID:Asia/Shanghai`, a `VEVENT` per lesson, and `UID:<lessonId>@example.com`.
  - **Stable UID**: calling `buildIcs` twice on the same lessons yields identical `UID:` lines (regex-extract and compare).
  - **Local time**: a lesson at `08:00Z` renders as `DTSTART;TZID=Asia/Shanghai:...T160000` (16:00 local, matching the recurrence test's invariant).
  - `feedWindow()` returns `from < to` and spans ~34 weeks.
- **GOTCHA**: `buildIcs` imports `ical-generator` (has `import 'server-only'` at the top of `ical-feed.ts`) — the existing `tests/server-only-stub.ts` already neutralizes that; confirm `vitest` config aliases it (it does for the Phase-2 tests). Do NOT test the route/DB read here (no DB in unit tests) — keep it to the pure functions, exactly as Phase 2 tests `expandRecurrence` not `materializeSection`.
- **VALIDATE**: `pnpm test` — new file green alongside the existing suites.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| VCALENDAR shape | 2 lessons | contains `BEGIN:VCALENDAR`, `VTIMEZONE`, 2×`VEVENT` | no |
| TZID present | any lesson | `TZID:Asia/Shanghai` in VTIMEZONE + `DTSTART;TZID=Asia/Shanghai` | no |
| Stable UID | same lessons ×2 renders | identical `UID:<id>@host` both times | yes (dedup on refresh) |
| Local wall-clock | lesson at 08:00Z | `...T160000` (16:00 +08) | yes (tz correctness) |
| Canceled omitted | mix incl. canceled (via `getFeedLessons` query filter) | canceled UID absent | yes |
| `feedWindow` bounds | now | `from < to`, ~34 weeks apart, Asia/Shanghai day edges | yes |
| Empty feed | 0 lessons | valid empty VCALENDAR (no VEVENT) | yes (empty input) |

### Edge Cases Checklist
- [x] Empty input — feed with no lessons still emits a valid empty VCALENDAR.
- [x] Invalid/revoked token — route returns 404 (manual/integration).
- [ ] Maximum size — window cap (P3-6) bounds it; note the 26-week horizon in the settings page copy.
- [x] Invalid types — Zod on management actions; the public route only reads a string token.
- [ ] Concurrent access — feed is read-only; `getOrCreateFeed` may race on first create (rare, single-tutor). Accept: worst case two rows; the `getActiveFeed` read takes the first. (Documented; a `uniqueIndex` on `(tenant_id, revoked_at)` is a possible Phase-7 hardening.)
- [x] Permission denied — rotate/revoke gated by `lesson:['update']`; view by `lesson:['read']`.

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
pnpm lint
```
EXPECT: Zero type errors, zero lint errors.

### Unit Tests
```bash
pnpm test
```
EXPECT: All suites pass — existing (recurrence/conflict/rbac/materialize/tenant-isolation) + new `ical-feed`.

### Database / Migration
```bash
pnpm db:generate          # creates drizzle/0002_*.sql for calendar_feed
# in a DB-enabled env (docker compose up postgres):
pnpm db:migrate           # applies cleanly (advisory-locked migrator)
```
EXPECT: New migration generated; applies with no error; `calendar_feed` table present with `uq_calendar_feed_token`.

### Feed Route (manual, dev server)
```bash
pnpm dev
# after creating a feed via /dashboard/calendar, copy the token:
curl -i http://localhost:3000/api/calendar/<token>
curl -i http://localhost:3000/api/calendar/deadbeef-not-a-token   # → 404
```
EXPECT: 200 `text/calendar; charset=utf-8`; body has `BEGIN:VCALENDAR`, `BEGIN:VTIMEZONE`/`TZID:Asia/Shanghai`, `UID:<id>@<host>`, correct `DTSTART;TZID=Asia/Shanghai`. Bad token → 404.

### PWA (manual, browser)
```bash
pnpm dev   # or the standalone build for a truer test
```
EXPECT: `/manifest.webmanifest` serves valid JSON; DevTools → Application → Manifest: no errors, icons load; Service Workers: `sw.js` activated; Lighthouse PWA: "installable" ✓; install affordance appears (desktop Chrome / Android).

### Manual Validation
- [ ] Subscribe to the `webcal://` URL in **Apple Calendar** → lessons appear at correct Asia/Shanghai times.
- [ ] Subscribe in **Google Calendar** ("From URL", paste the `https://` form) → lessons appear.
- [ ] Reschedule a lesson in-app → after the client's refresh, the event **moves** (not duplicated).
- [ ] Cancel a lesson → it disappears on refresh.
- [ ] Rotate the token → old subscription 404s; re-subscribe with the new URL works.
- [ ] Install to home screen (Android/desktop) → opens standalone with the app icon; iOS Add-to-Home-Screen shows the apple-touch-icon.

---

## Acceptance Criteria
- [ ] All tasks completed.
- [ ] All validation commands pass.
- [ ] Tests written and passing (`tests/ical-feed.test.ts`).
- [ ] No type errors, no lint errors.
- [ ] `.ics` feed subscribable in Apple + Google; edits update without duplicates (PRD Phase-3 success signal).
- [ ] App installable as a PWA (manifest + icons + SW).

## Completion Checklist
- [ ] Code follows discovered patterns (table helpers, server-action shape, server-only reads).
- [ ] The **one** `forTenant` exception (public feed) is confined to `src/lib/ical-feed.ts`, scoped strictly by resolved `feed.tenantId`, and heavily commented (P3-2).
- [ ] Error handling matches codebase style (404 for bad token; Zod parse in actions).
- [ ] Stable, PK-derived UIDs; explicit `TZID=Asia/Shanghai` VTIMEZONE.
- [ ] Both lockfiles (`pnpm-lock.yaml` + `package-lock.json`) synced (PR #4 lesson).
- [ ] No `Notification.requestPermission()` call anywhere; install prompt never auto-fires (P3-10).
- [ ] No Dockerfile change needed (public/ already copied); no CJK-font work (that's Phase 4/5).
- [ ] Docs/PRD phase status updated to `in-progress` with this plan linked.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Duplicate events on every calendar refresh (unstable UID) | M | H | PK-derived `UID` (P3-5) + a dedicated stable-UID test; verify in real Apple/Google subscribe. |
| Feed served as download, not subscription | M | M | `Content-Type: text/calendar` + `Content-Disposition: inline` (P3-3); provide `webcal://` for one-tap subscribe. |
| Token leak exposes a tenant's schedule | L | M | 32-char unguessable token; rotate/revoke UI; feed is read-only, no PII beyond lesson titles/locations. Rotation invalidates immediately. |
| Missing VTIMEZONE → wrong times in client | M | H | `@touch4it/ical-timezones` generator wired into `cal.timezone` (P3-4); test asserts `TZID:Asia/Shanghai` + 16:00-local rendering. |
| Lockfile drift breaks Docker `npm ci` | M | H | Sync `package-lock.json` after `pnpm add` (Task 0) — exact repeat-guard for the PR #4 failure. |
| Chrome flags manifest for bad/missing icons | M | M | Ship real PNGs at declared sizes (Task 9); DevTools Manifest panel gate in validation. |
| `getOrCreateFeed` first-create race → two feed rows | L | L | Single-tutor usage makes it rare; `getActiveFeed` takes first row; Phase-7 partial unique index noted. |

## Notes
- **Parallel with Phase 4**: shared files are only `package.json`/lockfiles, `src/db/schema/index.ts`, and `drizzle/` migration numbering. If both phases run concurrently, coordinate migration filenames (`0002_` vs `0003_`) and barrel-export order to avoid merge conflicts. Phase 4's parent share tokens are a **separate** table + route + noindex page — no overlap with this calendar feed.
- **Why not `next-pwa`/Serwist**: they add a build-time plugin and a `webpack()` config; `next.config.ts` explicitly forbids a `webpack()` block ("Turbopack build fails if one is present"). A hand-written manifest + SW sidesteps that entirely (P3-9).
- **Single source of truth preserved**: this phase only *publishes* Postgres data outward; it never reads or trusts any external calendar (PRD architecture note).
- **Forward hooks**: `calendar_feed.teacherId` + the `label` column are stored now so Phase 7 (multi-teacher) can scope feeds per teacher without a migration; MVP ignores them (whole-tenant feed, P3-7).
```
