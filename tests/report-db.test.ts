import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
  organization,
  member,
  user,
  course,
  classSection,
  enrollment,
  lesson,
  attendance,
  grade,
  student,
  progressReport,
} from '@/db/schema'
import { forTenant } from '@/db/tenant'
import type { AuthContext } from '@/auth/context'

// Mock ONLY the Claude call — the DB path stays real. draftNarrative returns a fixed narrative so
// the lifecycle is deterministic and no API is hit.
vi.mock('@/lib/report-draft', () => ({
  draftNarrative: vi.fn(async () => ({
    narrative: 'AI 叙述测试',
    model: 'test-model',
    rubricVersion: 'v1',
  })),
}))

import { getReportData } from '@/lib/report-data'
import {
  createReportDraftCore,
  updateReportNarrativeCore,
  approveReportCore,
  getReportViewModel,
} from '@/lib/report-core'

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_report'
const otherOrg = 'org_report_other'
const userId = 'user_report'
const teacherId = userId
const at = (h: number) => new Date(Date.UTC(2026, 2, 10, h)) // 2026-03-10 (inside window)
const WINDOW = { from: new Date(Date.UTC(2026, 2, 1)), to: new Date(Date.UTC(2026, 2, 31, 23)) }

let sectionId: string
let studentId: string
let l1: string
let l2: string

const cleanup = async () => {
  for (const t of [org, otherOrg]) {
    await db.delete(progressReport).where(eq(progressReport.tenantId, t))
    await db.delete(grade).where(eq(grade.tenantId, t))
    await db.delete(attendance).where(eq(attendance.tenantId, t))
    await db.delete(lesson).where(eq(lesson.tenantId, t))
    await db.delete(enrollment).where(eq(enrollment.tenantId, t))
    await db.delete(classSection).where(eq(classSection.tenantId, t))
    await db.delete(course).where(eq(course.tenantId, t))
    await db.delete(student).where(eq(student.tenantId, t))
  }
  await db.delete(member).where(inArray(member.organizationId, [org, otherOrg]))
  await db.delete(organization).where(inArray(organization.id, [org, otherOrg]))
  await db.delete(user).where(inArray(user.id, [userId]))
}

