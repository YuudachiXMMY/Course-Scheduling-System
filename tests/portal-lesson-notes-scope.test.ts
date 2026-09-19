import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { student, portalLink, course, classSection, enrollment, lesson, note } from '@/db/schema'
import { getPortalLessonNotes } from '@/app/portal/notes/data'
import type { AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// T4 —— 门户「课节笔记」的行级隔离 + 仅 shared。
// 家长 A 关联孩子 X（在 secX 就读）；别家孩子 Z 在 secZ 就读，不关联 A。
// secX 的 L1 有一条 shared 共享笔记(可见) + 一条 per-student 点评(永不外泄)；L2 有一条 internal 共享笔记(不可见)。
// secZ 的 L3 有一条 shared 共享笔记 —— 因 A 未关联 Z，绝不可见（防越权）。
const org = 'org_portal_notes_scope'
const parentA = 'u_parent_pns'
const stuX = 'stu_x_pns'
const stuZ = 'stu_z_pns'

const ctx: AuthContext = { tenantId: org, userId: parentA, role: 'parent', isPlatformAdmin: false }
const at = (d: number, h: number) => new Date(Date.UTC(2026, 2, d, h))

let secX: string
let secZ: string
let L1: string
let L2: string
let L3: string

const cleanup = async () => {
  await db.delete(note).where(eq(note.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(portalLink).where(eq(portalLink.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await unseedOrg(org)
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(org)
  await db.insert(student).values([
    { id: stuX, tenantId: org, name: '学生X' },
    { id: stuZ, tenantId: org, name: '学生Z' },
  ])
  // 家长 A 只关联 X（consentedAt 已 stamp，否则 requireConsent 抛错）。不关联 Z。
  await db.insert(portalLink).values({
    tenantId: org,
    studentId: stuX,
    userId: parentA,
    relationship: 'parent',
    consentedAt: new Date(),
  })

  const [cX] = (await db.insert(course).values({ tenantId: org, title: '数学' }).returning()) as {
    id: string
  }[]
  const [cZ] = (await db.insert(course).values({ tenantId: org, title: '英语' }).returning()) as {
    id: string
  }[]
  const [sX] = (await db
    .insert(classSection)
    .values({ tenantId: org, courseId: cX.id, teacherId: 'tt', capacity: 5, name: 'A班' })
    .returning()) as { id: string }[]
  const [sZ] = (await db
    .insert(classSection)
    .values({ tenantId: org, courseId: cZ.id, teacherId: 'tt', capacity: 5, name: 'B班' })
    .returning()) as { id: string }[]
  secX = sX.id
  secZ = sZ.id
  await db.insert(enrollment).values([
    { tenantId: org, studentId: stuX, sectionId: secX, status: 'active' },
    { tenantId: org, studentId: stuZ, sectionId: secZ, status: 'active' },
  ])

  const [le1] = (await db
    .insert(lesson)
    .values({
      tenantId: org,
      sectionId: secX,
      teacherId: 'tt',
      startAt: at(1, 10),
      endAt: at(1, 11),
    })
    .returning()) as { id: string }[]
  const [le2] = (await db
    .insert(lesson)
    .values({
      tenantId: org,
      sectionId: secX,
      teacherId: 'tt',
      startAt: at(2, 10),
      endAt: at(2, 11),
    })
    .returning()) as { id: string }[]
  const [le3] = (await db
    .insert(lesson)
    .values({
      tenantId: org,
      sectionId: secZ,
      teacherId: 'tt',
      startAt: at(3, 10),
      endAt: at(3, 11),
    })
    .returning()) as { id: string }[]
  L1 = le1.id
  L2 = le2.id
  L3 = le3.id

  await db.insert(note).values([
    // L1: 对外开放的共享笔记（studentId null, visibility shared）→ A 可见
    { tenantId: org, lessonId: L1, body: 'L1 对外笔记 $x^2$', visibility: 'shared' },
    // L1: per-student 点评（studentId 设置）→ 永不进门户
    {
      tenantId: org,
      lessonId: L1,
      studentId: stuX,
      body: 'L1 给X的私密点评',
      visibility: 'shared',
    },
    // L2: 内部共享笔记（visibility internal）→ 不可见
    { tenantId: org, lessonId: L2, body: 'L2 内部草稿', visibility: 'internal' },
    // L3: 别家班级的对外笔记 → A 未关联 Z，绝不可见
    { tenantId: org, lessonId: L3, body: 'L3 别家对外笔记', visibility: 'shared' },
  ])
})

afterAll(cleanup)

describe('getPortalLessonNotes —— 行级 scope + 仅 shared + 不泄露点评', () => {
  it('只返回关联学生所在班级中 visibility=shared 的共享笔记', async () => {
    const notes = await getPortalLessonNotes(ctx)
    const bodies = notes.map((n) => n.body)
    expect(bodies).toContain('L1 对外笔记 $x^2$')
    expect(notes.length).toBe(1)
  })

  it('不泄露 internal 共享笔记（L2）', async () => {
    const notes = await getPortalLessonNotes(ctx)
    expect(notes.some((n) => n.body.includes('内部草稿'))).toBe(false)
  })

  it('不泄露 per-student 点评（即便标记 shared）', async () => {
    const notes = await getPortalLessonNotes(ctx)
    expect(notes.some((n) => n.body.includes('私密点评'))).toBe(false)
  })

  it('不泄露未关联学生（Z）所在班级的对外笔记（防越权）', async () => {
    const notes = await getPortalLessonNotes(ctx)
    expect(notes.some((n) => n.body.includes('别家对外笔记'))).toBe(false)
  })

  it('返回项带课程·班级标签与课节日期', async () => {
    const notes = await getPortalLessonNotes(ctx)
    expect(notes[0].sectionLabel).toContain('数学')
    expect(notes[0].lessonDate).toBe('2026-03-01')
  })
})
