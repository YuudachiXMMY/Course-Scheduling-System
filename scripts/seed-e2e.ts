// E2E database seed — produces a deterministic, self-contained fixture tenant in the SAME Postgres the
// app reads from, then writes tests/e2e/.seed/seed-data.json with the dynamic ids specs consume.
//
// RUN: `npm run db:seed:e2e` (which is `node --env-file-if-exists=.env.e2e --conditions=react-server
// --import tsx scripts/seed-e2e.ts`). The `--conditions=react-server` flag makes `import 'server-only'`
// (pulled in transitively by @/db, @/auth/*) resolve to an empty module instead of throwing, so this
// plain-Node script can reuse the real app data layer (the same trick vitest uses via an alias).
//
// Idempotent: every run first wipes the E2E tenant (by tenantId) and all `@e2e.local` accounts, then
// recreates everything from scratch. It never touches rows outside the E2E tenant / email domain, so
// it is safe to run against a shared dev database.
//
// NOTE: lessons are inserted directly (weekly occurrences computed with luxon) rather than via
// @/lib/materialize — the materializer transitively imports `rrule`, whose named exports don't resolve
// under plain Node ESM + `--conditions=react-server`. Direct inserts keep the seed dependency-light and
// fully deterministic. Portal accounts still go through provisionPortalAccountCore (clean import chain)
// so passwords are hashed by Better Auth and portal_link rows are created correctly.
import './seed-env' // MUST be first — maps E2E_* env → app env before @/db / @/env are evaluated
import { and, asc, eq, gt, inArray, like } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { auth } from '@/auth/auth'
import type { AuthContext } from '@/auth/context'
import { db } from '@/db'
import {
  account,
  attendance,
  calendarFeed,
  classSection,
  course,
  creditPackage,
  enrollment,
  grade,
  lesson,
  member,
  note,
  organization,
  payment,
  portalLink,
  progressReport,
  rescheduleRequest,
  sectionMeeting,
  session,
  shareLink,
  student,
  user as userTable,
} from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { provisionPortalAccountCore } from '@/auth/provision'

import {
  E2E_ACCOUNTS,
  E2E_EMAIL_DOMAIN,
  E2E_FIXTURES,
  E2E_INVALID_SHARE_TOKEN,
  E2E_ORG_NAME,
  E2E_ORG_SLUG,
  E2E_SHARE_TOKEN,
  E2E_TENANT_ID,
  SEED_DATA_PATH,
} from '../tests/e2e/fixtures/seed-constants'
import type { SeedData } from '../tests/e2e/fixtures/seed-data'

const ZONE = 'Asia/Shanghai'
const WEEKDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }

interface Meeting {
  sectionId: string
  byDay: keyof typeof WEEKDAY | string
  startTime: string // 'HH:mm'
  durationMinutes: number
}

function log(msg: string) {
  console.log(`[seed-e2e] ${msg}`)
}

// child → parent delete order. All domain tables are tenant-scoped (bare tenant_id text, no FK to
// organization), so cascade-on-org-delete does NOT reach them — we must delete each explicitly.
const DOMAIN_TABLES = [
  rescheduleRequest,
  attendance,
  grade,
  note,
  progressReport,
  portalLink,
  shareLink,
  enrollment,
  lesson,
  sectionMeeting,
  creditPackage,
  payment,
  calendarFeed,
  classSection,
  course,
  student,
] as const

async function cleanup() {
  for (const table of DOMAIN_TABLES) {
    await db
      .delete(table)
      .where(eq((table as { tenantId: typeof course.tenantId }).tenantId, E2E_TENANT_ID))
  }
  const users = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(like(userTable.email, `%@${E2E_EMAIL_DOMAIN}`))
  const ids = users.map((u) => u.id)
  await db.delete(member).where(eq(member.organizationId, E2E_TENANT_ID))
  if (ids.length) {
    await db.delete(member).where(inArray(member.userId, ids))
    await db.delete(session).where(inArray(session.userId, ids))
    await db.delete(account).where(inArray(account.userId, ids))
    await db.delete(userTable).where(inArray(userTable.id, ids))
  }
  await db.delete(organization).where(eq(organization.id, E2E_TENANT_ID))
}

