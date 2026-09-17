# Plan: Phase 7b — Reminders & Notifications

## Summary
Add an in-app **notification center** (persisted, reliable store) plus **best-effort PWA Web Push** to the course scheduler. Two notification producers: (1) an idempotent **course-reminder scan** (default 24h + 1h before each lesson) triggered by an in-box cron via a secret-gated `/api/cron/reminders` route, and (2) **reschedule-outcome notifications** emitted when a teacher approves/rejects a reschedule request. Recipients are the lesson's teacher and the enrolled students' linked portal users (parents/students), scoped by tenant and by `portalLink`.

## User Story
As a **parent/student**, I want to be reminded before my lesson and told the outcome of my reschedule request, so that I never miss or double-book a session.
As a **teacher**, I want the same reminders and reschedule-review confirmations in one place, so that my schedule and my families stay in sync without email/WeChat plumbing.

## Problem → Solution
**Current state:** No scheduler in the box (no `/api/cron`, no node-cron, no timers); `public/sw.js` handles only install/activate/fetch (empty pass-through, no `push`); reschedule approval silently moves the lesson with no notice to the family. Parents are frequently no-email WeChat placeholder accounts (`portal_*@portal.local`), so email can't reach them.
**Desired state:** A tenant-isolated `notification` table backs an in-app inbox at `/dashboard/notifications` and `/portal/notifications`; a protected cron route scans upcoming lessons and writes reminders idempotently; approving/rejecting a reschedule writes an outcome notification; every notification is *also* pushed via Web Push to any subscribed device (best-effort — the persisted inbox is the source of truth).

## Metadata
- **Complexity**: XL (new subsystem: DB tables + cron surface + web-push + notification center in two shells)
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: Phase 7b — Reminders & Notifications
- **Estimated Files**: ~28 (≈20 created, ≈8 modified)
- **Locked decisions** (from user):
  - Channel = **站内通知中心 (in-app center) + PWA 推送 (best-effort)**. No email/SMS/WeChat send in this phase.
  - Scope = **课前提醒 (lesson reminders) + 改期结果通知 (reschedule outcome)**, delivered to **both teacher and parents/students**.

---

## UX Design

### Before
```
Parent files reschedule → teacher approves → lesson silently moves.
Parent finds out only by re-opening the portal. No reminders ever.
Nav: [我的课表] [改期申请] [退出]
```

### After
```
Nav: [我的课表] [改期申请] [通知 •3] [退出]
                                   └ unread badge

/portal/notifications:
┌──────────────────────────────────────────────┐
│ 通知                         [全部标为已读]     │
│ ● 改期已通过  小明 · 数学 6/15 16:00  刚刚      │
│ ● 课前提醒    小明 · 数学 明天 10:00  1小时前   │
│   改期被拒绝  小红 · 英语            昨天        │
│ ─────────────────────────────────────────────  │
│ [🔔 启用推送通知]  ← user-gesture only          │
└──────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Reschedule approve/reject | silent | parent + teacher get an in-app notification (+ push) | Hook in reschedule cores |
| Upcoming lesson | nothing | 24h and 1h reminders to teacher + linked portal users | Cron scan, idempotent |
| Nav bar | 2 links | + `通知` link with unread badge | Both dashboard & portal shells |
| Device | SW installable only | opt-in Web Push after explicit tap | iOS requires installed PWA |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/reschedule-core.ts` | 1-124 | The core to hook; exact `(ctx,input)=>Result` + `forTenant` + discriminated-union idiom to mirror |
| P0 | `src/db/schema/reserved.ts` | 1-50 | Byte template for a new tenant table with composite FK + tenant-leading indexes |
| P0 | `src/db/schema/_helpers.ts` | 1-21 | `primaryId/tenantId/createdAt/updatedAt` — every column comes from here |
| P0 | `src/db/tenant.ts` | 1-55 | `forTenant(ctx)` is the ONLY sanctioned tenant path; `.insert/.update/.delete/.select/.findById` shapes |
| P0 | `src/auth/permissions.ts` | 1-90 | Where a `notification` resource + per-role grants must be declared |
| P0 | `src/app/dashboard/reschedule/{page,data,actions,review-panel}.tsx/ts` | all | The page→data→actions→panel quartet to clone for the notification center |
| P1 | `src/app/dashboard/schedule/data.ts` | 10-58 | Canonical time-window lesson scan + enrollment→student batch resolution (recipient logic) |
| P1 | `src/app/api/[transport]/route.ts` | 1-26 | `timingSafeEqual` constant-time secret gate to mirror for the cron route |
| P1 | `src/app/api/health/route.ts` | 1-6 | Route-handler shape (`runtime='nodejs'`, `dynamic='force-dynamic'`) |
| P1 | `src/env.ts` | 1-41 | `createEnv` recipe for `CRON_SECRET` + VAPID vars (mirror `MCP_BEARER_TOKEN`, line 16) |
| P1 | `public/sw.js` | 1-5 | Add `push` + `notificationclick`; currently none |
| P1 | `src/app/sw-register.tsx` | 1-40 | SW is registered; permission prompt deliberately NOT auto-fired (P3-10) — subscribe must be user-gesture |
| P1 | `src/auth/portal.ts` | 1-40 | `resolveLinkedStudentIds` / portal row-scope for parent/student notification reads |
| P1 | `tests/reschedule-core.test.ts` | 1-190 | The DB-integration test scaffold to clone (ctxFor, `at()`, cleanup-in-beforeAll+afterAll) |
| P2 | `src/db/schema/enums.ts` | 1-25 | Add `notificationType` pgEnum here |
| P2 | `src/db/schema/index.ts` | all | Register new schema files in the barrel (before `./relations`) |
| P2 | `src/app/dashboard/layout.tsx` / `src/app/portal/layout.tsx` | 15-47 | Add nav `<Link>` + unread badge; role gates |
| P2 | `src/lib/errors.ts` | 1-19 | `Error`-subclass + `.cause`-walk convention if a new domain error is needed |
| P2 | `next.config.ts`, `docker-compose.yml`, `Dockerfile` | relevant | `serverExternalPackages`, runtime env injection, `NEXT_PUBLIC_*` build ARG |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `web-push` (VAPID) | web-push npm README | `webpush.setVapidDetails(subject, pub, priv)` then `sendNotification(sub, JSON.stringify(payload))`; on **404/410** delete the stale subscription. Generate keys via `npx web-push generate-vapid-keys`. |
| Browser Push API | MDN PushManager | `reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey })`; `applicationServerKey` is the VAPID **public** key as a `Uint8Array` (base64url→bytes). |
| iOS Web Push | WebKit 16.4 notes | iOS delivers push ONLY to an **installed** (Add-to-Home-Screen) PWA — UX must nudge install before promising push. |
| Coolify Scheduled Tasks | README.md:67-72 | Prod already uses Coolify cron (Postgres S3 backup). Add a Scheduled Task on the App resource that `curl`s the loopback cron route. |

