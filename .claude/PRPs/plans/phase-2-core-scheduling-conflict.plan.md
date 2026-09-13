# Plan: Phase 2 — Core Scheduling + Conflict（MVP 核心）

## Summary

Build the scheduling core on top of the Phase-1 foundation: full CRUD for Course（模板）/ClassSection（学期实例）/Student/Enrollment, a **recurrence materializer** that expands each section's stored `RRULE` into concrete per-occurrence `lesson` rows (idempotent, edit-preserving), **real-time conflict detection** on save (teacher double-booking blocked, with available-slot suggestions, backed by a Postgres GiST exclusion constraint as the hard invariant), a **responsive FullCalendar UI** (week/day/month, drag-to-create/move, `zh-cn`, mobile-friendly), and **attendance + class-notes** entry per lesson. This is the phase that lets the tutor manage students, courses, and lessons end-to-end on desktop and phone — and never double-book.

## User Story

As **the independent tutor**, I want **to schedule one-off and recurring lessons for my students and small groups in one app that automatically blocks time conflicts and works on my phone**, so that **I never accidentally double-book, I can edit a single occurrence of a weekly class without touching the rest, and I can record who showed up and what happened in each lesson.**

## Problem → Solution

**Current state**: The app has auth, multi-tenancy, the full domain schema, and one example guarded mutation (`students/actions.ts` create/list). There is **no UI beyond a bare dashboard**, no course/section/lesson management, no recurrence expansion, no conflict detection, and no attendance/notes capture.
**Desired state**: The tutor logs in → creates a Course + a ClassSection with a weekly recurrence → the system materializes the term's lessons → a responsive calendar shows them → dragging/creating a lesson that overlaps an existing teacher lesson is **rejected with suggested free slots** → single occurrences can be moved/canceled without disturbing the series → attendance and notes are recorded per lesson. All scoped to the tenant, all authorized in the data layer.

## Metadata

- **Complexity**: **Large** (~28–32 files: schema migration + 3 lib modules + ~5 action modules + ~10 UI files + tests; new deps: `rrule`, `luxon`, `@fullcalendar/*`)
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: Phase 2 — Core Scheduling + Conflict (`pending` → `in-progress`)
- **Depends on**: Phase 1 — Foundation & Deploy (**complete**)
- **Estimated Files**: ~30 (mostly `CREATE`; a few `UPDATE` to `students/actions.ts`, `package.json`, `drizzle/`)
- **Research basis**: 4-question external research (rrule / calendar libs / GiST exclusion / date-tz), versions verified 2026-09. See **External Documentation**.

---

## Reconciliation Decisions (READ FIRST — binding choices for implementation)

The Phase-1 schema already locked in the *shape* (RRULE fields on `class_section`, conflict indexes + `uq_lesson_section_slot` on `lesson`, `is_exception`/`original_start_at`). These decisions resolve the *how*:

| # | Decision | Chosen | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| P2-1 | **Recurrence engine** | `rrule@2.8.1` (`rrulestr` + `RRuleSet.between()`) as a pure **enumerator**; `luxon@3.7.2` owns all zone conversion | rrule's own `tzid` output; hand-rolled date math | rrule's tzid Dates carry local wall-clock in a UTC-stamped Date (a notorious footgun); treating rrule as floating-time enumerator + Luxon for `Asia/Shanghai`→UTC is correct and simple |
| P2-2 | **Timezone model** | Store `lesson.start_at/end_at` as `timestamptz` (UTC instants). Convert wall-clock↔UTC with Luxon at the boundary. `Asia/Shanghai` = **fixed UTC+8, no DST since 1991** | per-app offset juggling | China has no DST → the whole DST-boundary bug class is eliminated; still use Luxon so future non-CN zones stay correct |
| P2-3 | **Conflict enforcement** | **Two layers**: (1) app-level pre-check query returning conflicts + slot suggestions (good UX); (2) a Postgres **GiST `EXCLUDE` constraint** as the atomic hard backstop (concurrency-safe) | app-check only; DB-only | App check gives friendly messages + suggestions; the GiST constraint guarantees the invariant even under concurrent writes / code that forgets to check (defense in depth, matches PRD "conflict → 0") |
| P2-4 | **Overlap semantics** | `tstzrange(start_at, end_at, '[)')` half-open + `&&` | closed ranges | Back-to-back lessons (one ends 10:00, next starts 10:00) must NOT count as a conflict |
| P2-5 | **Conflict scope (MVP)** | **Teacher** double-booking (`tenant_id` + `teacher_id`). Room/location conflict is a **soft warning only** (not blocking) | block on room too | The tutor is the sole teacher; room is often home/online. Block the thing that actually hurts (teacher), warn on room. `idx_lesson_room_time` exists for the warning query |
| P2-6 | **Calendar component** | `@fullcalendar/react@7.1.0` + `daygrid`/`timegrid`/`interaction` plugins (all **MIT**), `zh-cn` locale, `timeZone: 'Asia/Shanghai'` | Schedule-X (drag/resize are **paid**); react-big-calendar | FullCalendar's interaction plugin (drag-create/move/resize) is free/MIT, mature `zh-cn`, responsive, React-19 peer. Must be a `'use client'` component fed by a Server Component |
| P2-7 | **Materialization trigger** | Materialize on section **create/update** across the term window `[termStartDate, termEndDate]` (fallback horizon +16 weeks if term end is null). Idempotent upsert `ON CONFLICT (uq_lesson_section_slot) DO NOTHING` — **never clobber** existing rows | a cron job; lazy on-read | Section counts are tiny (≤ a few dozen occurrences); synchronous materialization is simplest and matches the Phase-1 note. A cron materializer is a Phase-7 concern |
| P2-8 | **Single-occurrence semantics** | **Edit one** = update that lesson row + set `is_exception=true`. **Delete/skip one** = set `status='canceled'` (tombstone, keep the row) so re-materialization can't resurrect it. **Edit series** = update `class_section.rrule` then re-materialize (adds new future slots; existing rows preserved) | hard-delete a single occurrence | Hard-deleting a materialized slot lets the next materialize re-create it. A canceled tombstone preserves the `original_start_at` slot per `uq_lesson_section_slot` |
| P2-9 | **RBAC mapping for new writes** | Reuse Phase-1 statements — **attendance & notes → `lesson`** perms; **enrollment (roster) → `course`** perms; section CRUD → `course` perms | add new `attendance`/`note`/`enrollment` AC statements | Avoids expanding the role matrix mid-phase; the mapping is intuitive (recording attendance = editing a lesson; managing a roster = editing a course/section). Documented so Phase-7 can split later if needed |
| P2-10 | **Numeric/duration units** | Durations in **minutes** (`integer`); all instants UTC `Date`. `grade.score` stays out of scope (Phase 5) | — | Consistent with `defaultDurationMinutes` already in schema |

