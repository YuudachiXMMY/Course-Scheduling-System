# Plan: Phase 1 — Foundation & Deploy

## Summary

Stand up a deployable, authenticated, **multi-tenant-ready** Next.js 16 skeleton for the Course Scheduling System on real infrastructure **before any feature work**: Next.js 16 (App Router, React 19) + PostgreSQL + Drizzle ORM + Better Auth (Organization + Admin/RBAC), the complete core domain schema (every table carries `tenant_id`), a data-layer-enforced row-level authorization spine, and full containerization (multi-stage Dockerfile + docker-compose + Coolify deploy) so **test == production** on the same image. This is greenfield — the repo currently contains only the PRD, so every file is `CREATE`.

## User Story

As **the independent tutor (product owner / platform operator)**, I want **a secure, deployable app skeleton where I can log in and where each organization's data is provably isolated**, so that **I can build scheduling, publishing, and reporting on a foundation that already has auth, tenancy, and a reproducible deploy — instead of retrofitting authorization later (which is expensive and dangerous).**

## Problem → Solution

**Current state**: Empty repo (only `.claude/PRPs/prds/course-scheduling-system.prd.md`). No app, no DB, no auth, no deploy.
**Desired state**: `git push` → Coolify builds one Docker image → migrations run on boot → the tutor logs in → different tenants cannot see each other's rows → `drizzle-kit` migrations are versioned and reproducible → CI validates the exact image that ships.

## Metadata

- **Complexity**: **Large → XL** (~45 files, cohesive foundation; NOT splittable — it is the skeleton every later phase builds on)
- **Source PRD**: `.claude/PRPs/prds/course-scheduling-system.prd.md`
- **PRD Phase**: Phase 1 — Foundation & Deploy (`pending` → `in-progress`)
- **Depends on**: none (root phase)
- **Estimated Files**: ~45 (`CREATE` all — greenfield)
- **Research basis**: 6-domain parallel research (nextjs-16, drizzle-orm, better-auth, multitenancy-rbac, domain-schema, docker-coolify), 0 failures. Versions verified via npm / Context7 as of **2026-09**.

---

## Reconciliation Decisions (READ FIRST — resolves cross-source conflicts)

The research surfaced a few internally-inconsistent choices across domains. These are the **binding decisions** for implementation; every task below follows them:

| # | Decision | Chosen | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| R1 | **Directory layout** | `src/` dir: `src/app`, `src/db`, `src/auth`, `src/lib`. Path alias `@/*` → `./src/*` | root `app/` | 3 of 4 code-heavy domains + the Docker domain use `src/`; keeps `@/db`, `@/auth` imports consistent |
| R2 | **Postgres driver** | **postgres.js** (`postgres@3.4.9`) via `drizzle-orm/postgres-js` | `pg` / node-postgres | Pure-JS, zero native deps (clean multi-stage Docker), and the deploy migrator already uses `drizzle-orm/postgres-js/migrator`. `drizzleAdapter(provider:'pg')` works with either driver |
| R3 | **Primary key type** | **text + nanoid** via a `primaryId()` helper; Better Auth `advanced.database.generateId: () => nanoid()` | `serial` / native `uuid` / ULID | Non-guessable, tenant-safe, type-identical to Better Auth's text ids → clean joins + one id format app-wide. (ULID also fine but its prefix leaks creation time) |
| R4 | **Better Auth schema CLI** | **`npx auth@latest generate`** (package `auth`, 1.7 line) | `@better-auth/cli` | The `@better-auth/cli` package is frozen at 1.4.21 and does not emit 1.7 org/admin plugin schemas. **Verify at impl time** via `npx auth@latest --help` |
| R5 | **Drizzle adapter import** | `@better-auth/drizzle-adapter@1.7.4` | inline `better-auth/adapters/drizzle` | 1.7 dedicated package (docs + relations-v2 live here). Inline path still re-exports it as a fallback if install is awkward |
| R6 | **`nextCookies()` plugin** | **MUST be the LAST plugin** in the `betterAuth` `plugins` array | (omitting it) | Without it, sign-in/sign-out via **Server Actions** silently fail to set the session cookie |
| R7 | **Column naming** | Explicit `snake_case` column names in schema (`text('tenant_id')`) **and** `casing:'snake_case'` set in both `drizzle.config.ts` and the `drizzle()` client | relying on casing alone | Explicit names are foolproof; the `casing` setting is redundant-but-safe belt-and-suspenders for any future bare-helper columns |
| R8 | **Schema barrel + auth tables** | `src/db/schema/index.ts` barrel **re-exports** `../auth-schema`; `drizzle.config.ts` points **only** at the barrel; `drizzleAdapter` gets the same barrel namespace | listing both globs in config | Single source of truth; avoids double-defining the auth tables |
| R9 | **Node base image** | `node:24.21.0-alpine` (Node 24 "Krypton" = 2026 active LTS); `engines.node >=20.9.0`; `@types/node ^24` | Node 22 | Docker domain confirmed Node 24 is active LTS; Node 22 is maintenance-only |
| R10 | **Migration apply path** | Committed SQL in `./drizzle` (from `drizzle-kit generate`) applied by a **bundled `scripts/migrate.ts`** (postgres-js migrator + `pg_advisory_lock`) run from the container entrypoint | `drizzle-kit migrate` in the runtime image / Better Auth `migrate` | Standalone image has no `drizzle-kit`; Better Auth `migrate` is Kysely-only. esbuild-bundle the migrator so the runtime image stays lean |

---

## UX Design

**Internal foundation change — minimal user-facing surface.** The only end-user touchpoints in Phase 1 are a bare login/sign-up and an empty authenticated dashboard shell; feature UX arrives in Phase 2.

### Before
```
┌──────────────────────────────┐
│  No application exists.       │
│  (repo has only the PRD)      │
└──────────────────────────────┘
```

### After
```
┌──────────────────────────────────────────────┐
│  /login  → email+password (Better Auth)        │
│     ↓ (session cookie set; active org resolved)│
│  /dashboard  → authenticated shell (empty)     │
│     • only THIS tenant's data is ever visible  │
│  /api/health → {ok:true}  (Coolify liveness)   │
└──────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Auth | none | email+password login/sign-up | Owner/teacher only in MVP; parent/student roles defined but cannot log in yet |
| Tenant | none | active org auto-selected on login | `session.activeOrganizationId` is the only trusted tenant id |
| Deploy | none | `git push` → Coolify build → migrate-on-boot → serve | Same image runs in CI + compose + prod |

---

## Mandatory Reading

**Greenfield repo — there is no existing code to mirror.** The patterns are *established by this plan*. Read, in order:

| Priority | Source | Why |
|---|---|---|
| P0 | This plan's **Patterns to Mirror** + **Reconciliation Decisions** | The authoritative, reconciled code + conventions to copy verbatim |
| P0 | `.claude/PRPs/prds/course-scheduling-system.prd.md` §"Technical Approach", §"Phase 1 Details", §"Decisions Log" | Scope, constraints, the "authorize in the data layer, not middleware" mandate, CJK-first mandate |
| P1 | External docs table below | Version-specific APIs for Next 16 / Drizzle / Better Auth / Coolify |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Next.js 16 release | Next.js docs (Context7 `/vercel/next.js`) + release notes | Turbopack is the **default** for `dev` AND `build` (no flag; a custom `webpack()` config breaks build). `middleware.ts` → **`proxy.ts`** (Node runtime, export `proxy`). `cookies()/headers()/params/searchParams` are **async** — `await` them. `next lint` removed; `next build` no longer lints |
| `output: 'standalone'` | Next.js deployment docs | Emits `.next/standalone/server.js`; does **NOT** copy `public/` or `.next/static` — Dockerfile must `COPY` both. `next start` is incompatible → `CMD node server.js`; set `HOSTNAME=0.0.0.0` |
| CVE-2025-29927 | GHSA / NVD | Spoofable `x-middleware-subrequest` header let requests **skip middleware**. Lesson: `proxy.ts` is optimistic UX only; real authz lives beside the query, re-checked in every Server Action / Route Handler / data fetch |
| Drizzle ORM + drizzle-kit | Context7 `/drizzle-team/drizzle-orm-docs` | Pin **stable** `drizzle-orm@0.45.2` + `drizzle-kit@0.31.10` (version-lockstepped; NOT the 1.0-rc which changes `relations()`→`defineRelations`). `generate`+`migrate` for prod; `push` is dev-only (and has a composite-FK re-push bug #3993) |
| Better Auth (org + admin + access) | Better Auth docs (`better-auth.com`) | `betterAuth({ database: drizzleAdapter(db,{provider:'pg',schema}), plugins:[organization(),admin(),nextCookies()] })`. `session.activeOrganizationId` is the tenant pointer. `createAccessControl` + `ac.newRole`. 1.7 **rejects auth requests on schema drift** → migrate after every `auth generate` |
| Coolify deploy | Coolify docs (`coolify.io/docs`) | App = Dockerfile build pack (push-to-deploy, auto Traefik SSL); Postgres = separate **managed** resource (its pg_dump→S3 backups only cover the managed DB). A Dockerfile `HEALTHCHECK` overrides the UI check |
| nanoid / server-only / @t3-oss/env-nextjs | npm | `nanoid@5` is ESM-only; `server-only` poison-pill; `@t3-oss/env-nextjs` needs `moduleResolution:'bundler'` + zod v4 top-level validators (`z.url()`) |

> No further external research needed during implementation — the version matrix and APIs are captured here.

---

## Patterns to Mirror

Reconciled, copy-pasteable code. Follow these exactly (already adjusted per R1–R10).

### PROJECT_CONVENTIONS
```
// Layout (R1):  src/app  src/db  src/auth  src/lib   |  @/* -> ./src/*
// Driver (R2):  postgres.js (drizzle-orm/postgres-js)
// IDs   (R3):   text + nanoid, via primaryId()
// Auth boundary: ALWAYS in the data layer (context.ts + authorize.ts + forTenant), NEVER proxy.ts alone (CVE-2025-29927)
// Tenant: the ONLY trusted tenant id is session.activeOrganizationId (signed), re-checked against member table
// Timestamps: timestamptz (withTimezone:true) everywhere — HK scheduling app
// CJK: <html lang="zh-Hans">, system CJK font stack, UTF-8 DB — no next/font/google CJK
```

### ENV_VALIDATION
```typescript
// SOURCE: src/env.ts  (@t3-oss/env-nextjs + zod v4; import from next.config.ts for fail-fast)
import { createEnv } from '@t3-oss/env-nextjs'
import * as z from 'zod'

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
  },
  client: { NEXT_PUBLIC_APP_URL: z.url() },
  experimental__runtimeEnv: { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL },
  emptyStringAsUndefined: true,
})
```

### NEXT_CONFIG
```typescript
// SOURCE: next.config.ts  (merges standalone + tracing root + CSRF origins + env fail-fast)
import path from 'node:path'
import type { NextConfig } from 'next'
import './src/env' // validate env at build/boot; throws early if any var is missing