GOTCHA: `web-push` has a default export — `import webpush from 'web-push'`. If Turbopack mis-bundles it, add `'web-push'` to `serverExternalPackages` in `next.config.ts` (alongside `playwright`, `archiver`).

---

## Patterns to Mirror

### NEW_TENANT_TABLE
```ts
// SOURCE: src/db/schema/reserved.ts:15-50
export const rescheduleRequest = pgTable(
  'reschedule_request',
  {
    id: primaryId(),
    tenantId: tenantId(),
    lessonId: text('lesson_id').notNull(),
    studentId: text('student_id'),
    status: rescheduleStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.lessonId],
      foreignColumns: [lesson.tenantId, lesson.id],
      name: 'fk_reschedule_lesson',
    }).onDelete('cascade'),
    index('idx_reschedule_tenant_status').on(t.tenantId, t.status),
    index('idx_reschedule_tenant_lesson').on(t.tenantId, t.lessonId), // M7: covers the FK
  ],
)
```
Rules: columns start `id/tenantId`, end `createdAt/updatedAt`; FKs are **composite `(tenantId, fkId)`** with `onDelete('cascade')`; every index **leads with `tenantId`** and each FK gets a covering index. `userId` columns are **bare `text(...).notNull()` with NO FK** (Better-Auth owns `user`). Partial-unique idiom for idempotency: `uniqueIndex('uq_x').on(...).where(sql\`... is not null\`)` (see `enrollment.ts`).

### PGENUM_DECLARATION
```ts
// SOURCE: src/db/schema/enums.ts:5-20
export const lessonStatus = pgEnum('lesson_status', ['scheduled', 'completed', 'canceled'])
export const rescheduleStatus = pgEnum('reschedule_status', ['pending', 'approved', 'rejected', 'canceled'])
```

### CORE_CONTRACT
```ts
// SOURCE: src/lib/reschedule-core.ts:1-17, 82-124  &  src/lib/report-core.ts:1-45
import 'server-only'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
// Cores take a resolved ctx and do NOT call requireAuthContext / requirePermission / revalidatePath —
// those live in the thin Server Actions — so this stays headless-testable (like report-core).
export type Row = typeof someTable.$inferSelect
export async function doThingCore(ctx: AuthContext, input: Input): Promise<Result> {
  const row = (await forTenant(ctx).findById(someTable, id)) as Row | null
  if (!row) throw new Error('...不存在')            // hard failure → throw Error('中文')
  const [created] = (await forTenant(ctx).insert(someTable, { ...values })) as Row[]  // returns array; destructure
  return created
}
```

### THIN_SERVER_ACTION
```ts
// SOURCE: src/app/dashboard/reschedule/actions.ts:1-49
'use server'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
export type ActionResult = { ok: true; ... } | { ok: false; error: string }
export async function doThing(id: string): Promise<ActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { notification: ['update'] })
  try {
    const res = await doThingCore(ctx, id)
    revalidatePath('/dashboard/notifications')
    return { ok: true, ... }
  } catch (e) {
    console.error('doThing failed', e)          // errors returned as DATA, never thrown (Next redacts #441)
    return { ok: false, error: e instanceof Error ? e.message : '操作失败' }
  }
}
```

### DATA_LOADER
```ts
// SOURCE: src/app/dashboard/reschedule/data.ts:1-58
import 'server-only'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
export interface NotificationRow {         // serializable — every Date is string | null
  id: string; type: string; title: string; body: string | null
  url: string | null; readAt: string | null; createdAt: string | null
}
// takes ctx, does NOT self-gate (the page owns requireAuthContext + requirePermission)
export async function listNotifications(ctx: AuthContext): Promise<NotificationRow[]> {
  const rows = (await forTenant(ctx).select(notification, eq(notification.userId, ctx.userId))) as (typeof notification.$inferSelect)[]
  return rows
    .map((r) => ({ ...r, createdAt: r.createdAt ? r.createdAt.toISOString() : null, readAt: r.readAt ? r.readAt.toISOString() : null }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}
```

### PAGE_SERVER_COMPONENT
```ts
// SOURCE: src/app/dashboard/reschedule/page.tsx:1-21
export default async function NotificationsPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { notification: ['list'] })
  const items = await listNotifications(ctx)
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">通知</h2>
      <NotificationPanel items={items} />
    </section>
  )
}
```

### CLIENT_PANEL
```tsx
// SOURCE: src/app/dashboard/reschedule/review-panel.tsx:1-70
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
export default function NotificationPanel({ items }: { items: NotificationRow[] }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  function markRead(id: string) {
    startTransition(async () => {
      const res = await markNotificationRead(id)
      if (!res.ok) return
      router.refresh()
    })
  }
  // ...
}
```

### TIME_WINDOW_SCAN + RECIPIENT_RESOLUTION
```ts
// SOURCE: src/app/dashboard/schedule/data.ts:10-58
const rows = (await forTenant(ctx).select(
  lesson,
  and(gte(lesson.startAt, from), lt(lesson.startAt, to), eq(lesson.status, 'scheduled')),
)) as (typeof lesson.$inferSelect)[]
if (rows.length === 0) return []
const sectionIds = [...new Set(rows.map((r) => r.sectionId))]
const enrolls = (await forTenant(ctx).select(
  enrollment,
  and(inArray(enrollment.sectionId, sectionIds), eq(enrollment.status, 'active')),
)) as (typeof enrollment.$inferSelect)[]   // GOTCHA: inArray([]) is invalid SQL — guard empty
```

### CONSTANT_TIME_SECRET_GATE
```ts
// SOURCE: src/app/api/[transport]/route.ts:17-26
import { timingSafeEqual } from 'node:crypto'
const expected = env.CRON_SECRET
if (!expected || !provided) return unauthorized()
const a = Buffer.from(provided); const b = Buffer.from(expected)
if (a.length !== b.length || !timingSafeEqual(a, b)) return unauthorized()  // length guard: timingSafeEqual throws on mismatch
```

