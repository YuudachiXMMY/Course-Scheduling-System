import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, student, enrollment, lesson, grade, note } from '@/db/schema'
import { getReportData } from '@/lib/report-data'
import type { AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// 评审 Slice H —— 报告数据正确性/隐私。
// B51: 报告按"当前 active 在册"取数，遗漏报告周期内曾在册但已转班/结课的班级数据。
// B50: internal 可见性教师笔记被喂入面向家长的 AI 叙述；只有 shared 笔记才应外呈。
const org = 'org_report_scope'
const teacher = 'u_teacher_rs'
const stu = 'stu_rs'
const sX = 's_x_rs' // 报告窗口内已 dropped 的班级
const sY = 's_y_rs' // 当前 active 班级
const lesX = 'l_x_rs'

const from = new Date('2026-01-01T00:00:00Z')
const to = new Date('2026-03-31T23:59:59Z')
const ctx: AuthContext = { tenantId: org, userId: teacher, role: 'owner', isPlatformAdmin: false }

const cleanup = async () => {
  await db.delete(grade).where(eq(grade.tenantId, org))
  await db.delete(note).where(eq(note.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await unseedOrg(org)
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(org)
  await db.insert(course).values({ id: 'c_rs', tenantId: org, title: '报告课程' })
  await db.insert(classSection).values([
    { id: sX, tenantId: org, courseId: 'c_rs', name: 'X', teacherId: teacher, capacity: 5 },
    { id: sY, tenantId: org, courseId: 'c_rs', name: 'Y', teacherId: teacher, capacity: 5 },
  ])
  await db.insert(student).values({ id: stu, tenantId: org, name: '学生RS' })
  await db.insert(enrollment).values([
    // 报告窗口内曾在册后转出（overlap: enrolledAt < to, droppedAt > from）
    {
      tenantId: org,
      studentId: stu,
      sectionId: sX,
      status: 'dropped',
      enrolledAt: new Date('2025-12-01T00:00:00Z'),
      droppedAt: new Date('2026-02-01T00:00:00Z'),
    },
    // 当前仍活跃
    {
      tenantId: org,
      studentId: stu,
      sectionId: sY,
      status: 'active',
      enrolledAt: new Date('2026-01-01T00:00:00Z'),
    },
  ])
  await db.insert(lesson).values({
    id: lesX,
    tenantId: org,
    sectionId: sX,
    teacherId: teacher,
    startAt: new Date('2026-01-15T09:00:00Z'),
    endAt: new Date('2026-01-15T10:00:00Z'),
    status: 'scheduled',
  })
  await db
    .insert(grade)
    .values({ tenantId: org, studentId: stu, lessonId: lesX, title: '期中', score: '90' })
  await db.insert(note).values([
    {
      tenantId: org,
      studentId: stu,
      authorId: teacher,
      body: '内部备注勿外传',
      visibility: 'internal',
    },
    {
      tenantId: org,
      studentId: stu,
      authorId: teacher,
      body: '家长可见评语',
      visibility: 'shared',
    },
  ])
})

afterAll(cleanup)

describe('getReportData — 报告周期在册 (B51) 与笔记可见性 (B50)', () => {
  it('B51: 纳入报告窗口内曾在册（后转出）班级的成绩', async () => {
    const data = await getReportData(ctx, stu, { from, to })
    expect(data.grades.map((g) => g.title)).toContain('期中')
  })

  it('B50: 只把 shared 笔记送入报告，internal 笔记被排除', async () => {
    const data = await getReportData(ctx, stu, { from, to })
    expect(data.notes).toContain('家长可见评语')
    expect(data.notes).not.toContain('内部备注勿外传')
  })
})