const nextConfig: NextConfig = {
  output: 'standalone',                 // -> .next/standalone/server.js (Docker). Does NOT copy public/ or .next/static.
  outputFileTracingRoot: path.resolve(), // pin tracing to this app (silences workspace-root warning)
  experimental: {
    // Server Actions enforce Origin===Host CSRF. Behind Coolify/Traefik, allow the public origin.
    serverActions: { allowedOrigins: [process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, '') ?? 'localhost:3000'] },
  },
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
  // Do NOT add a webpack() config — Turbopack build fails if one is present.
}
export default nextConfig
```

### DB_CLIENT  (postgres.js, HMR-safe singleton — R2/R7)
```typescript
// SOURCE: src/db/index.ts
import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema' // barrel (re-exports ../auth-schema too, per R8)

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')

// Cache across Next HMR or every save leaks a new pool until Postgres refuses connections.
const g = globalThis as unknown as { __pgClient?: ReturnType<typeof postgres> }
const client = g.__pgClient ?? postgres(connectionString, { max: 10, idle_timeout: 20, connect_timeout: 10, prepare: true })
if (process.env.NODE_ENV !== 'production') g.__pgClient = client

export const db = drizzle(client, { schema, casing: 'snake_case', logger: process.env.NODE_ENV !== 'production' })
export type DB = typeof db
export { schema }
```

### SCHEMA_HELPERS  (nanoid PK — R3; timestamptz — R7)
```typescript
// SOURCE: src/db/schema/_helpers.ts
import { text, timestamp } from 'drizzle-orm/pg-core'
import { nanoid } from 'nanoid'

// R3: text + nanoid PK — non-guessable, tenant-safe, type-identical to Better Auth ids.
export const primaryId = () => text('id').primaryKey().$defaultFn(() => nanoid())

// tenant_id === Better Auth organizationId. Bare text (auth owns the organization table).
export const tenantId = () => text('tenant_id').notNull()

export const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow().$onUpdate(() => new Date())
```

### DOMAIN_SCHEMA_ENUMS
```typescript
// SOURCE: src/db/schema/enums.ts
import { pgEnum } from 'drizzle-orm/pg-core'
export const studentStatus = pgEnum('student_status', ['active', 'inactive', 'archived'])
export const enrollmentStatus = pgEnum('enrollment_status', ['active', 'dropped', 'completed'])
export const lessonStatus = pgEnum('lesson_status', ['scheduled', 'completed', 'canceled'])
export const attendanceStatus = pgEnum('attendance_status', ['present', 'absent', 'late', 'excused'])
export const noteVisibility = pgEnum('note_visibility', ['internal', 'shared']) // 'shared' reserved (Phase 4)
// --- RESERVED (Phase 7) — declared now so migrations are stable ---
export const rescheduleStatus = pgEnum('reschedule_status', ['pending', 'approved', 'rejected', 'canceled'])
export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'refunded', 'void'])
```

### DOMAIN_SCHEMA_STUDENT  (composite-FK target; WeChat-first contact fields)
```typescript
// SOURCE: src/db/schema/student.ts
import { pgTable, text, date, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { studentStatus } from './enums'

export const student = pgTable('student', {
  id: primaryId(),
  tenantId: tenantId(),
  name: text('name').notNull(),          // 中文姓名
  englishName: text('english_name'),
  parentName: text('parent_name'),
  parentPhone: text('parent_phone'),
  parentWechat: text('parent_wechat'),   // WeChat-first primary channel
  parentEmail: text('parent_email'),
  schoolGrade: text('school_grade'),     // 初二 / Grade 8
  school: text('school'),
  birthDate: date('birth_date', { mode: 'date' }),
  status: studentStatus('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('uq_student_tenant_id').on(t.tenantId, t.id), // (tenant_id,id) composite-FK target
  index('idx_student_tenant_status').on(t.tenantId, t.status),
  index('idx_student_tenant_name').on(t.tenantId, t.name),
])
```

### DOMAIN_SCHEMA_COURSE  (TEMPLATE) + CLASS_SECTION (term instance, capacity 1–15, RRULE defaults)
```typescript
// SOURCE: src/db/schema/course.ts
import { pgTable, text, integer, boolean, date, timestamp, index, uniqueIndex, foreignKey, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'

export const course = pgTable('course', {          // reusable TEMPLATE, tenant-scoped
  id: primaryId(),
  tenantId: tenantId(),
  title: text('title').notNull(),
  subject: text('subject'),
  description: text('description'),
  level: text('level'),                            // free-form: 初级 / AP / Grade 8
  defaultDurationMinutes: integer('default_duration_minutes').notNull().default(60),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('uq_course_tenant_id').on(t.tenantId, t.id),
  index('idx_course_tenant').on(t.tenantId),
])

// A Course pinned to a term. Holds the RECURRENCE DEFAULTS that materialize into Lesson rows.
export const classSection = pgTable('class_section', {
  id: primaryId(),
  tenantId: tenantId(),
  courseId: text('course_id').notNull(),
  name: text('name'),                              // 2026 春季 · 周一班
  teacherId: text('teacher_id'),                   // -> Better Auth user.id (no Drizzle FK; auth-owned)
  capacity: integer('capacity').notNull().default(1), // 1..15 small group
  termStartDate: date('term_start_date', { mode: 'date' }),
  termEndDate: date('term_end_date', { mode: 'date' }),
  rrule: text('rrule'),                            // RFC5545 RRULE, NO DTSTART line
  recurrenceDtstart: timestamp('recurrence_dtstart', { withTimezone: true, mode: 'date' }),
  recurrenceTimezone: text('recurrence_timezone').notNull().default('Asia/Shanghai'),
  defaultDurationMinutes: integer('default_duration_minutes'), // overrides course default
  defaultLocation: text('default_location'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('uq_section_tenant_id').on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.courseId], foreignColumns: [course.tenantId, course.id], name: 'fk_section_course' }).onDelete('cascade'),
  index('idx_section_tenant_course').on(t.tenantId, t.courseId),
  index('idx_section_tenant_teacher').on(t.tenantId, t.teacherId),
  check('ck_section_capacity', sql`${t.capacity} between 1 and 15`),
])
```

### DOMAIN_SCHEMA_ENROLLMENT  (many-to-many Student ↔ ClassSection)
```typescript
// SOURCE: src/db/schema/enrollment.ts
import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { enrollmentStatus } from './enums'
import { student } from './student'
import { classSection } from './course'

export const enrollment = pgTable('enrollment', {
  id: primaryId(),
  tenantId: tenantId(),
  studentId: text('student_id').notNull(),
  sectionId: text('section_id').notNull(),
  status: enrollmentStatus('status').notNull().default('active'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  droppedAt: timestamp('dropped_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('uq_enrollment_student_section').on(t.tenantId, t.studentId, t.sectionId),
  foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_enrollment_student' }).onDelete('cascade'),
  foreignKey({ columns: [t.tenantId, t.sectionId], foreignColumns: [classSection.tenantId, classSection.id], name: 'fk_enrollment_section' }).onDelete('cascade'),
  index('idx_enrollment_tenant_section').on(t.tenantId, t.sectionId),
  index('idx_enrollment_tenant_student').on(t.tenantId, t.studentId),
])
```

### DOMAIN_SCHEMA_LESSON  (one dated occurrence + RFC5545 override + Phase-2 conflict indexes)
```typescript
// SOURCE: src/db/schema/lesson.ts
import { pgTable, text, boolean, timestamp, index, uniqueIndex, foreignKey, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { lessonStatus } from './enums'
import { classSection } from './course'

// Materialized-instance model: the recurring PATTERN lives on classSection.rrule;
// a materializer expands it into concrete Lesson rows (each individually editable).
export const lesson = pgTable('lesson', {
  id: primaryId(),
  tenantId: tenantId(),
  sectionId: text('section_id').notNull(),
  teacherId: text('teacher_id'),                   // denormalized from section for conflict queries
  startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }).notNull(),
  status: lessonStatus('status').notNull().default('scheduled'),
  location: text('location'),
  title: text('title'),
  notes: text('notes'),
  isException: boolean('is_exception').notNull().default(false),          // moved/renamed off pattern, or ad-hoc
  originalStartAt: timestamp('original_start_at', { withTimezone: true, mode: 'date' }), // RECURRENCE-ID slot
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('uq_lesson_tenant_id').on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.sectionId], foreignColumns: [classSection.tenantId, classSection.id], name: 'fk_lesson_section' }).onDelete('cascade'),
  // Idempotent materialization: <=1 row per (section, generated slot). NULL original_start_at (ad-hoc) never collide.
  uniqueIndex('uq_lesson_section_slot').on(t.tenantId, t.sectionId, t.originalStartAt),
  // Phase-2 conflict-detection indexes:
  index('idx_lesson_teacher_time').on(t.tenantId, t.teacherId, t.startAt),
  index('idx_lesson_time_range').on(t.tenantId, t.startAt, t.endAt),
  index('idx_lesson_room_time').on(t.tenantId, t.location, t.startAt),
  index('idx_lesson_tenant_section').on(t.tenantId, t.sectionId),
  index('idx_lesson_tenant_status').on(t.tenantId, t.status),
  check('ck_lesson_time_order', sql`${t.endAt} > ${t.startAt}`),
])
```

### DOMAIN_SCHEMA_ATTENDANCE / GRADE / NOTE
```typescript
// SOURCE: src/db/schema/attendance.ts
import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { attendanceStatus } from './enums'
import { lesson } from './lesson'
import { student } from './student'