### ENV_ADD
```ts
// SOURCE: src/env.ts:4-41
server: {
  MCP_BEARER_TOKEN: z.string().min(32).optional(), // static bearer; generate: openssl rand -base64 48
  // ADD:
  CRON_SECRET: z.string().min(32).optional(),
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default('mailto:admin@example.com'),
},
client: {
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),  // inlined at build; hides the subscribe button when unset
},
experimental__runtimeEnv: {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
},
```

### TEST_SCAFFOLD
```ts
// SOURCE: tests/reschedule-core.test.ts:25-130
const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({ tenantId, userId, role, isPlatformAdmin: false })
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 5, 15, h, m))
beforeAll(async () => { await cleanup(); /* seed org/user/member with createdAt:new Date(); seed feature rows via forTenant(ctx).insert */ })
afterAll(cleanup)  // cleanup deletes children→parents by tenantId; unique suite namespace (org='org_notify_7b')
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/schema/enums.ts` | UPDATE | Add `notificationType` pgEnum |
| `src/db/schema/notification.ts` | CREATE | In-app notification store (tenant table) |
| `src/db/schema/push-subscription.ts` | CREATE | Persisted Web Push subscriptions (tenant table, bare userId) |
| `src/db/schema/index.ts` | UPDATE | Register both new schema files in the barrel |
| `drizzle/NNNN_*.sql` | GENERATE | `pnpm db:generate` output for the two tables + enum |
| `src/auth/permissions.ts` | UPDATE | Add `notification` resource + per-role grants |
| `src/lib/notification-core.ts` | CREATE | create / list / markRead / markAllRead + recipient resolution + `notifyRescheduleOutcome` |
| `src/lib/reminder-core.ts` | CREATE | Idempotent upcoming-lesson scan → notifications (per tenant ctx) |
| `src/lib/push-core.ts` | CREATE | Best-effort `web-push` adapter (send + prune stale subs) |
| `src/lib/reschedule-core.ts` | UPDATE | Emit outcome notifications on approve/reject |
| `src/app/api/cron/reminders/route.ts` | CREATE | Secret-gated cron: iterate tenants → reminder scan → push |
| `public/sw.js` | UPDATE | Add `push` + `notificationclick` handlers |
| `src/lib/push-client.ts` | CREATE | `urlBase64ToUint8Array` + subscribe/unsubscribe browser helpers |
| `src/app/dashboard/notifications/{page,data,actions}.tsx/ts` + `notification-panel.tsx` | CREATE | Staff notification center |
| `src/app/portal/notifications/{page,data,actions}.tsx/ts` + `notification-panel.tsx` | CREATE | Parent/student notification center |
| `src/components/push-subscribe-button.tsx` | CREATE | User-gesture push opt-in (shared by both panels) |
| `src/app/dashboard/layout.tsx` | UPDATE | Nav `<Link>` + unread badge |
| `src/app/portal/layout.tsx` | UPDATE | Nav `<Link>` + unread badge |
| `src/env.ts` | UPDATE | `CRON_SECRET`, VAPID vars |
| `next.config.ts` | UPDATE | `serverExternalPackages: [..., 'web-push']` |
| `docker-compose.yml` | UPDATE | Inject `CRON_SECRET`/VAPID server env + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` build arg |
| `Dockerfile` | UPDATE | `ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY` (mirror `NEXT_PUBLIC_APP_URL` M5) |
| `.env.example` | UPDATE | Document new vars |
| `README.md` | UPDATE | Coolify Scheduled Task + VAPID key generation notes |
| `package.json` | UPDATE | Add `web-push` + `@types/web-push` |
| `tests/notification-core.test.ts` | CREATE | create/list/markRead + tenant isolation + portal scope |
| `tests/reminder-core.test.ts` | CREATE | window scan, recipients, idempotency, status exclusion |
| `tests/reschedule-notify.test.ts` | CREATE | approve/reject emits notifications |

## NOT Building
- **No email / SMS / WeChat send.** Channel is in-app + Web Push only (user decision). The `notification` row IS the reliable delivery; push is best-effort.
- **No node-cron / in-process timer.** Trigger is an external Coolify Scheduled Task hitting the protected route (in-process timers die/duplicate on redeploy).
- **No per-user reminder preferences UI / quiet hours / snooze.** Fixed offsets (24h + 1h). A `REMINDER_OFFSETS` constant makes this trivially extensible later.
- **No read receipts across devices, no notification pagination/archival.** Single-tutor scale — load all, sort in memory (matches existing data.ts).
- **No distributed lock.** Single Coolify instance; idempotency is enforced by a dedupe key, not a lock.
- **No Google Calendar / two-way sync** (that is Phase 7d).
- **No changes to the reschedule *request* flow** beyond emitting outcome notifications.

---

## Step-by-Step Tasks

### Task 1: Declare the `notificationType` enum
- **ACTION**: Add one `pgEnum` line to `src/db/schema/enums.ts`.
- **IMPLEMENT**: `export const notificationType = pgEnum('notification_type', ['lesson_reminder', 'reschedule_approved', 'reschedule_rejected'])`
- **MIRROR**: PGENUM_DECLARATION (enums.ts:5-20).
- **IMPORTS**: none new (`pgEnum` already imported).
- **GOTCHA**: Declare all values up-front (reserved-enum style) so migrations stay stable. snake_case enum name.
- **VALIDATE**: `pnpm typecheck` compiles.

### Task 2: Create the `notification` table
- **ACTION**: Create `src/db/schema/notification.ts`.
- **IMPLEMENT**:
  ```ts
  import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
  import { sql } from 'drizzle-orm'
  import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
  import { notificationType } from './enums'
  import { lesson } from './lesson'
  import { student } from './student'

  export const notification = pgTable(
    'notification',
    {
      id: primaryId(),
      tenantId: tenantId(),
      userId: text('user_id').notNull(),          // recipient = Better Auth user.id — bare text, NO FK
      type: notificationType('type').notNull(),
      title: text('title').notNull(),
      body: text('body'),
      url: text('url'),                            // deep link for notificationclick
      lessonId: text('lesson_id'),
      studentId: text('student_id'),
      dedupeKey: text('dedupe_key'),               // idempotency for reminders; null for one-shot events
      readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      // Idempotent reminder dispatch: at most one row per (tenant, dedupeKey) when set.
      uniqueIndex('uq_notification_dedupe').on(t.tenantId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
      foreignKey({ columns: [t.tenantId, t.lessonId], foreignColumns: [lesson.tenantId, lesson.id], name: 'fk_notification_lesson' }).onDelete('cascade'),
      foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_notification_student' }).onDelete('cascade'),
      index('idx_notification_tenant_user').on(t.tenantId, t.userId),
      index('idx_notification_tenant_user_read').on(t.tenantId, t.userId, t.readAt), // unread queries
      index('idx_notification_tenant_lesson').on(t.tenantId, t.lessonId),            // M7: covers fk_notification_lesson
      index('idx_notification_tenant_student').on(t.tenantId, t.studentId),          // M7: covers fk_notification_student
    ],
  )
  ```
- **MIRROR**: NEW_TENANT_TABLE (reserved.ts:15-50), partial-unique from `enrollment.ts`.
- **IMPORTS**: as above; `sql` from `drizzle-orm` for the partial-unique predicate.
- **GOTCHA**: `onDelete('cascade')` (NOT `'set null'`) — a composite FK's `SET NULL` would try to null `tenant_id` (NOT NULL) and fail at delete time. Cascade matches `reschedule_request`. `userId` has NO FK (auth-owned). `lesson`/`student` both already expose `uq_<t>_tenant_id`, so the composite FK targets resolve.
- **VALIDATE**: appears in `pnpm db:generate` diff (after Task 4).

### Task 3: Create the `push_subscription` table
- **ACTION**: Create `src/db/schema/push-subscription.ts`.
- **IMPLEMENT**:
  ```ts
  import { pgTable, text, index, uniqueIndex } from 'drizzle-orm/pg-core'
  import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'

  export const pushSubscription = pgTable(
    'push_subscription',
    {
      id: primaryId(),
      tenantId: tenantId(),
      userId: text('user_id').notNull(),   // Better Auth user.id — bare text, NO FK
      endpoint: text('endpoint').notNull(),
      p256dh: text('p256dh').notNull(),
      auth: text('auth').notNull(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [
      uniqueIndex('uq_push_sub_tenant_endpoint').on(t.tenantId, t.endpoint), // one row per browser endpoint
      index('idx_push_sub_tenant_user').on(t.tenantId, t.userId),           // "subs for this user"
    ],
  )
  ```
- **MIRROR**: `portal-link.ts` (bare `userId`, no FK; tenant-leading indexes).
- **IMPORTS**: as above.
- **GOTCHA**: No FK anywhere (both `userId` and the push endpoint are external identifiers). `endpoint` is long — `text`, not `varchar`.
- **VALIDATE**: appears in `pnpm db:generate` diff.

### Task 4: Register schema files + generate migration
- **ACTION**: Add `export * from './notification'` and `export * from './push-subscription'` to `src/db/schema/index.ts` (with the other domain tables, BEFORE the `./relations` and `../auth-schema` lines). Then run `pnpm db:generate`.
- **IMPLEMENT**: barrel edits; then `pnpm db:generate` → review `drizzle/NNNN_*.sql` (new enum type + 2 tables + FKs + indexes).
- **MIRROR**: barrel ordering (index.ts:1-15).
- **IMPORTS**: n/a.
- **GOTCHA**: The barrel is the ONLY schema `drizzle.config.ts` reads — an unregistered file is silently omitted from migrations. Do NOT hand-write SQL; eyeball the generated file only. Do NOT add a `relations.ts` entry (not needed — no `db.query` relational joins).
- **VALIDATE**: `pnpm db:generate` emits exactly one new migration containing `notification_type`, `notification`, `push_subscription`; `git diff` shows no edits to unrelated tables.

### Task 5: Add the `notification` permission resource
- **ACTION**: Edit `src/auth/permissions.ts`.
- **IMPLEMENT**: In `statement` (after the `...orgDefaults` spread): `notification: ['read', 'list', 'update'] as const`. Grant `notification: ['read', 'list', 'update']` inside every role block: `owner`, `admin`, `teacher`, `assistant`, `parent`, `student_role`. (Reminders are *created* by the system cron/cores, not via a user verb — no `create`/`send` verb needed; keep the resource read/list + `update` for mark-read.)
- **MIRROR**: how `report` / `rescheduleRequest` were declared (permissions.ts:14-75).
- **IMPORTS**: n/a.
- **GOTCHA**: `requirePermission` only accepts declared statements — the resource must be in BOTH `statement` and each `ac.newRole({...})` or the pages won't typecheck/authorize. Keep new resource AFTER the `...orgDefaults` spread. Parent/student get their OWN notifications only — the row-scope (`userId === ctx.userId`) is enforced in the data/core layer, not by the verb.
- **VALIDATE**: `pnpm typecheck`; `requirePermission(ctx, { notification: ['list'] })` typechecks.

### Task 6: Notification core (create / list / mark-read + recipient resolution)
- **ACTION**: Create `src/lib/notification-core.ts`.
- **IMPLEMENT**:
  - `export type Notification = typeof notification.$inferSelect`
  - `export interface CreateNotificationInput { userId: string; type: NotificationType; title: string; body?: string | null; url?: string | null; lessonId?: string | null; studentId?: string | null; dedupeKey?: string | null }`
  - `createNotificationCore(ctx, input): Promise<Notification | null>` — `forTenant(ctx).insert(notification, {...})`; if `dedupeKey` set, **pre-check** existence (`forTenant(ctx).select(notification, and(eq(type), eq(dedupeKey)))`) and return `null` when already present; wrap the insert in try/catch and return `null` on unique-violation (SQLSTATE `23505`) as the race backstop. Returns the created row (or null when deduped).
  - `listNotificationsForUserCore(ctx): Promise<Notification[]>` — `forTenant(ctx).select(notification, eq(notification.userId, ctx.userId))`.
  - `unreadCountForUserCore(ctx): Promise<number>` — same filter + `isNull(notification.readAt)`, return `.length`.
  - `markNotificationReadCore(ctx, id): Promise<Notification>` — `findById`; if `null` or `row.userId !== ctx.userId` → `throw new Error('通知不存在')` (defense: a user may only mark their OWN); `forTenant(ctx).update(notification, id, { readAt: new Date() })`.
  - `markAllReadCore(ctx): Promise<number>` — select unread for `ctx.userId`, update each (single-tutor scale), return count.
  - `resolveLessonRecipientsCore(ctx, lesson): Promise<string[]>` — teacher (`lesson.teacherId`) ∪ portal users of the lesson's active enrollments: `enrollment(sectionId, active)` → studentIds → `forTenant(ctx).select(portalLink, inArray(studentId, ids))` → userIds. Dedupe via `[...new Set(...)]`, drop falsy. **Guard empty `inArray`.**
  - `notifyRescheduleOutcomeCore(ctx, req, lesson, outcome: 'approved'|'rejected'): Promise<void>` — build title/body (Chinese), recipients = `[req.requestedById, lesson.teacherId]` (dedupe, drop null), `createNotificationCore` for each (type `reschedule_${outcome}`, `url` pointing at the notification center), then best-effort `sendPushToUserCore` (Task 8) per recipient wrapped so it never throws.
- **MIRROR**: CORE_CONTRACT (reschedule-core/report-core), RECIPIENT_RESOLUTION (schedule/data.ts:41-58).
- **IMPORTS**: `import 'server-only'`; `and, eq, inArray, isNull` from `drizzle-orm`; `forTenant` from `@/db/tenant`; `notification, enrollment, portalLink` and `lesson` type from `@/db/schema`; `AuthContext` type; `sendPushToUserCore` from `@/lib/push-core`.
- **GOTCHA**: Core does NOT call `requireAuthContext`/`requirePermission`/`revalidatePath`. `forTenant.insert/update` return ARRAYS — destructure `[row]`. `findById` returns row-or-null. Push must be best-effort — never let a push failure abort the DB write (`try { await sendPush } catch {}`). `inArray([])` is invalid SQL — early-return `[]`/skip.
- **VALIDATE**: `tests/notification-core.test.ts` (Task 15) green; `pnpm typecheck`.

### Task 7: Reminder scan core
- **ACTION**: Create `src/lib/reminder-core.ts`.
- **IMPLEMENT**:
  - `export const REMINDER_OFFSETS = [{ label: '24h', minutes: 24 * 60 }, { label: '1h', minutes: 60 }] as const`
  - `runReminderScanCore(ctx, now = new Date()): Promise<{ created: number }>`:
    - For each offset: window `from = now`, `to = new Date(now.getTime() + minutes*60000)`; select lessons `and(gt(lesson.startAt, from), lte(lesson.startAt, to), eq(lesson.status, 'scheduled'))`.
    - For each due lesson: `recipients = resolveLessonRecipientsCore(ctx, lesson)`; for each recipient build `dedupeKey = \`reminder:${lesson.id}:${label}:${userId}\`` and `createNotificationCore(ctx, { userId, type: 'lesson_reminder', title, body (Asia/Shanghai formatted time), url, lessonId, dedupeKey })`. Collect the non-null created rows; fire best-effort push for each. Count creations.
  - Returns `{ created }`.
- **MIRROR**: TIME_WINDOW_SCAN (schedule/data.ts:10-58); Asia/Shanghai formatting via Luxon `DateTime.fromJSDate(startAt).setZone('Asia/Shanghai')` (see `ical-feed.ts` ZONE usage).
- **IMPORTS**: `import 'server-only'`; `and, eq, gt, lte` from `drizzle-orm`; `forTenant`; `lesson` from `@/db/schema`; `createNotificationCore, resolveLessonRecipientsCore` from `@/lib/notification-core`; `sendPushToUserCore` from `@/lib/push-core`; `DateTime` from `luxon`.
- **GOTCHA**: `dedupeKey` per (lesson, offset, user) makes re-runs idempotent — a lesson entering both windows at once may get both reminders (acceptable). Use `gt`/`lte` (exclusive lower, inclusive upper) deliberately so a lesson isn't reminded twice at a boundary. Accepts explicit `now` so tests pass a fixed instant (no fake timers — codebase convention).
- **VALIDATE**: `tests/reminder-core.test.ts` (Task 15) green.

### Task 8: Web Push adapter core
- **ACTION**: Add `web-push` dep, create `src/lib/push-core.ts`.
- **IMPLEMENT**:
  - `pnpm add web-push && pnpm add -D @types/web-push`
  - ```ts
    import 'server-only'
    import webpush from 'web-push'
    import { eq } from 'drizzle-orm'
    import { env } from '@/env'
    import { forTenant } from '@/db/tenant'
    import { pushSubscription } from '@/db/schema'
    import type { AuthContext } from '@/auth/context'

    export interface PushPayload { title: string; body?: string; url?: string }
    function pushConfigured(): boolean { return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) }

    export async function sendPushToUserCore(ctx: AuthContext, userId: string, payload: PushPayload): Promise<void> {
      if (!pushConfigured()) return                      // best-effort no-op when unconfigured
      webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
      const subs = (await forTenant(ctx).select(pushSubscription, eq(pushSubscription.userId, userId))) as (typeof pushSubscription.$inferSelect)[]
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload))
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode
          if (code === 404 || code === 410) await forTenant(ctx).delete(pushSubscription, s.id) // prune stale
        }
      }
    }
    export async function saveSubscriptionCore(ctx, input): Promise<void> { /* dedupe by endpoint: delete existing (tenant,endpoint) then insert via forTenant */ }
    export async function removeSubscriptionCore(ctx, endpoint): Promise<void> { /* delete where userId===ctx.userId && endpoint */ }
    ```
- **MIRROR**: CORE_CONTRACT; `forTenant(ctx).delete` shape (tenant.ts).
- **IMPORTS**: as above.
- **GOTCHA**: Guard `pushConfigured()` first — the app must run with VAPID unset (optional env). Prune subscriptions ONLY on 404/410 (gone), not on transient 5xx. `saveSubscriptionCore` must dedupe by `(tenant, endpoint)` (the unique index) — delete-then-insert or catch `23505`. `forTenant.delete` needs `(table, id)`; to delete by endpoint, `select` then delete by id.
- **VALIDATE**: `pnpm typecheck`; in tests `vi.mock('web-push', ...)` so no network.

### Task 9: Hook reschedule cores to emit notifications
- **ACTION**: Edit `src/lib/reschedule-core.ts`.
- **IMPLEMENT**: In `approveRescheduleRequestCore`, after the successful `forTenant(ctx).update(rescheduleRequest, ...)` (status `approved`), load the moved lesson (`forTenant(ctx).findById(lesson, req.lessonId)`) and `await notifyRescheduleOutcomeCore(ctx, updated, movedLesson, 'approved')` — wrapped in `try/catch` (a notification failure must NOT roll back the approval). Same in `rejectRescheduleRequestCore` with `'rejected'` (no lesson move — use `req.lessonId` lesson for context).
- **MIRROR**: existing core body (reschedule-core.ts:82-124).
- **IMPORTS**: `notifyRescheduleOutcomeCore` from `@/lib/notification-core`.
- **GOTCHA**: Notifications are a side effect — never let them throw out of the core and undo the state change (`try { await notify } catch (e) { console.error('notify failed', e) }`). Import direction: `reschedule-core` → `notification-core` (notification-core must NOT import reschedule-core → avoid a cycle).
- **VALIDATE**: `tests/reschedule-notify.test.ts` (Task 15) green; existing `tests/reschedule-core.test.ts` still green.

### Task 10: Protected cron route
- **ACTION**: Create `src/app/api/cron/reminders/route.ts`.
- **IMPLEMENT**:
  ```ts
  export const runtime = 'nodejs'
  export const dynamic = 'force-dynamic'
  export async function POST(req: Request) {
    const provided = req.headers.get('x-cron-secret') ?? undefined
    const expected = env.CRON_SECRET
    if (!expected || !provided) return Response.json({ ok: false }, { status: 401 })
    const a = Buffer.from(provided); const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ ok: false }, { status: 401 })
    const now = new Date()
    const orgs = await db.select({ id: organization.id }).from(organization)  // org IS the tenant list — raw read is legitimate (not a tenant table)
    let created = 0
    for (const o of orgs) {
      const ctx: AuthContext = { userId: 'system', tenantId: o.id, role: 'owner', isPlatformAdmin: false }
      try { created += (await runReminderScanCore(ctx, now)).created } catch (e) { console.error('reminder scan failed', o.id, e) }
    }
    return Response.json({ ok: true, created })
  }
  ```
- **MIRROR**: CONSTANT_TIME_SECRET_GATE ([transport]/route.ts), health/route.ts exports.
- **IMPORTS**: `timingSafeEqual` from `node:crypto`; `env`; `db` from `@/db`; `organization` from `@/db/schema`; `runReminderScanCore`; `AuthContext` type.
- **GOTCHA**: Reading `organization` via raw `db` is legitimate — it is auth-owned, NOT a tenant table, and it IS the tenant enumeration; every subsequent tenant-table read goes through `forTenant(synthesizedCtx)`. Per-tenant `try/catch` so one bad tenant doesn't abort the batch. `runtime='nodejs'` required (postgres.js + server-only). Return `Response`, never a redirect. Keep the length guard before `timingSafeEqual`.
- **VALIDATE**: `pnpm typecheck`; `curl -X POST -H 'x-cron-secret: <secret>' :3000/api/cron/reminders` returns `{ok:true,created:N}`; wrong/absent secret → 401.

### Task 11: Service worker push handlers + client helpers
- **ACTION**: Edit `public/sw.js`; create `src/lib/push-client.ts`.
- **IMPLEMENT**:
  - `public/sw.js` — append:
    ```js
    self.addEventListener('push', (event) => {
      let data = {}
      try { data = event.data ? event.data.json() : {} } catch (_) {}
      event.waitUntil(self.registration.showNotification(data.title || '课程通知', {
        body: data.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url || '/' },
      }))
    })
    self.addEventListener('notificationclick', (event) => {
      event.notification.close()
      const url = (event.notification.data && event.notification.data.url) || '/'
      event.waitUntil(self.clients.openWindow(url))
    })
    ```
  - `src/lib/push-client.ts` — `urlBase64ToUint8Array(base64)` + `async function subscribeToPush(): Promise<PushSubscriptionJSON | null>` (checks `Notification`/`serviceWorker` support, `await navigator.serviceWorker.ready`, `Notification.requestPermission()`, `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, returns `sub.toJSON()`) and `unsubscribeFromPush()`.
- **MIRROR**: sw.js header comment reserves this for Phase 7; sw-register.tsx (user-gesture rule).
- **IMPORTS**: client helper reads `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- **GOTCHA**: `sw.js` MUST stay at origin root (`public/sw.js`) to control scope. Do NOT auto-fire `Notification.requestPermission()` — only inside the subscribe helper called from a click (P3-10). If `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is empty, `subscribeToPush` returns `null` (button hidden). `push-client.ts` is browser-only (no `server-only`).
- **VALIDATE**: `pnpm build` (SW is static); manual: tapping enable → permission prompt → subscription persisted.

### Task 12: Push subscribe/unsubscribe actions + button
- **ACTION**: Create `src/components/push-subscribe-button.tsx` and a shared `'use server'` actions module (e.g. `src/app/push-actions.ts`).
- **IMPLEMENT**:
  - Actions (`'use server'`): `subscribeToPushAction(sub: PushSubscriptionJSON)` → `requireAuthContext` → `requirePermission(ctx, { notification: ['read'] })` → validate `endpoint`/`keys` present → `saveSubscriptionCore(ctx, { endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })` → `{ ok: true }` / `{ ok: false, error }`. `unsubscribeFromPushAction(endpoint)` similarly → `removeSubscriptionCore`.
  - `push-subscribe-button.tsx` (`'use client'`): if `!NEXT_PUBLIC_VAPID_PUBLIC_KEY` render nothing; button `🔔 启用推送通知` → `startTransition(async () => { const sub = await subscribeToPush(); if (sub) await subscribeToPushAction(sub) })`; reflect permission state.
- **MIRROR**: THIN_SERVER_ACTION; CLIENT_PANEL (useTransition).
- **IMPORTS**: core fns; browser helpers from `push-client`.
- **GOTCHA**: Actions return errors as DATA. Gate with `notification:['read']` (any recipient may register their own device). The button is user-gesture only.
- **VALIDATE**: `pnpm typecheck`; subscribing inserts a `push_subscription` row scoped to `ctx.tenantId`/`ctx.userId`.

### Task 13: Dashboard notification center
- **ACTION**: Create `src/app/dashboard/notifications/{page.tsx,data.ts,actions.ts,notification-panel.tsx}`; edit `src/app/dashboard/layout.tsx`.
- **IMPLEMENT**:
  - `data.ts` (`'server-only'`): `NotificationRow` (Dates→ISO) + `listNotifications(ctx)` = `listNotificationsForUserCore(ctx)` mapped/serialized/sorted desc by `createdAt`.
  - `actions.ts` (`'use server'`): `markNotificationRead(id)` and `markAllNotificationsRead()` → gate `notification:['update']` → core → `revalidatePath('/dashboard/notifications')` → `{ ok }`.
  - `page.tsx`: gate `notification:['list']` → `listNotifications` → render `<NotificationPanel items={...} />` + `<PushSubscribeButton />`.
  - `notification-panel.tsx` (`'use client'`): list rows (unread dot when `readAt===null`), per-row 标为已读, header 全部标为已读; `startTransition` → action → `router.refresh()`.
  - `layout.tsx`: add `<Link href="/dashboard/notifications">通知{unread ? ` •${unread}` : ''}</Link>`; compute `unread` via `unreadCountForUserCore(ctx)` (layout already holds `ctx`).
- **MIRROR**: PAGE_SERVER_COMPONENT, DATA_LOADER, CLIENT_PANEL, nav Link (layout.tsx:15-45).
- **IMPORTS**: as per patterns.
- **GOTCHA**: Two-layer auth — page/action each re-gate; the layout gate is UX-only. Dates serialized in data.ts. Chinese UI copy. Badge count is cheap but recomputed on every dashboard render — acceptable at single-tutor scale; `revalidatePath` after mark-read refreshes it.
- **VALIDATE**: `pnpm build`; `/dashboard/notifications` renders; mark-read clears the dot + decrements the badge.

### Task 14: Portal notification center
- **ACTION**: Create `src/app/portal/notifications/{page.tsx,data.ts,actions.ts,notification-panel.tsx}`; edit `src/app/portal/layout.tsx`.
- **IMPLEMENT**: Same quartet as Task 13 but `revalidatePath('/portal/notifications')` and nav `<Link href="/portal/notifications">`. Loader/core already filter by `userId === ctx.userId`, so a parent sees ONLY their own notifications (which were created for their `portalLink.userId`).
- **MIRROR**: Task 13; `src/app/portal/page.tsx` gating; portal layout nav (layout.tsx:15-47).
- **IMPORTS**: as per patterns.
- **GOTCHA**: Portal children only render after consent (`{needsConsent ? <ConsentGate/> : children}`) — inherited automatically. Row scope is `userId`-based; no extra `resolveLinkedStudentIds` needed because notifications are addressed to a `userId` directly (the linkage happened at creation time via `resolveLessonRecipientsCore`). Still gate with `requirePermission` + the `userId` filter.
- **VALIDATE**: `pnpm build`; parent account sees only own rows; cross-account isolation holds (Task 15 asserts).

### Task 15: Tests (DB-integration, real Postgres)
- **ACTION**: Create `tests/notification-core.test.ts`, `tests/reminder-core.test.ts`, `tests/reschedule-notify.test.ts`.
- **IMPLEMENT**:
  - `notification-core.test.ts`: seed org/user/member (with `createdAt`), a `parentUser`; create notifications via `createNotificationCore`; assert list/order, `markNotificationReadCore` sets `readAt`, `markNotificationReadCore` on another user's row throws `通知不存在`, dedupe (same `dedupeKey` twice → second returns `null`, only one row), and cross-tenant isolation (`otherCtx` sees none).
  - `reminder-core.test.ts`: seed course/section/student/enrollment(active)/portalLink + a teacher member; seed lessons at `at(now+90m)` (in 24h & 1h windows) and `at(now+30h)` (neither), plus a `canceled` lesson; run `runReminderScanCore(ctx, fixedNow)`; assert notifications created for teacher + parent, correct types/dedupeKeys, canceled/out-of-window excluded; run scan **again** → `created===0` (idempotent). `vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async()=>{}) } }))`.
  - `reschedule-notify.test.ts`: seed like `reschedule-core.test.ts`; approve a request → assert a `reschedule_approved` notification exists for `requestedById` (+ teacher); reject another → `reschedule_rejected`. Mock `web-push`.
- **MIRROR**: TEST_SCAFFOLD (reschedule-core.test.ts); LLM-mock pattern (report-db.test.ts:22-28) applied to `web-push`.
- **IMPORTS**: `db` from `@/db`, `forTenant`, cores, schema tables, `AuthContext` type, `vi/describe/it/expect/beforeAll/afterAll` from `vitest`.
- **GOTCHA**: Real Postgres required (`docker compose up -d postgres` + `pnpm db:migrate`). Namespace ids `org_notify_7b` / `org_reminder_7b` / `org_resnotify_7b` to avoid collision with ~10 suites sharing the DB. `cleanup()` deletes `notification`/`push_subscription`/`reschedule_request` children before parents, in beforeAll AND afterAll. Base tables need `createdAt: new Date()`. Pass a fixed `now` to the scan (no fake timers). Mock `web-push` (default export shape).
- **VALIDATE**: `pnpm exec vitest run tests/notification-core.test.ts tests/reminder-core.test.ts tests/reschedule-notify.test.ts` green.

### Task 16: Env, build, deployment wiring
- **ACTION**: Edit `src/env.ts`, `next.config.ts`, `docker-compose.yml`, `Dockerfile`, `.env.example`, `README.md`.
- **IMPLEMENT**:
  - `src/env.ts`: ENV_ADD block (server `CRON_SECRET`/VAPID_*; client `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; wire `experimental__runtimeEnv`).
  - `next.config.ts`: `serverExternalPackages: ['playwright', 'archiver', 'web-push']`.
  - `docker-compose.yml`: add `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` to `environment:` (empty defaults keep them optional); add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` as a build `args:` (mirror `NEXT_PUBLIC_APP_URL`).
  - `Dockerfile`: `ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the build stage (mirror the M5 `NEXT_PUBLIC_APP_URL` note).
  - `.env.example`: document all five vars + `npx web-push generate-vapid-keys`.
  - `README.md`: Coolify Scheduled Task (`*/5 * * * *` → `curl -fsS -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/reminders`) + VAPID setup + iOS-install caveat.