---

## UX Design

### Before
```
┌───────────────────────────────────────────────┐
│ /dashboard → shows tenantId + role text only.  │
│ No way to add a student/course/lesson in the UI.│
│ (students/actions.ts exists but no page uses it)│
└───────────────────────────────────────────────┘
```

### After
```
┌──────────────────────────────────────────────────────────────┐
│ /dashboard/schedule   ← responsive FullCalendar (week on phone) │
│   • drag on empty grid → "新建课节" dialog (course/section/time) │
│   • drag an event → reschedule; overlap w/ teacher → BLOCKED     │
│     toast "与「高一数学·周一班」冲突，可用时段：14:00, 16:30…"      │
│   • click event → detail drawer: 出勤 (present/absent/late/…) +  │
│     课堂笔记, 移到别的时间, 取消这一节 / 取消整个系列              │
│ /dashboard/students   ← list + create/edit/archive              │
│ /dashboard/courses    ← courses + their sections (recurrence)   │
│   • section form: 每周几 + 上课时间 + 时长 + 学期起止 → builds RRULE│
│     → "生成课节" materializes the term's lessons                  │
└──────────────────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Add student | code only | `/dashboard/students` form (中文 name, 家长微信, 年级) | extends existing `createStudent` |
| Create recurring class | none | course → section w/ weekly recurrence → materialize | RRULE built from a simple weekday+time form |
| Schedule a lesson | none | drag-to-create or form; **conflict-blocked** | teacher overlap → reject + suggest slots |
| Move one occurrence | none | drag event → updates that row, `is_exception=true` | series untouched |
| Cancel one occurrence | none | "取消这一节" → `status='canceled'` tombstone | re-materialize won't resurrect it |
| Record attendance/notes | none | lesson detail drawer | per-student attendance + free-text notes |
| Mobile | dashboard text | full scheduling on phone (timeGrid week/day) | PRD hard requirement |

---

## Mandatory Reading

| Priority | Source | Lines | Why |
|---|---|---|---|
| **P0** | This plan's **Patterns to Mirror** + **Reconciliation Decisions** | all | The authoritative code + conventions to copy |
| **P0** | `src/db/tenant.ts` | 1-55 | `forTenant(ctx)` is the **only** sanctioned data path; `.select(t, extra)` takes an `extra` SQL — that's how conflict overlap SQL is passed |
| **P0** | `src/app/(dashboard)/students/actions.ts` | 1-36 | The canonical **verify→authorize→validate→scope** guarded-mutation shape every action mirrors |
| **P0** | `src/auth/authorize.ts` + `src/auth/context.ts` | all | `requireAuthContext()` + `requirePermission(ctx, {...})`; `AuthError` codes |
| **P0** | `src/db/schema/lesson.ts` | 1-53 | Conflict indexes, `uq_lesson_section_slot(tenant_id, section_id, original_start_at)`, `is_exception`, `original_start_at`, `ck_lesson_time_order` |
| **P0** | `src/db/schema/course.ts` | 1-67 | `course` (template) vs `class_section` (term instance) + RRULE fields (`rrule`, `recurrence_dtstart`, `recurrence_timezone`, `default_duration_minutes`, capacity 1–15 check) |
| **P1** | `src/db/schema/{enrollment,attendance,note,student}.ts` | all | M2M enrollment (`uq_enrollment_student_section` partial on `status='active'`), attendance upsert index, note fanout FKs |
| **P1** | `src/auth/permissions.ts` | 14-70 | `statement` + role matrix; which role can create/update lesson/course/student (P2-9 reuse) |
| **P1** | `tests/tenant-isolation.test.ts` + `vitest.config.ts` | all | Test harness: real Postgres, `ctxFor()` helper, `server-only` stub, idempotent cleanup, fixtures must supply `created_at` for auth tables |
| **P1** | `drizzle.config.ts` + `scripts/migrate.ts` (referenced) | all | `generate`+`migrate` flow; custom SQL migration goes in `./drizzle` and is tracked in `meta/_journal.json` |
| **P2** | `.claude/PRPs/plans/completed/phase-1-foundation-deploy.plan.md` §Notes (lines ~1231) | — | Explains the materialized-instance model + the recommended GiST constraint (this plan implements it) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `rrule` v2.8.1 | npmjs.com/package/rrule, github.com/jkbrzt/rrule | `rrulestr('RRULE:FREQ=WEEKLY;BYDAY=MO', { dtstart })`; expand a window with `RRuleSet.between(after, before, true)`. **Do NOT trust rrule's `tzid` Date output** (holds wall-clock in a UTC-stamped Date). Use rrule as a floating-time enumerator; let Luxon apply the zone |
| Luxon 3.7.2 | moment.github.io/luxon | `DateTime.fromObject({year,month,day,hour,minute}, { zone: 'Asia/Shanghai' }).toUTC().toJSDate()` converts wall-clock→UTC instant for `timestamptz`. `Asia/Shanghai` fixed +08:00 (no DST since 1991) |
| FullCalendar React 7.1.0 | fullcalendar.io/docs | MIT `@fullcalendar/react` + `@fullcalendar/daygrid` + `@fullcalendar/timegrid` + `@fullcalendar/interaction` (drag-create/move/resize **free**). `locale={zhCnLocale}` from `@fullcalendar/core/locales/zh-cn`. `timeZone='Asia/Shanghai'`. **Client component only** (touches DOM) — pin `initialDate`/`now` to avoid hydration mismatch; import its CSS |
| Postgres GiST `EXCLUDE` + `btree_gist` | postgresql.org/docs/current/rangetypes.html | `CREATE EXTENSION btree_gist` required to mix `text WITH =` and `tstzrange WITH &&`. NULL `teacher_id` rows are exempt (NULLs never `=`). Partial `WHERE (status <> 'canceled')` drops canceled rows. Drizzle has no `EXCLUDE` builder → ship as a **custom raw SQL migration**. Violation raises SQLSTATE `23P01` |
| Next 16 async APIs (from Phase 1) | Next.js 16 docs | `await headers()`, `await params`, `await searchParams`; Server Actions files are public endpoints — re-auth inside each export |

> No further external research needed during implementation — versions and APIs are captured here.

---

## Patterns to Mirror

Copy-pasteable, adjusted per P2-1…P2-10. All server modules start with `import 'server-only'` unless they are `'use server'` (actions) or `'use client'` (UI).

### GUARDED_MUTATION  (verify → authorize → validate → scope — the required shape for EVERY action)
```typescript
// SOURCE: src/app/(dashboard)/students/actions.ts  (existing — mirror this exactly)
'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'

const createStudentSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(100),
  parentWechat: z.string().trim().max(100).optional(),
  schoolGrade: z.string().trim().max(50).optional(),
})
export async function createStudent(input: z.input<typeof createStudentSchema>) {
  const ctx = await requireAuthContext()          // 1) verified principal + tenant (ignore client orgId)
  requirePermission(ctx, { student: ['create'] }) // 2) RBAC guard at the top
  const data = createStudentSchema.parse(input)    // 3) validate + trim BEFORE persisting
  const [row] = await forTenant(ctx).insert(student, { name: data.name, /* ... */ })
  revalidatePath('/dashboard/students')            // 4) tenant-scoped write; tenantId injected from ctx
  return row
}
```

### TENANT_SCOPED_OVERLAP_QUERY  (how conflict detection uses `forTenant().select(t, extra)`)
```typescript
// The forTenant.select() second arg is an `extra?: SQL` ANDed onto the tenant scope.
// Pass a composite condition built from and()/eq()/ne()/sql`` to run the overlap query
// WITHOUT ever bypassing tenant isolation.
import { and, eq, ne, sql } from 'drizzle-orm'
import { lesson } from '@/db/schema'

const overlaps = sql`tstzrange(${lesson.startAt}, ${lesson.endAt}, '[)') && tstzrange(${startAt}, ${endAt}, '[)')`
const extra = and(
  eq(lesson.teacherId, teacherId),
  ne(lesson.status, 'canceled'),
  excludeLessonId ? ne(lesson.id, excludeLessonId) : undefined, // ignore self on reschedule
  overlaps,
)
const conflicts = await forTenant(ctx).select(lesson, extra) // still tenant-scoped
```

### RRULE_EXPANSION  (rrule as floating enumerator + Luxon for the zone — P2-1/P2-2)
```typescript
// SOURCE: src/lib/recurrence.ts  (server-only; PURE — no DB access, unit-testable)
import 'server-only'
import { rrulestr } from 'rrule'
import { DateTime } from 'luxon'

export interface Occurrence {
  startAt: Date          // UTC instant for timestamptz
  endAt: Date            // UTC instant
  originalStartAt: Date  // === startAt at materialization time (the RECURRENCE-ID slot key)
}

/**
 * Expand a section's RRULE into concrete UTC occurrences within [windowStart, windowEnd].
 * `rruleText` is an RFC5545 RRULE line WITHOUT DTSTART (as stored). `wallStart` carries the
 * local wall-clock hour/minute of the first occurrence; `zone` is IANA (default Asia/Shanghai).
 */
export function expandRecurrence(params: {
  rruleText: string
  wallStart: { year: number; month: number; day: number; hour: number; minute: number }
  zone: string
  durationMinutes: number
  windowStart: Date
  windowEnd: Date
}): Occurrence[] {
  const { rruleText, wallStart, zone, durationMinutes, windowStart, windowEnd } = params
  // Enumerate in FLOATING time: dtstart is a naive Date carrying the wall-clock components.
  const dtstart = new Date(Date.UTC(
    wallStart.year, wallStart.month - 1, wallStart.day, wallStart.hour, wallStart.minute,
  ))
  const rule = rrulestr(rruleText.startsWith('RRULE:') ? rruleText : `RRULE:${rruleText}`, { dtstart })

  // Convert the query window (UTC instants) into the same floating space for between().
  const toFloating = (d: Date) => {
    const z = DateTime.fromJSDate(d).setZone(zone)
    return new Date(Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second))
  }
  return rule
    .between(toFloating(windowStart), toFloating(windowEnd), true)
    .map((floating) => {
      // Reinterpret the floating wall-clock as `zone`, then to a real UTC instant.
      const local = DateTime.fromObject(
        {
          year: floating.getUTCFullYear(), month: floating.getUTCMonth() + 1, day: floating.getUTCDate(),
          hour: floating.getUTCHours(), minute: floating.getUTCMinutes(),
        },
        { zone },
      )
      const startAt = local.toUTC().toJSDate()
      const endAt = local.plus({ minutes: durationMinutes }).toUTC().toJSDate()
      return { startAt, endAt, originalStartAt: startAt }
    })
}
```

### CONFLICT_DETECTION  (app-level pre-check + slot suggestion — P2-3/P2-5)
```typescript
// SOURCE: src/lib/conflict.ts  (server-only; uses forTenant so it stays tenant-scoped)
import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { forTenant } from '@/db/tenant'
import { lesson } from '@/db/schema'
import type { AuthContext } from '@/auth/context'

export interface ConflictCheck {
  hasConflict: boolean
  conflicts: { id: string; title: string | null; startAt: Date; endAt: Date }[]
  suggestions: Date[] // free start times same day, same duration (Asia/Shanghai wall-clock)
}

export async function checkTeacherConflict(
  ctx: AuthContext,
  args: { teacherId: string; startAt: Date; endAt: Date; excludeLessonId?: string },
): Promise<ConflictCheck> {
  const { teacherId, startAt, endAt, excludeLessonId } = args
  const overlaps = sql`tstzrange(${lesson.startAt}, ${lesson.endAt}, '[)') && tstzrange(${startAt}, ${endAt}, '[)')`
  const rows = await forTenant(ctx).select(
    lesson,
    and(
      eq(lesson.teacherId, teacherId),
      ne(lesson.status, 'canceled'),
      excludeLessonId ? ne(lesson.id, excludeLessonId) : undefined,
      overlaps,
    ),
  )
  const conflicts = rows.map((r) => ({ id: r.id, title: r.title, startAt: r.startAt, endAt: r.endAt }))
  const suggestions = conflicts.length
    ? await suggestFreeSlots(ctx, { teacherId, startAt, endAt })
    : []
  return { hasConflict: conflicts.length > 0, conflicts, suggestions }
}

