import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { organization, student, course, classSection, enrollment, lesson, note } from '@/db/schema'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// S8 schema-constraint group (DB1 tenant FK, DB2 room EXCLUDE, DB3 note anchor CHECK, DB6 enrollment
// restrict). Exercises the DDL added in drizzle/0014_*, 0015_*, 0016_* directly against the DB.
const org = 'org_db_constraints'
const D = (iso: string) => new Date(iso)

const cleanup = async () => {
  // child -> parent; enrollment before student/section (DB6 restrict); org last (DB1 restrict).
  await db.delete(note).where(eq(note.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await unseedOrg(org)
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(org)
  await db.insert(course).values({ id: 'c_dbc', tenantId: org, title: '约束课程' })
  await db.insert(classSection).values({ id: 'sec_dbc', tenantId: org, courseId: 'c_dbc' })
})
afterAll(cleanup)

describe('DB1 — tenant_id FK to organization', () => {
  it('rejects a row whose tenant_id has no matching organization', async () => {
    await expect(
      db.insert(student).values({ tenantId: 'org_nonexistent_dbc', name: '孤儿' }),
    ).rejects.toThrow()
  })

  it('blocks deleting an organization that still has tenant rows (ON DELETE RESTRICT)', async () => {
    await db.insert(student).values({ id: 'stu_ri', tenantId: org, name: 'RI' })
    await expect(db.delete(organization).where(eq(organization.id, org))).rejects.toThrow()
    // remove the child so the afterAll teardown can drop the org
    await db.delete(student).where(eq(student.id, 'stu_ri'))
  })
})

describe('DB2 — lesson_no_room_overlap EXCLUDE', () => {
  it('rejects a second lesson overlapping the same room+time', async () => {
    await db.insert(lesson).values({
      id: 'les_a',
      tenantId: org,
      sectionId: 'sec_dbc',
      startAt: D('2031-01-01T10:00:00Z'),
      endAt: D('2031-01-01T11:00:00Z'),
      location: 'Room 101',
    })
    await expect(
      db.insert(lesson).values({
        id: 'les_b',
        tenantId: org,
        sectionId: 'sec_dbc',
        startAt: D('2031-01-01T10:30:00Z'),
        endAt: D('2031-01-01T11:30:00Z'),
        location: 'Room 101',
      }),
    ).rejects.toThrow()
  })

  it('allows back-to-back, different-room, and null-location lessons', async () => {
    // back-to-back same room ('[)' — touch is not overlap)
    await db.insert(lesson).values({
      id: 'les_c',
      tenantId: org,
      sectionId: 'sec_dbc',
      startAt: D('2031-01-01T11:00:00Z'),
      endAt: D('2031-01-01T12:00:00Z'),
      location: 'Room 101',
    })
    // same time, different room
    await db.insert(lesson).values({
      id: 'les_d',
      tenantId: org,
      sectionId: 'sec_dbc',
      startAt: D('2031-01-01T10:30:00Z'),
      endAt: D('2031-01-01T11:30:00Z'),
      location: 'Room 202',
    })
    // overlapping but NULL location is exempt
    await db.insert(lesson).values({
      id: 'les_e',
      tenantId: org,
      sectionId: 'sec_dbc',
      startAt: D('2031-01-01T10:30:00Z'),
      endAt: D('2031-01-01T11:30:00Z'),
      location: null,
    })
    const rows = await db.select().from(lesson).where(eq(lesson.tenantId, org))
    expect(rows.length).toBeGreaterThanOrEqual(4)
  })
})

describe('DB3 — ck_note_target', () => {
  it('rejects a fully-unanchored note (all anchors null)', async () => {
    await expect(db.insert(note).values({ tenantId: org, body: '无锚点' })).rejects.toThrow()
  })

  it('accepts a note anchored to at least one subject', async () => {
    const [row] = await db
      .insert(note)
      .values({ tenantId: org, sectionId: 'sec_dbc', body: '有锚点' })
      .returning()
    expect(row).toBeTruthy()
  })
})

describe('DB6 — enrollment FK ON DELETE RESTRICT', () => {
  it('blocks deleting a student / section that still has an enrollment, then allows it after unenroll', async () => {
    await db.insert(student).values({ id: 'stu_e', tenantId: org, name: '在读' })
    await db.insert(enrollment).values({
      tenantId: org,
      studentId: 'stu_e',
      sectionId: 'sec_dbc',
      status: 'active',
    })
    await expect(db.delete(student).where(eq(student.id, 'stu_e'))).rejects.toThrow()
    await expect(db.delete(classSection).where(eq(classSection.id, 'sec_dbc'))).rejects.toThrow()
    // remove the enrollment first → the student delete now succeeds
    await db
      .delete(enrollment)
      .where(and(eq(enrollment.studentId, 'stu_e'), eq(enrollment.sectionId, 'sec_dbc')))
    const deleted = await db.delete(student).where(eq(student.id, 'stu_e')).returning()
    expect(deleted).toHaveLength(1)
  })
})