export const attendance = pgTable('attendance', {
  id: primaryId(), tenantId: tenantId(),
  lessonId: text('lesson_id').notNull(),
  studentId: text('student_id').notNull(),
  status: attendanceStatus('status').notNull().default('present'),
  note: text('note'),
  recordedBy: text('recorded_by'),                 // -> user.id
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('uq_attendance_lesson_student').on(t.tenantId, t.lessonId, t.studentId), // upsertable per occurrence
  foreignKey({ columns: [t.tenantId, t.lessonId], foreignColumns: [lesson.tenantId, lesson.id], name: 'fk_attendance_lesson' }).onDelete('cascade'),
  foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_attendance_student' }).onDelete('cascade'),
  index('idx_attendance_tenant_student').on(t.tenantId, t.studentId),
])
```
```typescript
// SOURCE: src/db/schema/grade.ts  (per-student, per lesson OR per section)
import { pgTable, text, numeric, jsonb, timestamp, index, foreignKey, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { student } from './student'
import { lesson } from './lesson'
import { classSection } from './course'

export const grade = pgTable('grade', {
  id: primaryId(), tenantId: tenantId(),
  studentId: text('student_id').notNull(),
  lessonId: text('lesson_id'),                     // nullable — per-lesson grade
  sectionId: text('section_id'),                   // nullable — per-term grade
  title: text('title'),
  score: numeric('score', { precision: 6, scale: 2 }),      // NB: node-pg returns numeric as string
  maxScore: numeric('max_score', { precision: 6, scale: 2 }),
  rubric: jsonb('rubric').$type<Record<string, unknown>>(),
  comment: text('comment'),
  gradedBy: text('graded_by'),                     // -> user.id
  gradedAt: timestamp('graded_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_grade_student' }).onDelete('cascade'),
  foreignKey({ columns: [t.tenantId, t.lessonId], foreignColumns: [lesson.tenantId, lesson.id], name: 'fk_grade_lesson' }).onDelete('cascade'),
  foreignKey({ columns: [t.tenantId, t.sectionId], foreignColumns: [classSection.tenantId, classSection.id], name: 'fk_grade_section' }).onDelete('cascade'),
  index('idx_grade_tenant_student').on(t.tenantId, t.studentId),
  index('idx_grade_tenant_lesson').on(t.tenantId, t.lessonId),
  check('ck_grade_target', sql`${t.lessonId} is not null or ${t.sectionId} is not null`),
])
```
```typescript
// SOURCE: src/db/schema/note.ts  (attach to lesson / section / student; visibility 'shared' reserved for Phase 4)
import { pgTable, text, index, foreignKey } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { noteVisibility } from './enums'
import { lesson } from './lesson'
import { classSection } from './course'
import { student } from './student'

export const note = pgTable('note', {
  id: primaryId(), tenantId: tenantId(),
  lessonId: text('lesson_id'), sectionId: text('section_id'), studentId: text('student_id'),
  authorId: text('author_id'),                     // -> user.id
  body: text('body').notNull(),
  visibility: noteVisibility('visibility').notNull().default('internal'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.lessonId], foreignColumns: [lesson.tenantId, lesson.id], name: 'fk_note_lesson' }).onDelete('cascade'),
  foreignKey({ columns: [t.tenantId, t.sectionId], foreignColumns: [classSection.tenantId, classSection.id], name: 'fk_note_section' }).onDelete('cascade'),
  foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_note_student' }).onDelete('cascade'),
  index('idx_note_tenant_lesson').on(t.tenantId, t.lessonId),
  index('idx_note_tenant_student').on(t.tenantId, t.studentId),
])
```

### DOMAIN_SCHEMA_RESERVED  (Phase-7 placeholders — provisioned but NOT used in Phase 1)
```typescript
// SOURCE: src/db/schema/reserved.ts  — RescheduleRequest (apply→approve), CreditPackage, Payment
import { pgTable, text, integer, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { rescheduleStatus, paymentStatus } from './enums'
import { lesson } from './lesson'
import { student } from './student'

export const rescheduleRequest = pgTable('reschedule_request', {
  id: primaryId(), tenantId: tenantId(),
  lessonId: text('lesson_id').notNull(),
  requestedById: text('requested_by_id'),          // parent/student user.id
  requestedStartAt: timestamp('requested_start_at', { withTimezone: true, mode: 'date' }),
  requestedEndAt: timestamp('requested_end_at', { withTimezone: true, mode: 'date' }),
  reason: text('reason'),
  status: rescheduleStatus('status').notNull().default('pending'),
  reviewedById: text('reviewed_by_id'),            // teacher user.id
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.lessonId], foreignColumns: [lesson.tenantId, lesson.id], name: 'fk_reschedule_lesson' }).onDelete('cascade'),
  index('idx_reschedule_tenant_status').on(t.tenantId, t.status),
])

export const creditPackage = pgTable('credit_package', {
  id: primaryId(), tenantId: tenantId(),
  studentId: text('student_id').notNull(),
  name: text('name'),
  totalCredits: integer('total_credits'), remainingCredits: integer('remaining_credits'),
  priceCents: integer('price_cents'), currency: text('currency').notNull().default('CNY'),
  purchasedAt: timestamp('purchased_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('uq_credit_tenant_id').on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_credit_student' }).onDelete('cascade'),
  index('idx_credit_tenant_student').on(t.tenantId, t.studentId),
])

export const payment = pgTable('payment', {
  id: primaryId(), tenantId: tenantId(),
  studentId: text('student_id').notNull(),
  creditPackageId: text('credit_package_id'),
  amountCents: integer('amount_cents').notNull(), currency: text('currency').notNull().default('CNY'),
  status: paymentStatus('status').notNull().default('pending'),
  method: text('method'),
  paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id], name: 'fk_payment_student' }).onDelete('cascade'),
  foreignKey({ columns: [t.tenantId, t.creditPackageId], foreignColumns: [creditPackage.tenantId, creditPackage.id], name: 'fk_payment_credit' }).onDelete('set null'),
  index('idx_payment_tenant_student').on(t.tenantId, t.studentId),
])
```

### DOMAIN_SCHEMA_RELATIONS + BARREL  (R8: barrel re-exports auth-schema)
```typescript
// SOURCE: src/db/schema/relations.ts  (logical only, for Phase-2 RQB joins)
import { relations } from 'drizzle-orm'
import { course, classSection } from './course'
import { student } from './student'
import { enrollment } from './enrollment'
import { lesson } from './lesson'
import { attendance } from './attendance'
import { grade } from './grade'
import { note } from './note'