// Scan the SAME calendar day (Asia/Shanghai) in 30-min steps for the first N gaps that fit.
async function suggestFreeSlots(
  ctx: AuthContext,
  args: { teacherId: string; startAt: Date; endAt: Date },
): Promise<Date[]> {
  const zone = 'Asia/Shanghai'
  const durationMs = args.endAt.getTime() - args.startAt.getTime()
  const day = DateTime.fromJSDate(args.startAt).setZone(zone)
  const dayStart = day.set({ hour: 8, minute: 0, second: 0, millisecond: 0 })   // 08:00 local
  const dayEnd = day.set({ hour: 21, minute: 0, second: 0, millisecond: 0 })    // 21:00 local
  const busy = await forTenant(ctx).select(
    lesson,
    and(
      eq(lesson.teacherId, args.teacherId),
      ne(lesson.status, 'canceled'),
      sql`${lesson.startAt} >= ${dayStart.toUTC().toJSDate()} and ${lesson.startAt} < ${dayEnd.toUTC().toJSDate()}`,
    ),
  )
  const out: Date[] = []
  for (let t = dayStart; t.plus({ millisecond: durationMs }) <= dayEnd && out.length < 3; t = t.plus({ minutes: 30 })) {
    const s = t.toUTC().toJSDate()
    const e = t.plus({ millisecond: durationMs }).toUTC().toJSDate()
    const clash = busy.some((b) => b.startAt < e && s < b.endAt) // half-open overlap
    if (!clash) out.push(s)
  }
  return out
}
```

### GIST_EXCLUSION_MIGRATION  (the atomic hard backstop — P2-3/P2-4)
```sql
-- SOURCE: drizzle/NNNN_lesson_teacher_exclusion.sql  (CUSTOM migration — Drizzle has no EXCLUDE builder)
-- Generate an empty numbered migration with `drizzle-kit generate --custom --name lesson_teacher_exclusion`
-- then paste this in. It is tracked in drizzle/meta/_journal.json like any other migration.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "lesson"
  ADD CONSTRAINT "lesson_no_teacher_overlap"
  EXCLUDE USING gist (
    "tenant_id"  WITH =,
    "teacher_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE (status <> 'canceled');
-- NOTE: rows with NULL teacher_id are exempt (NULL never = NULL) — always denormalize section.teacherId
-- onto lesson.teacherId at materialization so recurring lessons are covered. '[)' lets back-to-back touch.
```

### EXCLUSION_VIOLATION_HANDLING  (catch 23P01 as the last line of defense)
```typescript
// SOURCE: src/lib/errors.ts
// When an insert/update slips past the app pre-check (race, or a code path that forgot to check),
// the GiST constraint raises SQLSTATE 23P01. Translate it into a domain error.
export class ConflictError extends Error {
  constructor(public detail = '时间冲突') { super('CONFLICT'); this.name = 'ConflictError' }
}
export function isExclusionViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23P01'
}
// usage:
// try { await forTenant(ctx).insert(lesson, values) }
// catch (e) { if (isExclusionViolation(e)) throw new ConflictError(); throw e }
```

### MATERIALIZER  (idempotent, edit-preserving — P2-7/P2-8)
```typescript
// SOURCE: src/lib/materialize.ts  (server-only)
import 'server-only'
import { db } from '@/db'
import { lesson, classSection } from '@/db/schema'
import { expandRecurrence } from './recurrence'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'

// Expand section.rrule across the term window and INSERT missing lesson rows only.
// ON CONFLICT (uq_lesson_section_slot) DO NOTHING → never touches manually-edited / canceled rows.
export async function materializeSection(ctx: AuthContext, sectionId: string): Promise<number> {
  const section = await forTenant(ctx).findById(classSection, sectionId)
  if (!section || !section.rrule || !section.recurrenceDtstart) return 0
  const zone = section.recurrenceTimezone ?? 'Asia/Shanghai'
  const duration = section.defaultDurationMinutes ?? 60
  const windowStart = section.termStartDate ?? section.recurrenceDtstart
  const windowEnd = section.termEndDate ?? new Date(windowStart.getTime() + 16 * 7 * 864e5) // +16 weeks fallback
  // derive wall-clock parts of recurrenceDtstart in the section's zone (Luxon), then expand:
  const occurrences = expandRecurrence({
    rruleText: section.rrule,
    /* wallStart: DateTime.fromJSDate(section.recurrenceDtstart).setZone(zone) → {year,month,day,hour,minute} */
    zone, durationMinutes: duration, windowStart, windowEnd,
  } as never)
  if (!occurrences.length) return 0
  const rows = occurrences.map((o) => ({
    tenantId: ctx.tenantId, sectionId: section.id, teacherId: section.teacherId, // denormalize teacher for conflict/GiST
    startAt: o.startAt, endAt: o.endAt, originalStartAt: o.originalStartAt, status: 'scheduled' as const,
  }))
  const res = await db.insert(lesson).values(rows)
    .onConflictDoNothing({ target: [lesson.tenantId, lesson.sectionId, lesson.originalStartAt] })
    .returning({ id: lesson.id })
  return res.length
}
```

### CALENDAR_UI  (Server Component fetch → Client FullCalendar — P2-6)
```typescript
// SOURCE: src/app/(dashboard)/schedule/page.tsx  (Server Component — fetch + authorize, pass props)
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { listLessonsInRange } from './data'
import ScheduleCalendar from './calendar'

export default async function SchedulePage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['list'] })
  const events = await listLessonsInRange(ctx /* default: current month */)
  return <ScheduleCalendar initialEvents={events} />
}
```
```tsx
// SOURCE: src/app/(dashboard)/schedule/calendar.tsx  ('use client' — FullCalendar, drag+conflict)
'use client'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import zhCn from '@fullcalendar/core/locales/zh-cn'
import { useState, useTransition } from 'react'
import { createLessonAction, rescheduleLessonAction } from './actions'

export default function ScheduleCalendar({ initialEvents }: { initialEvents: CalendarEvent[] }) {
  const [events, setEvents] = useState(initialEvents)
  const [, startTransition] = useTransition()
  return (
    <FullCalendar
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      locale={zhCn}
      timeZone="Asia/Shanghai"
      initialDate={initialEvents[0]?.start /* pin to avoid hydration mismatch */}
      headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
      selectable editable
      events={events}
      select={(info) => startTransition(async () => {
        const res = await createLessonAction({ startAt: info.start, endAt: info.end /* + section/teacher */ })
        if (!res.ok && res.error === 'CONFLICT') alert(`时间冲突，可用时段：${res.suggestions.join('、')}`)
        else if (res.ok) setEvents((prev) => [...prev, res.event])
      })}
      eventDrop={(info) => startTransition(async () => {
        const res = await rescheduleLessonAction({ id: info.event.id, startAt: info.event.start!, endAt: info.event.end! })
        if (!res.ok && res.error === 'CONFLICT') { info.revert(); alert(`时间冲突，可用时段：${res.suggestions.join('、')}`) }
      })}
    />
  )
}
```

### ACTION_RESULT_SHAPE  (actions return a discriminated result — conflict is NOT an exception at the UI boundary)
```typescript
// Conflict is an expected outcome, so scheduling actions return a typed result the client can branch on.
export type ScheduleResult =
  | { ok: true; event: CalendarEvent }
  | { ok: false; error: 'CONFLICT'; conflicts: ConflictSummary[]; suggestions: string[] } // suggestions: 'HH:mm' local