async function createStaff(
  acct: (typeof E2E_ACCOUNTS)[keyof typeof E2E_ACCOUNTS],
): Promise<string> {
  const created = await auth.api.createUser({
    body: { email: acct.email, password: acct.password, name: acct.displayName },
  })
  await auth.api.addMember({
    body: { userId: created.user.id, role: acct.memberRole, organizationId: E2E_TENANT_ID },
  })
  return created.user.id
}

// Expand one weekly meeting into concrete lesson rows across [termStart, termEnd], in the section zone.
function occurrences(meeting: Meeting, termStart: DateTime, termEnd: DateTime) {
  const [hh, mm] = meeting.startTime.split(':').map(Number)
  const target = WEEKDAY[meeting.byDay]
  let d = termStart.set({ hour: hh, minute: mm, second: 0, millisecond: 0 })
  d = d.plus({ days: (target - d.weekday + 7) % 7 }) // first matching weekday on/after termStart
  const bound = termEnd.endOf('day')
  const rows: { startAt: Date; endAt: Date }[] = []
  while (d <= bound) {
    rows.push({
      startAt: d.toJSDate(),
      endAt: d.plus({ minutes: meeting.durationMinutes }).toJSDate(),
    })
    d = d.plus({ weeks: 1 })
  }
  return rows
}

async function seedLessons(
  teacherId: string,
  sectionId: string,
  meetings: Meeting[],
  termStart: DateTime,
  termEnd: DateTime,
): Promise<number> {
  const rows = meetings.flatMap((m) =>
    occurrences(m, termStart, termEnd).map((o) => ({
      tenantId: E2E_TENANT_ID,
      sectionId,
      teacherId,
      startAt: o.startAt,
      endAt: o.endAt,
      originalStartAt: o.startAt,
      status: 'scheduled' as const,
    })),
  )
  if (!rows.length) return 0
  await db.insert(lesson).values(rows)
  return rows.length
}