- **MIRROR**: ENV_ADD (env.ts:4-41); `NEXT_PUBLIC_APP_URL` build-arg flow; README Coolify section (67-72).
- **IMPORTS**: n/a.
- **GOTCHA**: `NEXT_PUBLIC_*` is inlined at `next build` — MUST be a Docker build ARG, not just runtime env, or the browser gets an empty `applicationServerKey` and `subscribe()` throws. Standalone server does NOT read `.env` at runtime — server vars come via container `environment:`/Coolify secrets. All new server vars are `.optional()` so the image builds and boots without them (`skipValidation` during build).
- **VALIDATE**: `pnpm build` succeeds with vars unset; `pnpm check` clean.

---

## Testing Strategy

### Unit / Integration Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| create + list | 2 notifications for user A | list returns 2, newest first | |
| mark read | own notification id | `readAt` set; unread count −1 | |
| mark read — foreign | user B marks A's notification | throws `通知不存在` | ✔ ownership |
| dedupe | same `dedupeKey` twice | 2nd returns `null`; exactly 1 row | ✔ idempotency |
| tenant isolation | `otherCtx.select(notification)` | empty; foreign mark-read throws | ✔ M1 |
| reminder window | lesson +90m, +30h, canceled | reminders only for +90m (24h+1h), teacher+parent | ✔ window/status |
| reminder rerun | scan twice, same `now` | 2nd run `created===0` | ✔ idempotency |
| reschedule approve | approve a pending request | `reschedule_approved` for requester (+teacher) | |
| reschedule reject | reject a pending request | `reschedule_rejected` for requester | |
| push send | mocked `web-push`, 410 response | stale subscription row deleted | ✔ prune |