// (UNAUTHENTICATED/FORBIDDEN/validation still throw — those are bugs/attacks, not user-recoverable UX.)
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` | UPDATE | add `rrule@2.8.1`, `luxon@3.7.2`, `@fullcalendar/react@7.1.0`, `@fullcalendar/core`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`; dev `@types/luxon` |
| `drizzle/NNNN_lesson_teacher_exclusion.sql` | CREATE | custom migration: `btree_gist` + GiST `EXCLUDE` constraint (P2-3) |
| `drizzle/meta/_journal.json` + snapshot | UPDATE (generated) | `drizzle-kit generate --custom` bookkeeping |
| `src/lib/recurrence.ts` | CREATE | pure RRULE→UTC occurrence expander (P2-1) |
| `src/lib/conflict.ts` | CREATE | teacher-overlap check + free-slot suggestion (P2-3/P2-5) |
| `src/lib/materialize.ts` | CREATE | idempotent section→lessons materializer (P2-7) |
| `src/lib/errors.ts` | CREATE | `ConflictError` + `isExclusionViolation` (23P01) |
| `src/lib/rrule-build.ts` | CREATE | build an RRULE string from a weekday+time form (UI helper, pure) |
| `src/app/(dashboard)/students/actions.ts` | UPDATE | add `updateStudent`, `archiveStudent`, `getStudent` (mirror existing shape) |
| `src/app/(dashboard)/students/page.tsx` + `student-form.tsx` | CREATE | list + create/edit UI |
| `src/app/(dashboard)/courses/actions.ts` | CREATE | course + section CRUD + `materializeSectionAction` |
| `src/app/(dashboard)/courses/page.tsx` + `section-form.tsx` | CREATE | course/section management + recurrence form |
| `src/app/(dashboard)/schedule/actions.ts` | CREATE | `createLessonAction`, `rescheduleLessonAction`, `cancelLessonAction`, `cancelSeriesAction` (conflict-checked) |
| `src/app/(dashboard)/schedule/data.ts` | CREATE | `listLessonsInRange(ctx, range)` → CalendarEvent[] (server-only read) |
| `src/app/(dashboard)/schedule/page.tsx` | CREATE | Server Component: fetch + authorize + render calendar |
| `src/app/(dashboard)/schedule/calendar.tsx` | CREATE | `'use client'` FullCalendar (drag-create/move) |
| `src/app/(dashboard)/schedule/lesson-detail.tsx` | CREATE | `'use client'` drawer: attendance + notes + move/cancel |
| `src/app/(dashboard)/schedule/enrollment-actions.ts` | CREATE | enroll/unenroll student ↔ section (P2-9 → `course` perms) |
| `src/app/(dashboard)/schedule/attendance-actions.ts` | CREATE | upsert attendance + add note (P2-9 → `lesson` perms) |
| `src/app/(dashboard)/layout.tsx` | UPDATE | add nav links (排课 / 学生 / 课程) |
| `tests/recurrence.test.ts` | CREATE | pure expansion unit tests (no DB) |
| `tests/conflict.test.ts` | CREATE | overlap detection + GiST constraint (real Postgres) |
| `tests/materialize.test.ts` | CREATE | idempotency + edit-preservation (real Postgres) |
| `tests/rbac-scheduling.test.ts` | CREATE | role matrix for new writes (P2-9) |

## NOT Building

- **`.ics`/webcal feeds, PWA/manifest** — Phase 3 (this phase produces the lesson data they publish).
- **Parent sharing / PNG / PDF / share links** — Phase 4.
- **AI-drafted progress reports** — Phase 5.
- **MCP connector tools** (`schedule_lesson`, etc.) — Phase 6 (they will call the same `src/lib/*` functions built here — keep scheduling logic in `src/lib`, not inside the actions, so Phase 6 can reuse it).
- **Reschedule-request approval workflow, parent/student login, reminders, two-way sync, payments** — Phase 7.
- **Room/resource double-booking as a hard block** — soft warning only in MVP (P2-5).
- **Grades entry UI** — schema exists; UI is Phase 5's concern (`grade.score` returns as string).
- **Recurrence exceptions via EXDATE/RDATE on the RRULE itself** — single-occurrence edits are modeled as `lesson` rows (`is_exception`/canceled tombstone), NOT by mutating the RRULE string.

---

## Step-by-Step Tasks

### Task 1 — Dependencies + GiST exclusion migration
- **ACTION**: Install the new deps; add and apply the custom GiST migration.
- **IMPLEMENT**: `pnpm add rrule@2.8.1 luxon@3.7.2 @fullcalendar/react@7.1.0 @fullcalendar/core @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction` and `pnpm add -D @types/luxon`. Then `pnpm drizzle-kit generate --custom --name lesson_teacher_exclusion`, paste `GIST_EXCLUSION_MIGRATION` into the emitted `drizzle/NNNN_lesson_teacher_exclusion.sql`, and run `pnpm db:migrate`.
- **MIRROR**: `GIST_EXCLUSION_MIGRATION`.
- **IMPORTS**: n/a (CLI + SQL).
- **GOTCHA**: FullCalendar 7 packages must all be the **same version line**. `@types/luxon` is dev-only. The migration must run against a Postgres where `lesson` already exists (Phase-1 migration applied first). If `status` comparison errors, cast `'canceled'::lesson_status`. Keep the constraint name stable — later phases reference it.
- **VALIDATE**: `pnpm db:migrate` succeeds; `psql "$DATABASE_URL" -c "\d lesson"` shows `lesson_no_teacher_overlap` EXCLUDE + `btree_gist` in `\dx`. `pnpm typecheck` clean.

### Task 2 — Recurrence expander (`src/lib/recurrence.ts`) + RRULE builder (`src/lib/rrule-build.ts`)
- **ACTION**: Implement the pure RRULE→UTC occurrence expander and the form→RRULE string builder.
- **IMPLEMENT**: `expandRecurrence(...)` exactly per `RRULE_EXPANSION`. `rrule-build.ts`: `buildWeeklyRrule({ byDays: ('MO'|'TU'|...)[], until?: Date, count?: number }) => string` producing e.g. `FREQ=WEEKLY;BYDAY=MO,WE`.
- **MIRROR**: `RRULE_EXPANSION`.
- **IMPORTS**: `rrule` (`rrulestr`, `RRule` for `RRule.MO` weekday constants if needed), `luxon` (`DateTime`), `server-only`.
- **GOTCHA**: Treat rrule output as **floating** wall-clock — read with `getUTC*` getters, never local getters (P2-1). Convert to a real instant with `DateTime.fromObject(parts, { zone }).toUTC()`. `between()` needs the window mapped into the same floating space. Store the RRULE **without** a `DTSTART` line (schema keeps `recurrence_dtstart` separately). Cap total occurrences (e.g. reject `count > 500` / windows > 2 years) to avoid runaway expansion.
- **VALIDATE**: `tests/recurrence.test.ts` (Task 9) — weekly-Monday over a 4-week window yields 4 occurrences at the correct `Asia/Shanghai` local hour; a `count=3` rule yields exactly 3.