export const courseRelations = relations(course, ({ many }) => ({ sections: many(classSection) }))
export const sectionRelations = relations(classSection, ({ one, many }) => ({
  course: one(course, { fields: [classSection.courseId], references: [course.id] }),
  lessons: many(lesson), enrollments: many(enrollment),
}))
export const studentRelations = relations(student, ({ many }) => ({ enrollments: many(enrollment), attendance: many(attendance), grades: many(grade) }))
export const enrollmentRelations = relations(enrollment, ({ one }) => ({
  student: one(student, { fields: [enrollment.studentId], references: [student.id] }),
  section: one(classSection, { fields: [enrollment.sectionId], references: [classSection.id] }),
}))
export const lessonRelations = relations(lesson, ({ one, many }) => ({
  section: one(classSection, { fields: [lesson.sectionId], references: [classSection.id] }),
  attendance: many(attendance), grades: many(grade), notes: many(note),
}))
export const attendanceRelations = relations(attendance, ({ one }) => ({
  lesson: one(lesson, { fields: [attendance.lessonId], references: [lesson.id] }),
  student: one(student, { fields: [attendance.studentId], references: [student.id] }),
}))
```
```typescript
// SOURCE: src/db/schema/index.ts  (barrel — R8 re-exports the CLI-generated auth tables too)
export * from './enums'
export * from './student'
export * from './course'
export * from './enrollment'
export * from './lesson'
export * from './attendance'
export * from './grade'
export * from './note'
export * from './reserved'
export * from './relations'
export * from '../auth-schema' // Better Auth generated tables (user/session/organization/member/...) — R8
```

### AUTH_PERMISSIONS  (two AC universes: per-tenant org roles + platform admin; reserved statements)
```typescript
// SOURCE: src/auth/permissions.ts
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements as orgDefaults, ownerAc, adminAc as orgAdminAc, memberAc } from 'better-auth/plugins/organization/access'
import { defaultStatements as adminDefaults, adminAc as sysAdminAc } from 'better-auth/plugins/admin/access'

/* 1) ORGANIZATION (per-tenant) access control */
export const statement = {
  ...orgDefaults, // organization, member, invitation (built-in org mgmt)
  student: ['create', 'read', 'list', 'update', 'delete'],
  course:  ['create', 'read', 'list', 'update', 'delete'],
  lesson:  ['create', 'read', 'list', 'update', 'delete'],
  // RESERVED (declared now so the role matrix stays forward-stable):
  rescheduleRequest: ['create', 'read', 'list', 'approve', 'reject', 'cancel'],
  creditPackage:     ['create', 'read', 'list', 'update', 'delete'],
} as const
export type Statements = typeof statement
export const ac = createAccessControl(statement)

export const owner = ac.newRole({ ...ownerAc.statements,
  student: ['create','read','list','update','delete'], course: ['create','read','list','update','delete'], lesson: ['create','read','list','update','delete'],
  rescheduleRequest: ['create','read','list','approve','reject','cancel'], creditPackage: ['create','read','list','update','delete'] })
export const admin = ac.newRole({ ...orgAdminAc.statements,
  student: ['create','read','list','update','delete'], course: ['create','read','list','update','delete'], lesson: ['create','read','list','update','delete'],
  rescheduleRequest: ['read','list','approve','reject'], creditPackage: ['create','read','list','update'] })
export const teacher = ac.newRole({ ...memberAc.statements,
  student: ['create','read','list','update'], course: ['create','read','list','update'], lesson: ['create','read','list','update'],
  rescheduleRequest: ['read','list','approve','reject'], creditPackage: ['read','list'] })
export const assistant = ac.newRole({ ...memberAc.statements,
  student: ['read','list'], course: ['read','list'], lesson: ['create','read','list','update'],
  rescheduleRequest: ['read','list'], creditPackage: ['read','list'] })
// Phase-1: parent/student are READ-only placeholders; their only future WRITE is a RescheduleRequest (Phase 7).
export const parent = ac.newRole({ student: ['read'], lesson: ['read','list'], rescheduleRequest: ['create','read','list','cancel'] })
export const student_role = ac.newRole({ lesson: ['read','list'], rescheduleRequest: ['create','read','list','cancel'] })

export const orgRoles = { owner, admin, teacher, assistant, parent, student: student_role }
export type OrgRole = keyof typeof orgRoles

/* 2) PLATFORM (cross-tenant) admin — the self-hosting operator; a SEPARATE ac universe */
export const adminStatement = { ...adminDefaults } as const
export const adminAc = createAccessControl(adminStatement)
export const superadmin = adminAc.newRole({ ...sysAdminAc.statements })
export const user = adminAc.newRole({})
export const adminRoles = { superadmin, user }
```

### AUTH_SERVER  (org + admin plugins, auto active-org hook, nanoid ids, nextCookies LAST — R5/R6)
```typescript
// SOURCE: src/auth/auth.ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter' // R5 (fallback: 'better-auth/adapters/drizzle')
import { organization, admin as adminPlugin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { member } from '@/db/schema'         // re-exported from auth-schema via barrel (R8)
import { ac, orgRoles, adminAc, adminRoles } from '@/auth/permissions'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }), // provider 'pg' = Postgres dialect (works with postgres.js)
  emailAndPassword: { enabled: true, requireEmailVerification: false }, // MVP: owner/teacher only
  advanced: { database: { generateId: () => nanoid() } },   // R3: align auth ids with app nanoid PKs
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  databaseHooks: {
    session: {
      create: {
        // Auto-select the user's default tenant on login so the session always carries a trusted tenant.
        before: async (session) => {
          const [m] = await db.select({ organizationId: member.organizationId })
            .from(member).where(eq(member.userId, session.userId)).limit(1)
          return { data: { ...session, activeOrganizationId: m?.organizationId ?? null } }
        },
      },
    },
  },
  plugins: [
    organization({ ac, roles: orgRoles, creatorRole: 'owner' }),
    adminPlugin({ ac: adminAc, roles: adminRoles, adminRoles: ['superadmin'], defaultRole: 'user' }),
    nextCookies(), // R6: MUST be last
  ],
})
export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session
```
```typescript
// SOURCE: src/app/api/auth/[...all]/route.ts
import { auth } from '@/auth/auth'
import { toNextJsHandler } from 'better-auth/next-js'
export const { GET, POST } = toNextJsHandler(auth)
```
```typescript
// SOURCE: src/auth/client.ts  (UX-level checks only; server is the real boundary)
import { createAuthClient } from 'better-auth/react'
import { organizationClient, adminClient } from 'better-auth/client/plugins'
import { ac, orgRoles, adminAc, adminRoles } from '@/auth/permissions'
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [organizationClient({ ac, roles: orgRoles }), adminClient({ ac: adminAc, roles: adminRoles })],
})
```

### AUTH_CONTEXT  (the VERIFIED principal — session → tenantId → DB-checked role)
```typescript
// SOURCE: src/auth/context.ts
import 'server-only'
import { headers } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db'
import { member } from '@/db/schema'

export class AuthError extends Error {
  constructor(public code: 'UNAUTHENTICATED' | 'NO_ACTIVE_ORG' | 'NOT_A_MEMBER' | 'FORBIDDEN') { super(code); this.name = 'AuthError' }
}
export interface AuthContext { userId: string; tenantId: string; role: string; isPlatformAdmin: boolean }

export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers: await headers() }) // async headers() in Next 16
  if (!session?.session) return null
  const tenantId = session.session.activeOrganizationId
  if (!tenantId) return null
  // Re-derive role from the DB member row (a stale/forged cookie cannot grant access):
  const [m] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, session.user.id))).limit(1)
  if (!m) return null
  return { userId: session.user.id, tenantId, role: m.role, isPlatformAdmin: (session.user.role ?? '').split(',').includes('superadmin') }
}
export async function requireAuthContext(): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (!ctx) throw new AuthError('UNAUTHENTICATED')
  return ctx
}
```

### AUTH_AUTHORIZE  (RBAC guard aligned with Better Auth `role.authorize()`)
```typescript
// SOURCE: src/auth/authorize.ts
import 'server-only'
import { orgRoles, type OrgRole, type Statements } from '@/auth/permissions'
import { AuthError, type AuthContext } from '@/auth/context'

export type PermissionRequest = { [R in keyof Statements]?: Statements[R][number][] }