### Edge Cases Checklist
- [ ] Empty active-enrollment set → `inArray([])` guarded (no reminder, no crash)
- [ ] Lesson with `teacherId === null` → recipient set drops falsy
- [ ] VAPID unset → `sendPushToUserCore` no-ops; notification still written
- [ ] `CRON_SECRET` unset or mismatched header → route 401
- [ ] Concurrent/overlapping cron runs → dedupeKey prevents double-send
- [ ] Parent is a `portal_*@portal.local` no-email account → in-app + push still reach them (no email dependency)
- [ ] Cross-tenant: synthesized system ctx only touches its own tenant's rows

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck
```
EXPECT: Zero type errors

### Lint
```bash
pnpm lint
```
EXPECT: Zero errors

### Database
```bash
pnpm db:generate   # emits drizzle/NNNN_*.sql for notification_type + notification + push_subscription
docker compose up -d postgres && pnpm db:migrate
```
EXPECT: One new migration; applies cleanly

### Unit Tests
```bash
pnpm exec vitest run tests/notification-core.test.ts tests/reminder-core.test.ts tests/reschedule-notify.test.ts
```
EXPECT: All green (Postgres up + migrated first)

### Full Suite
```bash
pnpm test
```
EXPECT: No regressions (existing reschedule/report/tenant suites still pass)

### Build
```bash
pnpm build
```
EXPECT: Standalone build succeeds with new vars unset

### Manual
- [ ] `curl -X POST -H 'x-cron-secret: <secret>' localhost:3000/api/cron/reminders` → `{ok:true,created:N}`; wrong secret → 401
- [ ] `/dashboard/notifications` and `/portal/notifications` render; nav badge shows unread count; 标为已读 works
- [ ] Tap 启用推送通知 → permission prompt → `push_subscription` row created
- [ ] Approve a reschedule → parent's portal notification appears

---

## Acceptance Criteria
- [ ] `notification` + `push_subscription` tables migrated; all reads/writes via `forTenant(ctx)`
- [ ] `notification` permission resource declared + granted to every role
- [ ] Cron route scans upcoming lessons and writes 24h/1h reminders idempotently to teacher + linked portal users
- [ ] Approve/reject reschedule emits an outcome notification to requester + teacher
- [ ] In-app center works in both `/dashboard` and `/portal` with unread badge + mark-read
- [ ] Web Push is best-effort (VAPID optional); the in-app row is always written
- [ ] Tenant + portal isolation enforced (a user sees only their own notifications)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` pass; new tests green; no regressions