### Task 3 — Conflict detection + errors (`src/lib/conflict.ts`, `src/lib/errors.ts`)
- **ACTION**: Implement the teacher-overlap pre-check with free-slot suggestions and the conflict error/23P01 helper.
- **IMPLEMENT**: `checkTeacherConflict(ctx, {teacherId,startAt,endAt,excludeLessonId})` and `suggestFreeSlots(...)` per `CONFLICT_DETECTION`; `ConflictError` + `isExclusionViolation` per `EXCLUSION_VIOLATION_HANDLING`.
- **MIRROR**: `CONFLICT_DETECTION`, `TENANT_SCOPED_OVERLAP_QUERY`, `EXCLUSION_VIOLATION_HANDLING`.
- **IMPORTS**: `drizzle-orm` (`and`,`eq`,`ne`,`sql`), `luxon`, `@/db/tenant`, `@/db/schema` (`lesson`), `server-only`.
- **GOTCHA**: Pass the overlap `sql\`\`` as the `extra` arg to `forTenant(ctx).select(lesson, extra)` — **never** call `db.select().from(lesson)` directly (breaks tenant isolation + the grep guard). Use `'[)'` half-open ranges consistently (matches the GiST constraint, so app + DB agree on back-to-back). `ne(lesson.status,'canceled')` so canceled lessons don't block. Suggestions are best-effort (same-day 08:00–21:00, 30-min steps, max 3).
- **VALIDATE**: `pnpm typecheck`; covered by `tests/conflict.test.ts` (Task 9).

### Task 4 — Materializer (`src/lib/materialize.ts`)
- **ACTION**: Implement idempotent section→lessons materialization.
- **IMPLEMENT**: `materializeSection(ctx, sectionId)` per `MATERIALIZER`. Derive `wallStart` parts from `section.recurrenceDtstart` in `section.recurrenceTimezone` via Luxon. Insert via `db.insert(lesson).values(rows).onConflictDoNothing({ target: [lesson.tenantId, lesson.sectionId, lesson.originalStartAt] })`.
- **MIRROR**: `MATERIALIZER`.
- **IMPORTS**: `@/db` (`db`), `@/db/schema`, `./recurrence`, `@/db/tenant`, `@/auth/context` (type), `server-only`.
- **GOTCHA**: **Denormalize `section.teacherId` onto `lesson.teacherId`** — the GiST constraint and conflict query key on `lesson.teacherId`; a null teacher silently exempts the row (P2-3 note). `onConflictDoNothing` on `uq_lesson_section_slot` preserves manual edits, exceptions, and canceled tombstones (P2-8). A materialized batch could itself violate the GiST constraint if the RRULE overlaps existing lessons — wrap in try/catch, and on `23P01` fall back to per-occurrence insert so good slots still land and conflicting ones are reported (do NOT abort the whole batch). `db.insert` is used directly here (bulk insert with explicit `tenantId` on every row) — this is the ONE sanctioned exception to forTenant for a bulk generated write; assert every row carries `ctx.tenantId`.
- **VALIDATE**: `tests/materialize.test.ts` (Task 9) — first call inserts N, second call inserts 0 (idempotent); a manually-edited (`is_exception`) or canceled slot is NOT overwritten on re-materialize.

### Task 5 — Student CRUD completion + UI
- **ACTION**: Extend `students/actions.ts` and add the student management page.
- **IMPLEMENT**: add `getStudent(id)`, `updateStudent(id, input)`, `archiveStudent(id)` (soft: `status='archived'`, mirror the guarded shape; `requirePermission(ctx,{student:['update']})`). `students/page.tsx` (server: `listStudents()`), `student-form.tsx` (`'use client'` create/edit calling actions, `useTransition`).
- **MIRROR**: `GUARDED_MUTATION`; dashboard page/layout patterns from Phase 1.
- **IMPORTS**: `@/auth/context`, `@/auth/authorize`, `@/db/tenant`, `@/db/schema` (`student`), `zod`, `next/cache`.
- **GOTCHA**: `archiveStudent` must **not** hard-delete (attendance/grade/payment FKs are `onDelete('restrict')` — a delete would throw). Reuse the existing `createStudent`/`listStudents` verbatim; only add. Every new `'use server'` export re-auths.
- **VALIDATE**: create/edit/archive a `张伟` student in the UI; 中文 renders; archived students filterable.

### Task 6 — Course + Section CRUD + recurrence form
- **ACTION**: Add course/section actions and the management UI that builds an RRULE and triggers materialization.
- **IMPLEMENT**: `courses/actions.ts`: `createCourse`, `updateCourse`, `archiveCourse` (`course` perms); `createSection`, `updateSection` (build `rrule` via `rrule-build.ts`, set `recurrenceDtstart`/`recurrenceTimezone`/`defaultDurationMinutes`/`capacity`), `materializeSectionAction(sectionId)` (calls `materializeSection`, returns count). `courses/page.tsx` + `section-form.tsx` (weekday checkboxes + time + duration + term dates → preview count).
- **MIRROR**: `GUARDED_MUTATION`, `MATERIALIZER` (via action).
- **IMPORTS**: `@/db/schema` (`course`,`classSection`), `@/lib/rrule-build`, `@/lib/materialize`, `zod`, `next/cache`.
- **GOTCHA**: `class_section.capacity` has a DB `check` 1–15 — validate in zod (`.int().min(1).max(15)`) to fail early with a nice message. `courseId` on section must belong to the same tenant — `forTenant(ctx).findById(course, courseId)` first (composite FK also enforces it, but check for a clean error). Materialize AFTER the section row is committed. Re-materializing after an RRULE change adds new slots but won't remove now-orphaned future lessons — for MVP, document that changing recurrence may leave stale future lessons the tutor cancels manually (full re-sync is Phase-7 polish).
- **VALIDATE**: create a course → section "每周一 16:00, 60 分钟, 学期 12 周" → "生成课节" reports 12; lessons appear on the calendar.

### Task 7 — Scheduling actions (conflict-checked) + calendar read
- **ACTION**: Implement lesson create/reschedule/cancel actions and the calendar data reader.
- **IMPLEMENT**: `schedule/data.ts`: `listLessonsInRange(ctx, {from,to})` → `forTenant(ctx).select(lesson, and(gte(startAt,from), lt(startAt,to)))` mapped to `CalendarEvent`. `schedule/actions.ts`: `createLessonAction` (validate → `checkTeacherConflict` → if conflict return `{ok:false,error:'CONFLICT',...}` else `forTenant(ctx).insert(lesson,...)` wrapped in the 23P01 try/catch → return `{ok:true,event}`); `rescheduleLessonAction` (same, with `excludeLessonId=id`, `forTenant().update`, set `is_exception=true` — P2-8); `cancelLessonAction` (`status='canceled'` tombstone); `cancelSeriesAction` (cancel all future non-canceled lessons of a section).
- **MIRROR**: `GUARDED_MUTATION`, `CONFLICT_DETECTION`, `ACTION_RESULT_SHAPE`, `EXCLUSION_VIOLATION_HANDLING`.
- **IMPORTS**: `@/lib/conflict`, `@/lib/errors`, `@/db/tenant`, `@/db/schema`, `drizzle-orm` (`and`,`gte`,`lt`,`eq`), `luxon`.
- **GOTCHA**: **Conflict is a returned result, not a thrown error** (P2 `ACTION_RESULT_SHAPE`) — the client needs `suggestions` to render. Auth/validation failures still throw. On reschedule, pass `excludeLessonId` so a lesson doesn't conflict with itself. `createLessonAction` must set `lesson.teacherId` (from the section or the acting teacher) or the GiST/conflict check silently passes. Convert incoming calendar `Date`s (already UTC instants from FullCalendar with `timeZone`) — do not double-convert. `revalidatePath('/dashboard/schedule')` after writes.
- **VALIDATE**: covered by `tests/conflict.test.ts`; manually: dragging a lesson onto an occupied teacher slot is rejected with suggestions; back-to-back (10:00 end → 10:00 start) is allowed.