// Mirrors Better Auth's internal hasPermission(): split comma-separated roles, authorize() each, any success grants.
export function can(role: string, permission: PermissionRequest): boolean {
  return role.split(',').map((r) => r.trim()).some((name) => orgRoles[name as OrgRole]?.authorize(permission).success === true)
}
export function requirePermission(ctx: AuthContext, permission: PermissionRequest): void {
  if (ctx.isPlatformAdmin) return // cross-tenant operator bypasses tenant RBAC
  if (!can(ctx.role, permission)) throw new AuthError('FORBIDDEN')
}
// For DYNAMIC roles later: await auth.api.hasPermission({ headers: await headers(), body: { permissions } })
```

### TENANT_SPINE  (forTenant — the ONLY sanctioned way to touch tenant data)
```typescript
// SOURCE: src/db/tenant.ts
import 'server-only'
import { and, eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '@/db'
import type { AuthContext } from '@/auth/context'

type TenantTable = PgTable & { id: PgColumn; tenantId: PgColumn }

// tenantId comes ONLY from the verified AuthContext — never from request params/body.
export function forTenant(ctx: AuthContext) {
  const scope = (t: TenantTable) => eq(t.tenantId, ctx.tenantId)
  return {
    select<T extends TenantTable>(t: T, extra?: SQL) {
      const table = t as unknown as PgTable
      return db.select().from(table).where(extra ? and(scope(t), extra) : scope(t))
    },
    async findById<T extends TenantTable>(t: T, id: string) {
      const rows = await db.select().from(t as unknown as PgTable).where(and(scope(t), eq(t.id, id))).limit(1)
      return rows[0] ?? null
    },
    insert<T extends TenantTable>(t: T, values: Record<string, unknown>) {
      return db.insert(t as unknown as PgTable).values({ ...values, tenantId: ctx.tenantId }).returning() // forces tenantId
    },
    update<T extends TenantTable>(t: T, id: string, values: Record<string, unknown>) {
      const { tenantId: _t, id: _id, ...safe } = values as Record<string, unknown>
      return db.update(t as unknown as PgTable).set(safe).where(and(scope(t), eq(t.id, id))).returning()
    },
    delete<T extends TenantTable>(t: T, id: string) {
      return db.delete(t as unknown as PgTable).where(and(scope(t), eq(t.id, id))).returning()
    },
  }
}
```

### PROXY  (Next 16 — redirect-only, explicitly NOT an authz boundary — CVE-2025-29927)
```typescript
// SOURCE: proxy.ts  (repo root; NOT middleware.ts; export named `proxy`)
import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

// SECURITY (CVE-2025-29927): UX optimization ONLY. Presence-checks the cookie (no validation).
// EVERY Server Action / Route Handler must independently call requireAuthContext()+requirePermission().
export function proxy(request: NextRequest) {
  const hasSessionCookie = getSessionCookie(request) // presence only; docs flag this as NOT secure for gating
  const isProtected = request.nextUrl.pathname.startsWith('/dashboard')
  if (isProtected && !hasSessionCookie) return NextResponse.redirect(new URL('/login', request.url))
  return NextResponse.next()
}
export const config = { matcher: ['/dashboard/:path*'] }
```

### GUARDED_MUTATION  (the required verify → authorize → scope pattern)
```typescript
// SOURCE: src/app/(dashboard)/students/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'

export async function createStudent(input: { name: string; parentWechat?: string; schoolGrade?: string }) {
  const ctx = await requireAuthContext()            // 1) verified principal + tenant (ignore any client orgId)
  requirePermission(ctx, { student: ['create'] })   // 2) RBAC guard at the top
  const [row] = await forTenant(ctx).insert(student, { // 3) tenant-scoped write (tenantId injected from ctx)
    name: input.name, parentWechat: input.parentWechat, schoolGrade: input.schoolGrade,
  })
  revalidatePath('/dashboard/students')
  return row
}
export async function listStudents() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  return forTenant(ctx).select(student)             // only THIS tenant's rows
}
```

### HEALTH_ROUTE  (unauthenticated liveness — Coolify / Docker HEALTHCHECK)
```typescript
// SOURCE: src/app/api/health/route.ts
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET() { return Response.json({ ok: true, ts: Date.now() }, { status: 200 }) }
```

### ROOT_LAYOUT  (CJK-safe, zh-Hans)
```tsx
// SOURCE: src/app/layout.tsx
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
export const metadata: Metadata = { title: '课程排课系统', description: '独立教师的学生、课程与排课管理系统' }
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="zh-Hans" suppressHydrationWarning><body className="min-h-dvh antialiased">{children}</body></html>)
}
```
```css
/* SOURCE: src/app/globals.css  (Tailwind v4 CSS-first + system CJK stack — NO next/font/google CJK) */
@import "tailwindcss";
@theme { --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Hiragino Sans GB", "Segoe UI", sans-serif; }
html, body { font-family: var(--font-sans); }
```

### DRIZZLE_CONFIG  (R8: single barrel; casing snake_case — R7)
```typescript
// SOURCE: drizzle.config.ts
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts', // barrel already re-exports ../auth-schema (R8)
  out: './drizzle',
  casing: 'snake_case',               // R7 — must match the drizzle() client
  dbCredentials: { url: process.env.DATABASE_URL },
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  strict: true, verbose: true,
})
```

### MIGRATOR  (postgres-js + advisory lock; esbuild-bundled to dist/migrate.mjs — R10)
```typescript
// SOURCE: scripts/migrate.ts
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) { console.error('[migrate] DATABASE_URL is not set'); process.exit(1) }
const sql = postgres(url, { max: 1, onnotice: () => {} })
const db = drizzle(sql)
const LOCK_KEY = 728934123 // app-wide advisory lock: only one migrator runs at a time