describe('progress reports — DB integration (report-core + report-data)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([
      { id: org, name: 'R', slug: 'r-report', createdAt: now },
      { id: otherOrg, name: 'R2', slug: 'r-report-2', createdAt: now },
    ])
    await db.insert(user).values([{ id: userId, name: 'T', email: 'r@t.com', emailVerified: true }])
    await db
      .insert(member)
      .values([{ id: 'm_report', organizationId: org, userId, role: 'owner', createdAt: now }])

    const ctx = ctxFor(org, userId)
    const [c] = (await forTenant(ctx).insert(course, { title: '数学' })) as { id: string }[]
    const [sec] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 1,
    })) as { id: string }[]
    sectionId = sec.id
    const [st] = (await forTenant(ctx).insert(student, {
      name: '测试学生',
      schoolGrade: '初二',
    })) as { id: string }[]
    studentId = st.id
    await forTenant(ctx).insert(enrollment, { studentId, sectionId, status: 'active' })

    const [le1] = (await forTenant(ctx).insert(lesson, {
      sectionId,
      teacherId,
      startAt: at(10),
      endAt: at(11),
    })) as { id: string }[]
    const [le2] = (await forTenant(ctx).insert(lesson, {
      sectionId,
      teacherId,
      startAt: at(12),
      endAt: at(13),
    })) as { id: string }[]
    l1 = le1.id
    l2 = le2.id
    await forTenant(ctx).insert(attendance, { lessonId: l1, studentId, status: 'present' })
    await forTenant(ctx).insert(attendance, { lessonId: l2, studentId, status: 'absent' })
    await forTenant(ctx).insert(grade, { studentId, lessonId: l1, title: '月考', score: '85.00' })
  })
  afterAll(cleanup)

  it('getReportData aggregates attendance/grades from the DB (numbers, not from the LLM)', async () => {
    const data = await getReportData(ctxFor(org, userId), studentId, WINDOW)
    expect(data.studentName).toBe('测试学生')
    expect(data.attendance).toMatchObject({ total: 2, present: 1, absent: 1, rate: 0.5 })
    expect(data.grades).toHaveLength(1)
    expect(data.grades[0]).toMatchObject({ title: '月考', score: 85 }) // '85.00' string → 85
    expect(data.gradeAverage).toBe(85)
  })

  it('createReportDraftCore inserts a draft with the (mocked) narrative', async () => {
    const ctx = ctxFor(org, userId)
    const row = await createReportDraftCore(ctx, {
      studentId,
      periodStart: WINDOW.from,
      periodEnd: WINDOW.to,
      title: '3月报告',
    })
    expect(row.status).toBe('draft')
    expect(row.narrative).toBe('AI 叙述测试')
    expect(row.rubricVersion).toBe('v1')
  })

  it('draft narrative is editable; approve locks it (update after approve throws)', async () => {
    const ctx = ctxFor(org, userId)
    const draft = await createReportDraftCore(ctx, {
      studentId,
      periodStart: WINDOW.from,
      periodEnd: WINDOW.to,
    })
    const edited = await updateReportNarrativeCore(ctx, draft.id, '教师修改后的叙述')
    expect(edited.narrative).toBe('教师修改后的叙述')

    const approved = await approveReportCore(ctx, draft.id)
    expect(approved.status).toBe('approved')
    expect(approved.approvedBy).toBe(userId)
    expect(approved.approvedAt).toBeInstanceOf(Date)

    await expect(updateReportNarrativeCore(ctx, draft.id, '再改一次')).rejects.toThrow('已定稿')
    await expect(approveReportCore(ctx, draft.id)).rejects.toThrow('已定稿')
  })

  it('section-level (per-term) grades are bounded by the period window (M2)', async () => {
    const ctx = ctxFor(org, userId)
    // in-window term grade (no lesson) — should appear
    await forTenant(ctx).insert(grade, {
      studentId,
      sectionId,
      title: '期中',
      score: '90.00',
      gradedAt: at(9),
    })
    // out-of-window term grade (February, before the March window) — must NOT appear
    await forTenant(ctx).insert(grade, {
      studentId,
      sectionId,
      title: '寒假摸底',
      score: '50.00',
      gradedAt: new Date(Date.UTC(2026, 1, 1)),
    })
    const data = await getReportData(ctx, studentId, WINDOW)
    const titles = data.grades.map((g) => g.title)
    expect(titles).toContain('期中')
    expect(titles).not.toContain('寒假摸底')
  })

  it('approved report freezes its numbers — later grade edits do not change the PDF (M1)', async () => {
    const ctx = ctxFor(org, userId)
    const draft = await createReportDraftCore(ctx, {
      studentId,
      periodStart: WINDOW.from,
      periodEnd: WINDOW.to,
    })
    const liveBefore = await getReportData(ctx, studentId, WINDOW)
    const approved = await approveReportCore(ctx, draft.id)
    expect(approved.statsSnapshot).toBeTruthy()

    // A new in-window grade recorded AFTER approval: live recompute sees it, the snapshot must not.
    await forTenant(ctx).insert(grade, {
      studentId,
      lessonId: l1,
      title: '补测',
      score: '77.00',
      gradedAt: at(9),
    })
    const liveAfter = await getReportData(ctx, studentId, WINDOW)
    expect(liveAfter.grades.length).toBe(liveBefore.grades.length + 1) // live changed

    const vm = await getReportViewModel(ctx, draft.id, '2026-03-31 00:00')
    expect(vm?.status).toBe('approved')
    expect(vm?.grades.length).toBe(liveBefore.grades.length) // snapshot frozen at approval
  })

  it('tenant isolation: another tenant cannot read/mutate this report', async () => {
    const ownerCtx = ctxFor(org, userId)
    const draft = await createReportDraftCore(ownerCtx, {
      studentId,
      periodStart: WINDOW.from,
      periodEnd: WINDOW.to,
    })
    const otherCtx = ctxFor(otherOrg, 'ghost')
    const seen = (await forTenant(otherCtx).findById(progressReport, draft.id)) as unknown
    expect(seen).toBeNull()
    await expect(updateReportNarrativeCore(otherCtx, draft.id, 'x')).rejects.toThrow('报告不存在')
  })
})