### Task 8 — Calendar UI + lesson detail (attendance + notes) + nav
- **ACTION**: Build the responsive calendar, the lesson-detail drawer with attendance/notes, enrollment + attendance actions, and nav links.
- **IMPLEMENT**: `schedule/page.tsx` (`CALENDAR_UI` server part), `schedule/calendar.tsx` (`'use client'` FullCalendar per `CALENDAR_UI`), `schedule/lesson-detail.tsx` (`'use client'` drawer: list enrolled students with attendance radio present/absent/late/excused; note textarea; buttons 移到别的时间/取消这一节/取消整个系列). `enrollment-actions.ts`: `enrollStudent`/`unenrollStudent` (`course` perms; enforce `capacity`; respect `uq_enrollment_student_section` partial-active index → reactivate a dropped row instead of duplicate). `attendance-actions.ts`: `upsertAttendance` (`lesson` perms; `onConflictDoUpdate` on `uq_attendance_lesson_student`), `addNote` (`lesson` perms). Add nav links to `(dashboard)/layout.tsx`.
- **MIRROR**: `CALENDAR_UI`, `GUARDED_MUTATION`.
- **IMPORTS**: `@fullcalendar/*`, `@fullcalendar/core/locales/zh-cn`, `@/db/schema` (`enrollment`,`attendance`,`note`), server actions.
- **GOTCHA**: Calendar component is **`'use client'`** and must NOT import `server-only` modules — call server actions instead. Pin `initialDate` to avoid hydration mismatch (P2-6). Import FullCalendar CSS if the v7 build requires it (check on install; v6+ auto-injects). On mobile, default to `timeGridDay`/`timeGridWeek` and a compact `headerToolbar`. Enrollment upsert: a student who `dropped` then re-enrolls should flip the existing row back to `active` (the partial unique index only covers active rows). Attendance `recordedBy`/note `authorId` = `ctx.userId`.
- **VALIDATE**: on a phone viewport the week view is usable; clicking a lesson opens the drawer; marking attendance persists (re-open shows saved state); adding a note persists.

### Task 9 — Tests (unit + real-Postgres integration)
- **ACTION**: Add the four test files mirroring the Phase-1 harness.
- **IMPLEMENT**:
  - `tests/recurrence.test.ts` — pure: weekly/count expansion, correct `Asia/Shanghai` local hour, no-DST invariant (a July and a January occurrence both at 16:00 local → both +08:00).
  - `tests/conflict.test.ts` — real Postgres: overlapping teacher lesson detected + blocked; back-to-back allowed; canceled lesson doesn't block; **GiST**: a direct `db.insert` of an overlapping non-canceled lesson throws SQLSTATE `23P01`; a NULL-teacher lesson is exempt.
  - `tests/materialize.test.ts` — real Postgres: idempotency (2nd call = 0 new); canceled/exception slot preserved on re-materialize.
  - `tests/rbac-scheduling.test.ts` — `can()` matrix: `assistant` can `lesson:create` but not `course:create`; `parent` cannot `lesson:create`; `teacher` can `course:update`.
- **MIRROR**: `tests/tenant-isolation.test.ts` (fixtures, `ctxFor()`, idempotent `beforeAll/afterAll` cleanup, auth-table inserts must supply `createdAt`), `vitest.config.ts` (`server-only` stub + `dotenv/config`).
- **IMPORTS**: `vitest`, `@/db`, `@/db/schema`, `@/db/tenant`, `@/lib/*`, `drizzle-orm`.
- **GOTCHA**: Integration tests need a REAL Postgres with the Phase-2 migration applied (`docker compose --profile test` or the compose `postgres`). Reuse the `ctxFor(tenantId,userId,role)` helper. Teardown order matters: attendance/grade/payment FKs are `onDelete('restrict')`, so delete attendance/notes before lessons; section→lesson cascades, so deleting the org (which cascades course→section→lesson) works only if no restrict-children remain — delete attendance first. Seed a `member` row so `forTenant` + RBAC paths match reality.
- **VALIDATE**: `pnpm test` green; `docker compose --profile test run --rm test` green in-container.

### Task 10 — Full validation sweep
- **ACTION**: Run the whole gate.
- **IMPLEMENT**: `pnpm check` (typecheck + lint), `pnpm build`, `pnpm test`, the grep guard, and a manual mobile pass.
- **MIRROR**: Phase-1 Validation Commands.
- **GOTCHA**: `next build` uses Turbopack — no `webpack()` config. FullCalendar is client-only — a stray server import breaks the build. The grep guard (below) must still pass for all new feature code.
- **VALIDATE**: see **Validation Commands**.

---

## Testing Strategy

### Unit / Integration Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| recurrence: weekly window | `FREQ=WEEKLY;BYDAY=MO`, dtstart Mon 16:00 Asia/Shanghai, 4-week window | 4 occurrences, each 16:00 local (08:00 UTC) | — |
| recurrence: no-DST invariant | same rule spanning Jan & Jul | both occurrences +08:00 (China has no DST) | ✅ |
| recurrence: count cap | `COUNT=1000` | rejected (runaway guard) | ✅ |
| conflict: overlap | new lesson overlapping existing teacher lesson | `hasConflict:true`, suggestions non-empty | ✅ |
| conflict: back-to-back | new lesson starts exactly when another ends | `hasConflict:false` (`'[)'`) | ✅ |
| conflict: canceled ignored | overlap only with a `canceled` lesson | `hasConflict:false` | ✅ |
| GiST: direct overlapping insert | bypass app check, insert overlapping non-canceled | throws SQLSTATE `23P01` | ✅ |
| GiST: null teacher exempt | two overlapping lessons, `teacher_id=null` | both insert (exempt) | ✅ |
| materialize: idempotent | call twice | 2nd call inserts 0 | ✅ |
| materialize: preserves edits | edit one slot (`is_exception`), cancel another, re-materialize | edited + canceled rows untouched | ✅ |
| RBAC: assistant | `can('assistant',{course:['create']})` | false; `{lesson:['create']}` → true | ✅ |
| RBAC: parent | `can('parent',{lesson:['create']})` | false | ✅ |
| tenant isolation (regression) | ctx A reads B's lesson by id | null | ✅ |