## Completion Checklist
- [ ] Cores headless (no `requireAuthContext`/`requirePermission`/`revalidatePath` inside)
- [ ] Errors: cores throw `Error('中文')`; actions return `{ ok:false, error }`
- [ ] Dates serialized to ISO in every `data.ts`
- [ ] New table files registered in the barrel; migration generated (not hand-written)
- [ ] Web-push failures never abort a notification write
- [ ] Chinese UI copy throughout; nav entries match existing styling
- [ ] No raw `db` on tenant tables (only `organization` enumeration in the cron route)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tests need a live Postgres unavailable in CI/agent env | High | Med | Typecheck + lint + build gate regardless; tests written to run when Postgres is up; document prereq |
| `web-push` mis-bundled by Turbopack (standalone) | Med | Med | Add to `serverExternalPackages`; adapter is isolated + best-effort |
| Composite-FK `SET NULL` pitfall | Low | High | Use `onDelete('cascade')` (not `set null`) — verified against the NOT-NULL tenant_id constraint |
| Double-send on overlapping cron runs | Med | Med | `dedupeKey` unique index + pre-check; single Coolify instance |
| iOS push only for installed PWA | Med | Low | In-app center is primary; README documents install-first UX |
| Import cycle reschedule-core ↔ notification-core | Med | Med | One-way import: reschedule-core → notification-core only |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` missing at build | Med | Low | Optional client var; button hidden when empty; documented as build ARG |

## Notes
- **Cron principal**: the route enumerates `organization` (auth-owned, legitimately raw-readable) and synthesizes `{ userId:'system', tenantId, role:'owner', isPlatformAdmin:false }` per tenant so every tenant-table read stays on the `forTenant` spine — matches the exploration recommendation and avoids a new cross-tenant raw read.
- **Why in-app is the source of truth**: parents are often no-email WeChat placeholder accounts (`portal_*@portal.local`); the persisted `notification` row guarantees delivery independent of push permission/device state.
- **Extensibility**: `REMINDER_OFFSETS` is a single constant; adding a channel later means a new adapter + a `notificationChannel` enum, without touching producers.
- Exploration source: 8-reader workflow `wf_90ebe404-998` (recovered from journal) covering schema, test harness, notification-center UI, tenant/RBAC, lesson-window queries, deployment/cron/PWA, and the core+action+data+page architecture.