async function main() {
  const baseURL = process.env.E2E_BASE_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

  log('cleaning previous E2E fixture…')
  await cleanup()

  log(`creating tenant ${E2E_TENANT_ID}…`)
  await db
    .insert(organization)
    .values({ id: E2E_TENANT_ID, name: E2E_ORG_NAME, slug: E2E_ORG_SLUG, createdAt: new Date() })

  log('creating staff accounts (owner/admin/teacher)…')
  const ownerId = await createStaff(E2E_ACCOUNTS.owner)
  const adminId = await createStaff(E2E_ACCOUNTS.admin)
  const teacherId = await createStaff(E2E_ACCOUNTS.teacher)

  const ownerCtx: AuthContext = {
    userId: ownerId,
    tenantId: E2E_TENANT_ID,
    role: 'owner',
    isPlatformAdmin: false,
  }

  log('creating course + sections + meetings…')
  const now = DateTime.now().setZone(ZONE)
  const termStart = now.minus({ days: 10 }).startOf('day')
  const termEnd = now.plus({ weeks: 6 }).startOf('day')
  // term_*_date columns are `date` (mode:'date') — store UTC-midnight of the LOCAL calendar day.
  const toUtcMidnight = (dt: DateTime) => new Date(Date.UTC(dt.year, dt.month - 1, dt.day))

  const [courseRow] = (await forTenant(ownerCtx).insert(course, {
    title: E2E_FIXTURES.course.title,
    subject: '数学',
    defaultDurationMinutes: 60,
  })) as (typeof course.$inferSelect)[]

  const sectionValues = (name: string) => ({
    courseId: courseRow.id,
    name,
    teacherId,
    capacity: 6,
    termStartDate: toUtcMidnight(termStart),
    termEndDate: toUtcMidnight(termEnd),
    recurrenceTimezone: ZONE,
  })
  const [sectionARow] = (await forTenant(ownerCtx).insert(
    classSection,
    sectionValues(E2E_FIXTURES.sectionA.name),
  )) as (typeof classSection.$inferSelect)[]
  const [sectionBRow] = (await forTenant(ownerCtx).insert(
    classSection,
    sectionValues(E2E_FIXTURES.sectionB.name),
  )) as (typeof classSection.$inferSelect)[]

  // Distinct weekdays per section keep the shared teacher conflict-free (GiST exclusion is per teacher).
  const meetingsA: Meeting[] = [
    { sectionId: sectionARow.id, byDay: 'MO', startTime: '16:00', durationMinutes: 60 },
    { sectionId: sectionARow.id, byDay: 'WE', startTime: '18:00', durationMinutes: 90 },
  ]
  const meetingsB: Meeting[] = [
    { sectionId: sectionBRow.id, byDay: 'TU', startTime: '16:00', durationMinutes: 60 },
    { sectionId: sectionBRow.id, byDay: 'TH', startTime: '18:00', durationMinutes: 90 },
  ]
  for (const m of [...meetingsA, ...meetingsB])
    await forTenant(ownerCtx).insert(sectionMeeting, m as unknown as Record<string, unknown>)

  log('creating students + enrollments…')
  const [studentARow] = (await forTenant(ownerCtx).insert(student, {
    name: E2E_FIXTURES.studentA.name,
    schoolGrade: E2E_FIXTURES.studentA.grade,
    status: 'active',
  })) as (typeof student.$inferSelect)[]
  const [studentBRow] = (await forTenant(ownerCtx).insert(student, {
    name: E2E_FIXTURES.studentB.name,
    schoolGrade: E2E_FIXTURES.studentB.grade,
    status: 'active',
  })) as (typeof student.$inferSelect)[]

  await forTenant(ownerCtx).insert(enrollment, {
    studentId: studentARow.id,
    sectionId: sectionARow.id,
    status: 'active',
  })
  await forTenant(ownerCtx).insert(enrollment, {
    studentId: studentBRow.id,
    sectionId: sectionBRow.id,
    status: 'active',
  })

  log('inserting lessons (weekly occurrences)…')
  const lessonsA = await seedLessons(teacherId, sectionARow.id, meetingsA, termStart, termEnd)
  const lessonsB = await seedLessons(teacherId, sectionBRow.id, meetingsB, termStart, termEnd)
  log(`  section A: ${lessonsA} lessons / section B: ${lessonsB} lessons`)

  log('provisioning portal accounts…')
  // Student A: parent + student portal logins, both consent-stamped so they land on content directly.
  const parentProv = await provisionPortalAccountCore(ownerCtx, {
    studentId: studentARow.id,
    name: E2E_ACCOUNTS.parent.displayName,
    kind: 'parent',
    loginId: E2E_ACCOUNTS.parent.email,
    password: E2E_ACCOUNTS.parent.password,
  })
  const studentProv = await provisionPortalAccountCore(ownerCtx, {
    studentId: studentARow.id,
    name: E2E_ACCOUNTS.student.displayName,
    kind: 'student',
    loginId: E2E_ACCOUNTS.student.email,
    password: E2E_ACCOUNTS.student.password,
  })
  await db
    .update(portalLink)
    .set({ consentedAt: new Date() })
    .where(
      and(
        eq(portalLink.tenantId, E2E_TENANT_ID),
        inArray(portalLink.userId, [parentProv.userId, studentProv.userId]),
      ),
    )

  // Student B: a parent login left UNCONSENTED for the consent-gate spec.
  const parentBProv = await provisionPortalAccountCore(ownerCtx, {
    studentId: studentBRow.id,
    name: E2E_ACCOUNTS.parentNoConsent.displayName,
    kind: 'parent',
    loginId: E2E_ACCOUNTS.parentNoConsent.email,
    password: E2E_ACCOUNTS.parentNoConsent.password,
  })

  log('creating share link for student A…')
  await forTenant(ownerCtx).insert(shareLink, { studentId: studentARow.id, token: E2E_SHARE_TOKEN })

  log('locating future lessons…')
  const nowDate = new Date()
  const futureFor = async (sectionId: string) =>
    db
      .select({ id: lesson.id, startAt: lesson.startAt })
      .from(lesson)
      .where(
        and(
          eq(lesson.tenantId, E2E_TENANT_ID),
          eq(lesson.sectionId, sectionId),
          gt(lesson.startAt, nowDate),
        ),
      )
      .orderBy(asc(lesson.startAt))
      .limit(1)
  const [futureA] = await futureFor(sectionARow.id)
  const [futureB] = await futureFor(sectionBRow.id)

  // Seed one pending reschedule request (parent B, student B) for the dashboard approval-queue spec.
  // Target a conflict-free slot: the next Saturday 10:00–11:00 (no section meets on the weekend).
  let pending: SeedData['pendingReschedule'] = null
  if (futureB) {
    const daysToSat = (WEEKDAY.SA - now.weekday + 7) % 7 || 7 // never 0 → always a future Saturday
    const reqStartDt = now
      .plus({ days: daysToSat })
      .set({ hour: 10, minute: 0, second: 0, millisecond: 0 })
    const reqEndDt = reqStartDt.plus({ hours: 1 })
    const [reqRow] = (await forTenant(ownerCtx).insert(rescheduleRequest, {
      lessonId: futureB.id,
      studentId: studentBRow.id,
      requestedById: parentBProv.userId,
      requestedStartAt: reqStartDt.toJSDate(),
      requestedEndAt: reqEndDt.toJSDate(),
      reason: 'E2E 改期申请（种子）',
      status: 'pending',
    })) as (typeof rescheduleRequest.$inferSelect)[]
    pending = {
      id: reqRow.id,
      studentId: studentBRow.id,
      lessonId: futureB.id,
      requestedStartAt: reqStartDt.toJSDate().toISOString(),
      requestedEndAt: reqEndDt.toJSDate().toISOString(),
    }
    log(`  pending reschedule request ${reqRow.id}`)
  } else {
    log('  WARNING: no future lesson for section B — skipping pending reschedule seed')
  }

  const seed: SeedData = {
    seededAt: new Date().toISOString(),
    tenantId: E2E_TENANT_ID,
    baseURL,
    accounts: {
      owner: {
        email: E2E_ACCOUNTS.owner.email,
        userId: ownerId,
        memberRole: 'owner',
        landing: '/dashboard',
      },
      admin: {
        email: E2E_ACCOUNTS.admin.email,
        userId: adminId,
        memberRole: 'admin',
        landing: '/dashboard',
      },
      teacher: {
        email: E2E_ACCOUNTS.teacher.email,
        userId: teacherId,
        memberRole: 'teacher',
        landing: '/dashboard',
      },
      parent: {
        email: E2E_ACCOUNTS.parent.email,
        userId: parentProv.userId,
        memberRole: 'parent',
        landing: '/portal',
      },
      student: {
        email: E2E_ACCOUNTS.student.email,
        userId: studentProv.userId,
        memberRole: 'student',
        landing: '/portal',
      },
      parentNoConsent: {
        email: E2E_ACCOUNTS.parentNoConsent.email,
        userId: parentBProv.userId,
        memberRole: 'parent',
        landing: '/portal',
      },
    },
    studentA: { id: studentARow.id, name: studentARow.name },
    studentB: { id: studentBRow.id, name: studentBRow.name },
    course: { id: courseRow.id, title: courseRow.title },
    sectionA: {
      id: sectionARow.id,
      name: sectionARow.name ?? E2E_FIXTURES.sectionA.name,
      teacherId,
    },
    sectionB: {
      id: sectionBRow.id,
      name: sectionBRow.name ?? E2E_FIXTURES.sectionB.name,
      teacherId,
    },
    lessons: {
      sectionA: lessonsA,
      sectionB: lessonsB,
      studentAFutureLessonId: futureA?.id ?? null,
      studentAFutureStartAt: futureA?.startAt ? new Date(futureA.startAt).toISOString() : null,
      studentBFutureLessonId: futureB?.id ?? null,
      studentBFutureStartAt: futureB?.startAt ? new Date(futureB.startAt).toISOString() : null,
    },
    share: { token: E2E_SHARE_TOKEN, studentId: studentARow.id, url: `/s/${E2E_SHARE_TOKEN}` },
    invalidShareToken: E2E_INVALID_SHARE_TOKEN,
    pendingReschedule: pending,
  }

  const outPath = resolve(process.cwd(), SEED_DATA_PATH)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(seed, null, 2))
  log(`wrote ${SEED_DATA_PATH} (lessons A=${lessonsA} B=${lessonsB})`)
  log('DONE')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
      console.error('[seed-e2e] FAILED:', e?.message ?? e)
      console.error(e?.stack)
    process.exit(1)
  })