### Edge Cases Checklist
- [ ] Section with no RRULE (one-off only) → materialize returns 0, no crash
- [ ] Term end before term start → zero occurrences, validation warns
- [ ] Reschedule a lesson onto its own current slot → not a self-conflict (`excludeLessonId`)
- [ ] Enroll past `capacity` → rejected with a clear message
- [ ] Re-enroll a previously-dropped student → reactivates the active row (no unique-index violation)
- [ ] Attendance upsert twice for same (lesson, student) → single row updated
- [ ] CJK round-trip: course「高一数学」, note「今天讲了三角函数」 render without mojibake
- [ ] Phone viewport (375px): week/day view usable, drawer scrolls

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
```
EXPECT: Zero type/lint errors.

### Data-layer guard (no direct db access in feature code)
```bash
grep -rEn "\bdb\.(select|insert|update|delete)\(" src/app src/lib | grep -vE "src/lib/materialize\.ts"
```
EXPECT: **No matches** except the documented bulk-insert in `src/lib/materialize.ts` (P2-7). Everything else goes through `forTenant`.

### Database / Migration
```bash
docker compose up -d postgres
pnpm db:migrate
psql "$DATABASE_URL" -c "\dx" | grep btree_gist
psql "$DATABASE_URL" -c "\d lesson" | grep lesson_no_teacher_overlap
```
EXPECT: `btree_gist` installed; `lesson_no_teacher_overlap` EXCLUDE constraint present.

### Tests
```bash
pnpm test                                   # vitest (needs DATABASE_URL to a live pg)
docker compose --profile test run --rm test # migrate + vitest in-container
```
EXPECT: All recurrence / conflict / GiST / materialize / RBAC / isolation assertions pass.

### Build
```bash
pnpm build && node .next/standalone/server.js &
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
```
EXPECT: Turbopack build succeeds (no client/server import leak); health → 200.

### Manual Validation
- [ ] Create student 张伟; create course 高一数学; create section 每周一16:00×12周; 生成课节 → 12 lessons on calendar
- [ ] Drag a new lesson onto an occupied teacher slot → blocked + suggested times shown
- [ ] Drag back-to-back (ends 17:00, next starts 17:00) → allowed
- [ ] Move one occurrence → series unchanged; cancel one → tombstone (re-materialize doesn't resurrect)
- [ ] Open a lesson → mark attendance + add a note → persists on reopen
- [ ] Phone viewport: schedule a lesson end-to-end

---

## Acceptance Criteria
- [ ] All 10 tasks completed
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm build` clean
- [ ] Scheduling a teacher-overlapping lesson is blocked (app pre-check) AND impossible at the DB (GiST `23P01`)
- [ ] Recurring section materializes correct occurrences at the right `Asia/Shanghai` time; idempotent; edit/cancel-preserving
- [ ] Single-occurrence move (`is_exception`) and cancel (tombstone) work without disturbing the series
- [ ] Attendance + notes persist per lesson; enrollment respects capacity and the active-unique index
- [ ] Full scheduling flow works on a phone viewport (中文, no mojibake)
- [ ] All tests (recurrence/conflict/GiST/materialize/RBAC/isolation) green in-container

## Completion Checklist
- [ ] Every `'use server'` export re-runs `requireAuthContext()` + `requirePermission()` + zod validation
- [ ] No feature code touches `db` directly (grep guard passes; only `materialize.ts` bulk-insert is exempt & documented)
- [ ] `lesson.teacherId` is denormalized on every materialized + created lesson (else GiST/conflict silently exempt)
- [ ] App overlap semantics `'[)'` match the GiST constraint exactly (back-to-back allowed)
- [ ] Conflict is a returned result (with suggestions), not a thrown error, at the action boundary
- [ ] Scheduling logic lives in `src/lib/*` (reusable by Phase-6 MCP), not buried in actions/UI
- [ ] Calendar is `'use client'`, fed by a Server Component; no `server-only` import in client code
- [ ] Timestamps stay UTC `timestamptz`; wall-clock↔UTC only via Luxon at the boundary
- [ ] Self-contained — implemented without further codebase searching

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| rrule tzid footgun → occurrences off by the offset | M | H | Treat rrule as floating enumerator; Luxon owns zone conversion (P2-1); no-DST China simplifies; unit-tested |
| GiST constraint blocks legitimate bulk materialization | M | M | Per-occurrence fallback on `23P01`; report conflicting slots instead of aborting the batch (Task 4) |
| Null `teacher_id` silently exempts a lesson from conflict/GiST | M | H | Always denormalize `section.teacherId`→`lesson.teacherId`; test asserts the exemption is intentional only for truly unassigned lessons |
| FullCalendar hydration mismatch / client-only import leak breaks Turbopack build | M | M | Pin `initialDate`; keep calendar `'use client'`; Server Component only passes serializable props; build gate catches leaks |
| Re-materialization after RRULE change leaves stale future lessons | M | L | MVP: document manual cancel; full re-sync deferred to Phase 7 |
| Enrollment double-active row under the partial unique index | L | M | Reactivate dropped row instead of insert; covered by an edge-case test |
| Numeric/timezone drift between app check and DB constraint | L | H | Both use `tstzrange(...,'[)')`; a test inserts a back-to-back pair to prove agreement |

## Notes
- **Keep scheduling logic in `src/lib/`** (`recurrence`, `conflict`, `materialize`) as pure/ctx-taking functions. Phase-6's MCP tools (`schedule_lesson`, `reschedule_lesson`) must call the *same* functions so conflict rules can't diverge between the UI and the connector.
- **The GiST constraint is the source of truth for "no double-book."** The app pre-check exists for UX (friendly message + suggestions); if the two ever disagree, the DB wins and the app check is the bug.
- **China has no DST** (fixed UTC+8 since 1991) — this is why the timezone story is simple. If the app ever serves a DST-observing zone, the Luxon-based conversion already handles it; only the "suggest slots" 08:00–21:00 window assumption would need per-zone review.
- **`numeric` grade columns** and grading UI remain Phase-5 scope; do not add grade entry here even though the schema supports it.
- **Confidence**: high for schema/conflict/materialize/RBAC (schema pre-provisioned in Phase 1, versions pinned); medium for exact FullCalendar 7 CSS-import + mobile toolbar ergonomics (verify on install) and for the RRULE-change re-sync UX (intentionally minimal in MVP).
</content>