async function main() {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
  try { await migrate(db, { migrationsFolder: './drizzle' }); console.log('[migrate] done') }
  finally { await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`; await sql.end({ timeout: 5 }) }
}
main().then(() => process.exit(0), (err) => { console.error('[migrate] FAILED:', err); process.exit(1) })
```

### DOCKERFILE  (multi-stage, Node 24 alpine, non-root, bundled migrator, self-contained healthcheck — R9/R10)
```dockerfile
# SOURCE: Dockerfile
# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.21.0-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Self-contained migrator: bundle drizzle-orm + postgres into one .mjs (no drizzle-kit in runtime).
RUN node_modules/.bin/esbuild scripts/migrate.ts \
      --bundle --platform=node --format=esm --target=node24 \
      --external:cloudflare:sockets --outfile=dist/migrate.mjs

FROM build AS test
ENV NODE_ENV=test
CMD ["npm", "run", "test"]

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/dist/migrate.mjs ./dist/migrate.mjs
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
# PHASE 4/5 ONLY: CJK fonts (apk add font-noto-cjk / switch to node:24-slim + fonts-noto-cjk) for Playwright/@react-pdf. NOT now.
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./entrypoint.sh"]
```
```bash
# SOURCE: docker/entrypoint.sh
#!/bin/sh
set -e
echo "[entrypoint] applying migrations"
node /app/dist/migrate.mjs           # idempotent + advisory-locked; non-zero abort => never serve a half-migrated schema
echo "[entrypoint] starting next standalone server"
exec node /app/server.js
```

### DOCKER_COMPOSE + CI  (local dev/test parity; CI builds the same image)
```yaml
# SOURCE: docker-compose.yml  (LOCAL dev/test ONLY — Coolify does prod: app=Dockerfile pack, db=managed)
name: course-scheduling
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment: { POSTGRES_USER: ${POSTGRES_USER:-app}, POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-app}, POSTGRES_DB: ${POSTGRES_DB:-course_scheduling} }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL","pg_isready -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-course_scheduling}"], interval: 5s, timeout: 5s, retries: 10 }
  app:
    build: { context: ., dockerfile: Dockerfile, target: runtime, args: { NODE_VERSION: 24.21.0-alpine } }
    restart: unless-stopped
    depends_on: { postgres: { condition: service_healthy } }
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-app}:${POSTGRES_PASSWORD:-app}@postgres:5432/${POSTGRES_DB:-course_scheduling}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET in .env}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:3000}
      NEXT_PUBLIC_APP_URL: ${BETTER_AUTH_URL:-http://localhost:3000}
    ports: ["3000:3000"]
  test:
    profiles: ["test"]
    build: { context: ., dockerfile: Dockerfile, target: test }
    depends_on: { postgres: { condition: service_healthy } }
    environment: { DATABASE_URL: postgres://${POSTGRES_USER:-app}:${POSTGRES_PASSWORD:-app}@postgres:5432/${POSTGRES_DB:-course_scheduling}, NODE_ENV: test }
    command: ["sh","-c","node dist/migrate.mjs && npm run test"]
volumes: { pgdata: {} }
```
> Full `.github/workflows/ci.yml` (build prod+test images from the same Dockerfile, run migrations+tests in-container against a `postgres:17-alpine` service, smoke-test `/api/health`) is in the docker-coolify research; reproduce it verbatim in Task 9.

### TENANT_ISOLATION_TEST  (the Phase-1 success-signal test)
```typescript
// SOURCE: tests/tenant-isolation.test.ts  (vitest; run against the compose/CI postgres)
import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '@/db'
import { organization, member, user } from '@/db/schema'
import { student } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import type { AuthContext } from '@/auth/context'

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({ tenantId, userId, role, isPlatformAdmin: false })

describe('tenant isolation', () => {
  const orgA = 'org_a', orgB = 'org_b', userA = 'user_a', userB = 'user_b'
  let studentB: string
  beforeAll(async () => {
    await db.insert(organization).values([{ id: orgA, name: 'A', slug: 'a' }, { id: orgB, name: 'B', slug: 'b' }])
    await db.insert(user).values([{ id: userA, name: 'A', email: 'a@a.com', emailVerified: true }, { id: userB, name: 'B', email: 'b@b.com', emailVerified: true }])
    await db.insert(member).values([{ id: 'm_a', organizationId: orgA, userId: userA, role: 'owner' }, { id: 'm_b', organizationId: orgB, userId: userB, role: 'owner' }])
    await forTenant(ctxFor(orgA, userA)).insert(student, { name: 'A-only' })
    const [b] = await forTenant(ctxFor(orgB, userB)).insert(student, { name: 'B-only' })
    studentB = (b as { id: string }).id
  })
  it('A cannot READ B by id (no IDOR)', async () => { expect(await forTenant(ctxFor(orgA, userA)).findById(student, studentB)).toBeNull() })
  it('A cannot UPDATE B', async () => { expect(await forTenant(ctxFor(orgA, userA)).update(student, studentB, { name: 'hacked' })).toHaveLength(0) })
  it('insert cannot smuggle a foreign tenantId', async () => {
    const [row] = await forTenant(ctxFor(orgA, userA)).insert(student, { name: 'x', tenantId: orgB })
    expect((row as { tenantId: string }).tenantId).toBe(orgA)
  })
})
```

---

## Files to Change

All `CREATE` (greenfield). Grouped by task.

| File | Action | Justification |
|---|---|---|
| `package.json` | CREATE | deps + scripts (dev/build/start/lint/typecheck/test/db:*/auth:generate), engines.node>=20.9, packageManager |
| `next.config.ts` | CREATE | standalone + tracing root + CSRF origins + env fail-fast |
| `tsconfig.json` | CREATE | strict, `moduleResolution:'bundler'`, `@/*`→`./src/*` |
| `eslint.config.mjs` | CREATE | ESLint 9 flat config: `next/core-web-vitals` + `next/typescript` (BOTH) |
| `.prettierrc.json`, `.prettierignore` | CREATE | Prettier + tailwind plugin |
| `.gitignore`, `.dockerignore` | CREATE | ignore `.env*`, `.next`, `node_modules`; keep `./drizzle`/`./scripts`/`./public` |
| `.env.example` | CREATE | DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL, POSTGRES_* |
| `src/env.ts` | CREATE | zod-validated env (fail-fast) |
| `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` | CREATE | root layout (zh-Hans + CJK stack), Tailwind v4, root redirect |
| `src/app/api/health/route.ts` | CREATE | unauthenticated liveness |
| `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx` | CREATE | auth route group + login/signup stubs (authClient) |
| `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/page.tsx` | CREATE | authed shell (UX guard) + landing |
| `src/app/(dashboard)/students/actions.ts` | CREATE | example guarded Server Action (verify→authorize→scope) |
| `src/db/index.ts` | CREATE | postgres.js singleton + drizzle client |
| `src/db/schema/_helpers.ts` | CREATE | primaryId (nanoid), tenantId, timestamps |
| `src/db/schema/enums.ts` | CREATE | status enums (+ reserved) |
| `src/db/schema/{student,course,enrollment,lesson,attendance,grade,note,reserved,relations,index}.ts` | CREATE | full domain schema + barrel (re-exports auth-schema) |
| `src/db/auth-schema.ts` | CREATE (generated) | `npx auth generate` output — do NOT hand-edit |
| `src/db/tenant.ts` | CREATE | `forTenant(ctx)` isolation spine |
| `src/db/queries/organizations.ts` | CREATE | `getDefaultOrganizationId` (optional; hook uses inline query) |
| `src/auth/permissions.ts` | CREATE | AC statements + org roles + platform roles |
| `src/auth/auth.ts` | CREATE | betterAuth server config |
| `src/auth/client.ts` | CREATE | auth client (org + admin) |
| `src/auth/context.ts` | CREATE | verified `AuthContext` |
| `src/auth/authorize.ts` | CREATE | `can`/`requirePermission` |
| `src/app/api/auth/[...all]/route.ts` | CREATE | Better Auth handler mount |
| `proxy.ts` | CREATE | Next 16 proxy (redirect-only) |
| `drizzle.config.ts` | CREATE | drizzle-kit config |
| `scripts/migrate.ts` | CREATE | postgres-js migrator + advisory lock |
| `Dockerfile`, `docker/entrypoint.sh`, `docker-compose.yml` | CREATE | containerization |
| `public/.gitkeep` | CREATE | guarantee `public/` for `COPY` |
| `.github/workflows/ci.yml` | CREATE | build image + migrate + test + health smoke |
| `vitest.config.ts`, `tests/tenant-isolation.test.ts` | CREATE | Phase-1 isolation test |
| `drizzle/**` | CREATE (generated) | committed SQL migrations |
| `README.md` | CREATE | run/deploy instructions (optional but recommended) |

## NOT Building

- **PWA / service worker / manifest** — Phase 3.
- **`.ics`/webcal feeds** — Phase 3.
- **PNG / PDF export, Playwright, CJK fonts in the image** — Phase 4/5 (image stays lean; fonts noted only as a future runtime switch).
- **MCP connector** — Phase 6.
- **Scheduling UI, conflict detection, recurrence materializer job** — Phase 2 (schema *supports* it now: RRULE fields, conflict indexes, `uq_lesson_section_slot`).
- **Parent/student login, reschedule-request flow, reminders, two-way sync, payments** — Phase 7 (only *reserved schema slots* + read-only role definitions now).
- **GiST exclusion constraint for hard overlap prevention** — recommended just before Phase 2 (raw SQL migration; noted in Risks), not required for Phase 1.
- **Email verification / password reset / social login** — MVP owner/teacher use email+password only.

---

## Step-by-Step Tasks

### Task 1 — Scaffold Next.js 16 (src/) + base config
- **ACTION**: Confirm Node ≥20.9 (recommend 24 LTS), `corepack enable`. Scaffold with `pnpm create next-app@latest . --yes` accepting defaults, **but ensure a `src/` dir** (`--src-dir` or move `app/`→`src/app/` and set `@/*`→`./src/*`). Create base config files.
- **IMPLEMENT**: `package.json` (deps/scripts/engines — see below), `next.config.ts` (NEXT_CONFIG), `tsconfig.json` (`moduleResolution:'bundler'`, `@/*`→`./src/*`), `eslint.config.mjs` (both `next/core-web-vitals`+`next/typescript`), `.prettierrc.json`, `.gitignore`, `src/env.ts` (ENV_VALIDATION), `.env.example`, `src/app/layout.tsx` (ROOT_LAYOUT), `src/app/globals.css`, `src/app/api/health/route.ts` (HEALTH_ROUTE), `src/app/page.tsx` (redirect to `/login` or `/dashboard`), `public/.gitkeep`.
- **MIRROR**: PROJECT_CONVENTIONS, NEXT_CONFIG, ENV_VALIDATION, ROOT_LAYOUT, HEALTH_ROUTE.
- **IMPORTS**: `next@16.3.5`, `react@19.3.0`, `react-dom@19.3.0`, `@t3-oss/env-nextjs@0.13.11`, `zod@4.6.3`, `server-only`; dev: `typescript@~5.9`, `@types/node@^24`, `eslint@^9`, `eslint-config-next@16.3.5`, `@eslint/eslintrc@^3`, `prettier@3.9.6`, `prettier-plugin-tailwindcss`.
- **GOTCHA**: `next build` uses **Turbopack** and fails on a custom `webpack()` config; it also no longer lints — `lint`/`typecheck` are separate scripts (wire into CI). File must be `proxy.ts`, never `middleware.ts` (Task 5). `@t3-oss/env-nextjs` needs `moduleResolution:'bundler'`.
- **VALIDATE**: `pnpm install && pnpm typecheck && pnpm lint && pnpm build`, then `node .next/standalone/server.js` and `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/health` → `200`. `test -f proxy.ts && ! test -f middleware.ts`.

### Task 2 — Drizzle + Postgres client & config (R2/R7)
- **ACTION**: Install Drizzle + postgres.js + nanoid; create the DB client singleton, drizzle-kit config, and shared schema helpers.
- **IMPLEMENT**: `src/db/index.ts` (DB_CLIENT), `drizzle.config.ts` (DRIZZLE_CONFIG), `src/db/schema/_helpers.ts` (SCHEMA_HELPERS), `src/db/schema/enums.ts` (DOMAIN_SCHEMA_ENUMS). Add `db:generate`/`db:migrate`/`db:studio`/`auth:generate` scripts.
- **MIRROR**: DB_CLIENT, DRIZZLE_CONFIG, SCHEMA_HELPERS.
- **IMPORTS**: `drizzle-orm@0.45.2`, `postgres@3.4.9`, `nanoid@^5.1.5`; dev: `drizzle-kit@0.31.10`, `tsx@^4.19`, `dotenv@^16.4`.
- **GOTCHA**: `casing:'snake_case'` MUST match in config + client (else phantom diffs). `import 'server-only'` in `src/db/index.ts`. `postgres.js` `prepare:true` is correct direct-to-Postgres; flip to `false` only behind a txn-mode pooler.
- **VALIDATE**: `npm ls drizzle-orm drizzle-kit postgres` shows the pinned trio.

### Task 3 — Author the full domain schema (tenant_id everywhere; composite FKs)
- **ACTION**: Create every domain table file + relations + reserved + barrel.
- **IMPLEMENT**: `src/db/schema/{student,course,enrollment,lesson,attendance,grade,note,reserved,relations,index}.ts` (all DOMAIN_SCHEMA_* patterns). The barrel **re-exports `../auth-schema`** (R8).
- **MIRROR**: all DOMAIN_SCHEMA_* + RELATIONS + BARREL.
- **IMPORTS**: pg-core helpers, `sql` from `drizzle-orm`, `nanoid` (via helpers).
- **GOTCHA**: Composite `(tenant_id,id)` FKs require the parent `uniqueIndex('uq_*_tenant_id')` — keep them. Use `generate`+`migrate`, never `push` (composite-FK re-push bug #3993). `numeric` returns a **string** from the driver — parse in the data layer. `teacherId`/`authorId` are bare `text` (no FK to auth tables) — validate membership in code.
- **VALIDATE**: `npx tsc --noEmit` passes (composite `foreignKey` column pairs line up). Defer `db:generate` to Task 6 (needs auth-schema first).

### Task 4 — Better Auth (Organization + Admin/RBAC) + generate auth schema (R4/R5/R6)
- **ACTION**: Configure Better Auth server + client + permissions, mount the handler, and generate the auth Drizzle schema.
- **IMPLEMENT**: `src/auth/permissions.ts` (AUTH_PERMISSIONS), `src/auth/auth.ts` (AUTH_SERVER), `src/auth/client.ts`, `src/app/api/auth/[...all]/route.ts`. Then run `npx auth@latest generate --output ./src/db/auth-schema.ts -y` to emit `src/db/auth-schema.ts` (user/session/account/verification + organization/member/invitation + admin columns incl. `session.activeOrganizationId`). Confirm the barrel re-exports it.
- **MIRROR**: AUTH_PERMISSIONS, AUTH_SERVER.
- **IMPORTS**: `better-auth@1.7.4`, `@better-auth/drizzle-adapter@1.7.4`, `nanoid`; dev CLI: `auth@1.7.4` (via `npx auth@latest`).
- **GOTCHA**: **`nextCookies()` MUST be last** (R6). Custom `roles` maps REPLACE built-ins — spread `ownerAc.statements`/`orgAdminAc.statements`/`memberAc.statements`. `creatorRole:'owner'` must name a defined role. Two role namespaces: org `admin` (member.role) ≠ platform `superadmin` (user.role). **Verify the CLI** (R4): `npx auth@latest --help`; the old `@better-auth/cli` is frozen at 1.4.21. 1.7 **rejects auth requests on schema drift** — always migrate after `auth generate`. `provider:'pg'` is the dialect (works with postgres.js).
- **VALIDATE**: `npx auth@latest generate` writes `src/db/auth-schema.ts` containing `organization`, `member`, `invitation`, and `session.active_organization_id`. `npx tsc --noEmit` passes.

### Task 5 — Authorization spine: context, authorize, forTenant, proxy
- **ACTION**: Build the data-layer security spine and the redirect-only proxy.
- **IMPLEMENT**: `src/auth/context.ts` (AUTH_CONTEXT), `src/auth/authorize.ts` (AUTH_AUTHORIZE), `src/db/tenant.ts` (TENANT_SPINE), `proxy.ts` (PROXY).
- **MIRROR**: AUTH_CONTEXT, AUTH_AUTHORIZE, TENANT_SPINE, PROXY.
- **IMPORTS**: `next/headers`, `better-auth/cookies` (`getSessionCookie`), `drizzle-orm` (`and`/`eq`), `@/auth/auth`, `@/db`.
- **GOTCHA**: `await headers()` (async in Next 16). Role is re-derived from the **DB member row**, not trusted from the cookie. `proxy.ts` performs NO authorization — only redirects. `forTenant` overwrites any client-supplied `tenantId` on insert and strips `id`/`tenantId` from update patches.
- **VALIDATE**: `npx tsc --noEmit`. `grep -rEn "\bdb\.(select|insert|update|delete)\(" src/app src/auth | grep -v "src/db/"` → **no matches** (feature code never calls `db` directly).

### Task 6 — Generate & apply the first migration
- **ACTION**: Produce and apply the initial migration against a local Postgres (compose db).
- **IMPLEMENT**: Start `postgres` (`docker compose up -d postgres` after Task 8, or a local pg). `npm run db:generate` → `./drizzle/0000_*.sql` + `meta/`. `npm run db:migrate` (`tsx scripts/migrate.ts`).
- **MIRROR**: MIGRATOR, DRIZZLE_CONFIG.
- **IMPORTS**: n/a (CLI).
- **GOTCHA**: Order matters — `auth generate` (Task 4) BEFORE `db:generate` so auth tables are in the schema. One migrator process only (advisory lock). Commit `./drizzle`.
- **VALIDATE**: `psql "$DATABASE_URL" -c "\dt"` lists auth tables + all domain tables + `__drizzle_migrations`. `psql -c "\d+ lesson"` shows `start_at`/`end_at` as `timestamp with time zone`, `uq_lesson_section_slot`, and conflict indexes. `psql -c "select conname from pg_constraint where contype='f' and conname like 'fk_%';"` lists the composite FKs.

### Task 7 — Login/dashboard stubs + owner-org seeding + example mutation
- **ACTION**: Wire minimal login/sign-up UI, the authed shell, and prove the guarded-mutation pattern; seed the first owner+organization so login yields an active tenant.
- **IMPLEMENT**: `src/app/(auth)/{layout,login/page,signup/page}.tsx` (authClient email+password), `src/app/(dashboard)/{layout,page}.tsx` (layout calls `requireAuthContext()` as a UX guard), `src/app/(dashboard)/students/actions.ts` (GUARDED_MUTATION). Seed: sign up the owner via `/api/auth`, then `authClient.organization.create(...)` (owner becomes `creatorRole`).
- **MIRROR**: GUARDED_MUTATION, dashboard layout guard.
- **IMPORTS**: `@/auth/client`, `@/auth/context`, `@/auth/authorize`, `@/db/tenant`, `@/db/schema`.
- **GOTCHA**: Every export of a `'use server'` file is a public endpoint — re-run `requireAuthContext()` + `requirePermission()` + validate inputs inside each. The dashboard layout guard is UX only; enforcement stays in each action.
- **VALIDATE**: `curl -i -X POST "$BETTER_AUTH_URL/api/auth/sign-up/email" -H 'Content-Type: application/json' -d '{"email":"owner@test.com","password":"Passw0rd!","name":"Owner"}'` → 200 + `Set-Cookie`. Manually: log in → land on `/dashboard`; create a student; confirm it persists scoped to the tenant.

### Task 8 — Containerization (Dockerfile, compose, entrypoint, migrator bundle)
- **ACTION**: Add the multi-stage Dockerfile, entrypoint, local compose, and `.dockerignore`.
- **IMPLEMENT**: `Dockerfile` (DOCKERFILE), `docker/entrypoint.sh`, `docker-compose.yml` (DOCKER_COMPOSE), `.dockerignore`, ensure `public/.gitkeep`. Add `esbuild` devDep for the migrator bundle.
- **MIRROR**: DOCKERFILE, MIGRATOR, DOCKER_COMPOSE.
- **IMPORTS**: dev: `esbuild@^0.25`.
- **GOTCHA**: standalone does NOT copy `public/` or `.next/static` — `COPY` both. `CMD`/entrypoint = `node server.js` (`next start` breaks standalone); `HOSTNAME=0.0.0.0`. esbuild the `postgres` driver with `--external:cloudflare:sockets`. Non-root `nextjs` user. Do NOT install CJK fonts yet.
- **VALIDATE**: `docker build --target runtime -t app:prod .`; `docker compose up --build -d` → postgres healthy, entrypoint logs migrations then serves; `curl -sf localhost:3000/api/health` → `{"ok":true}`; `docker run --rm --user 1001 app:prod id` → `uid=1001(nextjs)`.

### Task 9 — CI + tenant-isolation test (the Phase-1 success signal)
- **ACTION**: Add vitest + the isolation test and the GitHub Actions pipeline building the same image.
- **IMPLEMENT**: `vitest.config.ts` (path alias `@`→`src`), `tests/tenant-isolation.test.ts` (TENANT_ISOLATION_TEST), `.github/workflows/ci.yml` (build prod+test images from the same Dockerfile, run `node dist/migrate.mjs` + `npm run test` in-container against a `postgres:17-alpine` service, smoke-test `/api/health`). Add `test: vitest run`.
- **MIRROR**: TENANT_ISOLATION_TEST, DOCKER_COMPOSE (`test` profile), CI snippet in docker-coolify research.
- **IMPORTS**: dev: `vitest@^3`, `@vitejs/plugin-react` or `vite-tsconfig-paths` for the `@` alias.
- **GOTCHA**: The isolation test needs a REAL Postgres (compose/CI service) — it exercises `forTenant` end-to-end. `--network host` in CI so the container reaches the postgres service. Protect `main` to require green CI.
- **VALIDATE**: `docker compose --profile test run --rm test` → migrations apply, vitest green (A can't read/update B; foreign `tenantId` on insert is overwritten). CI is green on a PR.

### Task 10 — Coolify deploy (managed Postgres + app + env + domain + backups)
- **ACTION**: Deploy to the HK VPS via Coolify (mostly dashboard steps — document in `README.md`).
- **IMPLEMENT**: In Coolify: (1) create a **managed PostgreSQL 17** resource; enable its Backups → S3 (cron `0 */4 * * *`, retention ≥7). (2) Add an Application from the GitHub repo, **Dockerfile build pack**, Ports Exposes `3000`. (3) Set **secret** env vars: `DATABASE_URL` (managed DB internal string), `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL` + `NEXT_PUBLIC_APP_URL` (public https origin). (4) Attach domain (auto Let's Encrypt via Traefik), enable push-to-deploy.
- **MIRROR**: docker-coolify research "setupSteps" + "gotchas".
- **IMPORTS**: n/a (infra).
- **GOTCHA**: App and DB are **separate** Coolify resources — do NOT deploy `docker-compose.yml` to prod. Env vars as **secrets**, not build-time. Dockerfile `HEALTHCHECK` overrides the UI check — pick one. Coolify's DB backup covers only the managed DB — pair with Restic for full-server + **test restores**. Give the build host ≥4GB (or `NODE_OPTIONS=--max-old-space-size=4096`); on a tiny VPS, build in CI and have Coolify pull. Migrations must be backward-compatible (expand/contract) for rolling deploys.
- **VALIDATE**: `git push` → Coolify builds → `https://<domain>/api/health` → `{"ok":true}`; log in over HTTPS; create a second org and confirm cross-tenant invisibility in the live app.

### `package.json` reference (scripts + engines)
```json
{
  "name": "course-scheduler", "version": "0.1.0", "private": true, "type": "module",
  "packageManager": "pnpm@10.0.0", "engines": { "node": ">=20.9.0" },
  "scripts": {
    "dev": "next dev", "build": "next build", "start": "node .next/standalone/server.js",
    "lint": "eslint .", "typecheck": "tsc --noEmit", "format": "prettier --write .",
    "check": "pnpm run typecheck && pnpm run lint",
    "auth:generate": "auth generate --output ./src/db/auth-schema.ts -y",
    "db:generate": "drizzle-kit generate", "db:migrate": "tsx scripts/migrate.ts",
    "db:studio": "drizzle-kit studio", "test": "vitest run"
  }
}
```

---

## Testing Strategy

### Unit / Integration Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| tenant isolation: read by id | ctx=A, id of B's student | `null` (IDOR blocked) | ✅ |
| tenant isolation: update | ctx=A, id of B's student | 0 rows updated | ✅ |
| tenant isolation: insert smuggle | ctx=A, `values.tenantId=B` | row.tenantId === A (overwritten) | ✅ |
| RBAC guard | role=`assistant`, `{student:['delete']}` | `can()` false → `FORBIDDEN` | ✅ |
| auth context, no active org | session w/o activeOrganizationId | `getAuthContext()` → null | ✅ |
| health | GET /api/health | 200 `{ok:true}` | — |
| migration idempotency | run migrate twice | second run no-op | ✅ |

### Edge Cases Checklist
- [ ] Empty input to Server Action (zod validation rejects) — add zod parse in feature actions
- [ ] Unauthenticated request to a Route Handler → 401 (not a redirect loop)
- [ ] Logged-in user with no organization → `NO_ACTIVE_ORG` handled gracefully
- [ ] Concurrent deploys → advisory lock serializes the migrator
- [ ] CJK round-trip: create a student named `张伟`, read it back — no mojibake (UTF-8 DB)
- [ ] Cross-tenant id in a URL param → `findById` returns null (no leak)

---

## Validation Commands

### Static Analysis
```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint . (both next/core-web-vitals + next/typescript active)
```
EXPECT: Zero type/lint errors.

### Build
```bash
pnpm build && node .next/standalone/server.js &
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
```
EXPECT: Turbopack build writes `.next/standalone/server.js`; health → `200`.

### Database / Migrations
```bash
docker compose up -d postgres
npm run auth:generate && npm run db:generate && npm run db:migrate
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "\d+ lesson"
```
EXPECT: auth + domain tables + `__drizzle_migrations`; `lesson.start_at/end_at` are `timestamp with time zone`; conflict indexes + `uq_lesson_section_slot` present.

### Unit Tests (isolation — the success signal)
```bash
docker compose --profile test run --rm test   # migrate + vitest against real postgres
```
EXPECT: All tenant-isolation assertions pass.

### Container parity
```bash
docker build --target runtime -t app:prod .
docker run --rm --user 1001 app:prod id                 # uid=1001(nextjs)
docker compose up --build -d && docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q app)
```
EXPECT: non-root; container reports `healthy` after start-period.

### Deploy (Coolify)
```bash
git push origin main   # triggers Coolify build + deploy
curl -sf https://<your-domain>/api/health
```
EXPECT: `{"ok":true}`; login works over HTTPS.

### Manual Validation
- [ ] Sign up owner → create organization → log in → land on `/dashboard`
- [ ] Create a student (`张伟`) via the guarded action; verify it persists and renders 中文 correctly
- [ ] Create a second org/user; confirm the first tenant's data is invisible to the second (live)
- [ ] Push a schema change → confirm migration runs on deploy and the app stays up

---

## Acceptance Criteria
- [ ] All 10 tasks completed
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm build` clean
- [ ] `docker compose up --build` boots, migrates, serves; `/api/health` → 200
- [ ] Tenant-isolation test green (read/update/IDOR/insert-smuggle all blocked)
- [ ] Login works; different tenants cannot see each other's data
- [ ] Migrations versioned in `./drizzle` and applied on container boot
- [ ] Deployed on Coolify/HK VPS behind HTTPS with managed-Postgres S3 backups configured

## Completion Checklist
- [ ] Follows Reconciliation Decisions R1–R10 throughout
- [ ] Authorization enforced in the data layer (context/authorize/forTenant), never proxy.ts alone
- [ ] `tenant_id` on every domain table; the only trusted tenant is `session.activeOrganizationId`
- [ ] `nextCookies()` is the last plugin; `proxy.ts` (not `middleware.ts`) does redirect-only
- [ ] No feature code calls `db` directly (grep guard passes)
- [ ] Timestamps are `timestamptz`; DB is UTF-8; 中文 round-trips
- [ ] No CJK fonts / Playwright / PDF in the Phase-1 image (kept lean)
- [ ] `.env` never committed; secrets set in Coolify; `.env.example` documents all vars
- [ ] Self-contained — implemented without further codebase searching

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Better Auth CLI package/name changed since research (R4) | M | M | Verify `npx auth@latest --help` first; fallback to `@better-auth/cli` only if it emits 1.7 org/admin schemas; migrate immediately after generate (1.7 rejects on drift) |
| Better Auth 1.7 schema-validation rejects requests on drift | M | H | Always run `auth:generate → db:generate → db:migrate` together; commit `./drizzle`; the entrypoint migrates before serving |
| `@better-auth/drizzle-adapter` install/version mismatch (R5) | L | M | Fallback to inline `better-auth/adapters/drizzle` (re-exports the same adapter) |
| Standalone image 404s on assets (missing `public/`/`static` copy) | M | M | Dockerfile copies both; `node .next/standalone/server.js` sanity check before building |
| Composite-FK migration ordering / `push` corruption (#3993) | L | M | Use `generate`+`migrate` only; parent `uniqueIndex('uq_*_tenant_id')` present before FKs |
| Coolify build OOM on small VPS | M | M | ≥4GB build host or `NODE_OPTIONS=--max-old-space-size=4096`; or build in CI and pull |
| CJK renders as tofu later (fonts) | H (later) | H | Not a Phase-1 image concern; documented switch to `node:24-slim` + `fonts-noto-cjk` at Phase 4/5; DB UTF-8 verified now |
| No hard overlap guarantee until GiST constraint | L | M | Add `btree_gist` + `EXCLUDE USING gist (tenant_id =, teacher_id =, tstzrange(start_at,end_at) &&) WHERE status<>'canceled'` raw SQL migration just before Phase 2 |
| `serverActions.allowedOrigins` under `experimental` may move in Next 16 | L | L | Verify against Next 16 config docs; adjust key if stabilized |

## Notes
- **Recurring lessons are materialized** (RRULE on `class_section`, expanded into `lesson` rows by a Phase-2 job): chosen so Phase-2 conflict detection is a plain indexable `tstzrange` overlap query and per-instance edits/attendance attach to a stable PK. `uq_lesson_section_slot(tenant_id, section_id, original_start_at)` makes materialization idempotent (Postgres treats NULL `original_start_at` as DISTINCT, so ad-hoc lessons never collide). The materializer must **skip** any slot that already has a row so manual edits are never clobbered — a Phase-2 concern, but the schema locks in the shape now.
- **Two role namespaces**: per-tenant org roles live in `member.role` (organization plugin); the cross-tenant platform operator lives in `user.role` (admin plugin, `superadmin`). `requirePermission` lets `isPlatformAdmin` bypass tenant RBAC — audit impersonation (`session.impersonatedBy`).
- **`numeric` grade columns** come back as JS strings from the driver — parse/format in the data layer. Per the PRD's "no hallucinated facts" rule, report numbers (Phase 5) render straight from these DB values.
- **Full per-agent research** (exhaustive gotchas, alternative snippets, the complete CI workflow) is preserved in the workflow journal at `.claude/projects/…/subagents/workflows/wf_7bacb930-98f/journal.jsonl` if deeper detail is needed during implementation.
- **Confidence**: high for app/schema/auth/tenancy (fully specified, version-pinned); medium for the exact Better Auth 1.7 CLI invocation (R4) and Coolify dashboard specifics (verify live).
