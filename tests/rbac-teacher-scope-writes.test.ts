import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  course,
  classSection,
  student,
  enrollment,
  lesson,
  progressReport,
  rescheduleRequest,
  shareLink,
  note,
  attendance,
  grade,
} from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { actorOwnsStudent, actorOwnsLesson, actorOwnsSectionById } from '@/auth/scope'

// 工作流 E — review follow-up (PR #36): the PR closed READ scoping + the roster write path + two API
// export routes, but left the broad WRITE surface (scheduling, share-token minting, student edits,
// attendance/notes/grades, section config, reports, the reschedule review queue) guarded by tenant+RBAC
// ONLY. A plain teacher holds create/update on all of those, so every mutation keyed on a caller-supplied
// id was a teacher-exploitable IDOR against another teacher's data in the same tenant. These lock the
// per-section / per-student ownership guard now added to each of those paths.

// The 'use server' actions call requireAuthContext() (session cookies) internally — override ONLY that
// export (importActual preserves AuthError so requirePermission still works) to drive them as a chosen
// principal. The library cores (schedule-core / report-core / reschedule-core) take a ctx directly.
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
// revalidatePath throws outside a request store; the guards reject before reaching it, but stub it so any
// allow-path assertion can't blow up on the cache call.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { scheduleLessonCore } from '@/lib/schedule-core'
import {
  cancelLessonAction,
  updateLessonAction,
  cancelSeriesAction,
} from '@/app/dashboard/schedule/actions'
import { getOrCreateShare, rotateShare, revokeShare } from '@/app/dashboard/students/share-actions'
import { updateStudent, archiveStudent, restoreStudent } from '@/app/dashboard/students/actions'
import {
  upsertAttendance,
  upsertSharedNote,
  upsertStudentNote,
} from '@/app/dashboard/schedule/attendance-actions'
import { upsertLessonStudentGrade } from '@/app/dashboard/teach/[sectionId]/grade-actions'
import { updateSection, materializeSectionAction } from '@/app/dashboard/courses/actions'
import {
  createReportDraftCore,
  updateReportNarrativeCore,
  approveReportCore,
  getReportViewModel,
} from '@/lib/report-core'
import {
  approveRescheduleRequestCore,
  rejectRescheduleRequestCore,
} from '@/lib/reschedule-core'
import { listRescheduleRequests } from '@/app/dashboard/reschedule/data'

const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)

const org = 'org_teacher_writes'
const teacherA = 'u_teacher_a_writes'
const teacherB = 'u_teacher_b_writes'
const ownerId = 'u_owner_writes'

const sA1 = 's_a1_writes' // teacherA
const sB1 = 's_b1_writes' // teacherB
const stuA = 'stu_a_writes' // active in sA1
const stuB = 'stu_b_writes' // active in sB1
const lessonA1 = 'l_a1_writes' // in sA1 (teacherA)
const lessonB1 = 'l_b1_writes' // in sB1 (teacherB)
const reportA = 'rpt_a_writes' // studentId = stuA
const reportB = 'rpt_b_writes' // studentId = stuB
const reqA = 'req_a_writes' // reschedule request against lessonA1 (teacherA)
const reqB = 'req_b_writes' // reschedule request against lessonB1 (teacherB)

const ctxFor = (userId: string, role: string, isPlatformAdmin = false): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin,
})
const teacherACtx = ctxFor(teacherA, 'teacher')
const teacherBCtx = ctxFor(teacherB, 'teacher')
const ownerCtx = ctxFor(ownerId, 'owner')

const cleanup = async () => {
  await db.delete(rescheduleRequest).where(eq(rescheduleRequest.tenantId, org))
  await db.delete(progressReport).where(eq(progressReport.tenantId, org))
  await db.delete(shareLink).where(eq(shareLink.tenantId, org))
  await db.delete(grade).where(eq(grade.tenantId, org))
  await db.delete(note).where(eq(note.tenantId, org))
  await db.delete(attendance).where(eq(attendance.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
}

beforeAll(async () => {
  await cleanup()
  await db.insert(course).values({ id: 'c_writes', tenantId: org, title: '写路径课程' })
  await db.insert(classSection).values([
    { id: sA1, tenantId: org, courseId: 'c_writes', name: 'A1', teacherId: teacherA, capacity: 5 },
    { id: sB1, tenantId: org, courseId: 'c_writes', name: 'B1', teacherId: teacherB, capacity: 5 },
  ])
  await db.insert(student).values([
    { id: stuA, tenantId: org, name: '学生A' },
    { id: stuB, tenantId: org, name: '学生B' },
  ])
  await db.insert(enrollment).values([
    { tenantId: org, studentId: stuA, sectionId: sA1, status: 'active' },
    { tenantId: org, studentId: stuB, sectionId: sB1, status: 'active' },
  ])
  await db.insert(lesson).values([
    {
      id: lessonA1,
      tenantId: org,
      sectionId: sA1,
      teacherId: teacherA,
      startAt: new Date(),
      endAt: new Date(Date.now() + 3_600_000),
      status: 'scheduled',
    },
    {
      id: lessonB1,
      tenantId: org,
      sectionId: sB1,
      teacherId: teacherB,
      startAt: new Date(),
      endAt: new Date(Date.now() + 3_600_000),
      status: 'scheduled',
    },
  ])
  await db.insert(progressReport).values([
    { id: reportA, tenantId: org, studentId: stuA, sectionId: sA1, rubricVersion: 'v1', status: 'draft' },
    { id: reportB, tenantId: org, studentId: stuB, sectionId: sB1, rubricVersion: 'v1', status: 'draft' },
  ])
  await db.insert(rescheduleRequest).values([
    {
      id: reqA,
      tenantId: org,
      lessonId: lessonA1,
      studentId: stuA,
      requestedStartAt: new Date(Date.now() + 86_400_000),
      requestedEndAt: new Date(Date.now() + 90_000_000),
      status: 'pending',
    },
    {
      id: reqB,
      tenantId: org,
      lessonId: lessonB1,
      studentId: stuB,
      requestedStartAt: new Date(Date.now() + 86_400_000),
      requestedEndAt: new Date(Date.now() + 90_000_000),
      status: 'pending',
    },
  ])
})

afterAll(cleanup)

// ── id-keyed ownership primitives ────────────────────────────────────────────────────────────────────
describe('actorOwnsStudent / actorOwnsLesson / actorOwnsSectionById — id 键归属原语', () => {
  it('a teacher owns only their own student / lesson / section', async () => {
    expect(await actorOwnsStudent(teacherACtx, stuA)).toBe(true)
    expect(await actorOwnsStudent(teacherACtx, stuB)).toBe(false)
    expect(await actorOwnsLesson(teacherACtx, lessonA1)).toBe(true)
    expect(await actorOwnsLesson(teacherACtx, lessonB1)).toBe(false)
    expect(await actorOwnsSectionById(teacherACtx, sA1)).toBe(true)
    expect(await actorOwnsSectionById(teacherACtx, sB1)).toBe(false)
  })

  it('a missing/foreign id is not owned (never throws)', async () => {
    expect(await actorOwnsLesson(teacherACtx, 'nope')).toBe(false)
    expect(await actorOwnsSectionById(teacherACtx, 'nope')).toBe(false)
  })

  it('whole-tenant staff (owner) own every student / lesson / section', async () => {
    expect(await actorOwnsStudent(ownerCtx, stuB)).toBe(true)
    expect(await actorOwnsLesson(ownerCtx, lessonB1)).toBe(true)
    expect(await actorOwnsSectionById(ownerCtx, sB1)).toBe(true)
  })
})

// ── HIGH — per-student export / report PDF ────────────────────────────────────────────────────────────
describe('导出/报告 PDF 归属守卫（HIGH）— getReportViewModel', () => {
  it('a teacher gets null for a report whose student is not in a section they teach (→ route 404)', async () => {
    expect(await getReportViewModel(teacherBCtx, reportA, '2026-01-01 00:00')).toBeNull()
  })

  it('the owning teacher and whole-tenant staff resolve the view-model', async () => {
    expect(await getReportViewModel(teacherACtx, reportA, '2026-01-01 00:00')).not.toBeNull()
    expect(await getReportViewModel(ownerCtx, reportA, '2026-01-01 00:00')).not.toBeNull()
  })
})

// ── MEDIUM 1 — the residual write-path IDOR surface ───────────────────────────────────────────────────
describe('调度写路径归属守卫（MEDIUM 1）— schedule-core / schedule actions', () => {
  it('scheduleLessonCore refuses to schedule into another teacher’s section', async () => {
    await expect(
      scheduleLessonCore(teacherBCtx, {
        sectionId: sA1,
        startAt: new Date(Date.now() + 200_000_000),
        endAt: new Date(Date.now() + 203_600_000),
      }),
    ).rejects.toThrow('无权在该班级排课')
  })

  it('cancelLessonAction / updateLessonAction refuse another teacher’s lesson', async () => {
    asActor(teacherBCtx)
    await expect(cancelLessonAction(lessonA1)).rejects.toThrow('无权取消该课节')
    expect(await updateLessonAction({ id: lessonA1, location: 'X' })).toEqual({
      ok: false,
      error: '无权修改该课节',
    })
  })

  it('cancelSeriesAction refuses to bulk-cancel another teacher’s section', async () => {
    asActor(teacherBCtx)
    await expect(cancelSeriesAction(sA1)).rejects.toThrow('无权取消该班级排课')
  })
})

describe('分享 token 铸造归属守卫（MEDIUM 1）— share-actions', () => {
  it('getOrCreateShare / rotateShare / revokeShare refuse another teacher’s student', async () => {
    asActor(teacherBCtx)
    await expect(getOrCreateShare(stuA)).rejects.toThrow('无权分享该学生课表')
    await expect(rotateShare(stuA)).rejects.toThrow('无权分享该学生课表')
    await expect(revokeShare(stuA)).rejects.toThrow('无权分享该学生课表')
  })
})

describe('学生编辑归属守卫（MEDIUM 1）— students/actions', () => {
  it('updateStudent / archiveStudent / restoreStudent refuse another teacher’s student', async () => {
    asActor(teacherBCtx)
    await expect(updateStudent(stuA, { name: 'hacked' })).rejects.toThrow('无权修改该学生')
    await expect(archiveStudent(stuA)).rejects.toThrow('无权归档该学生')
    await expect(restoreStudent(stuA)).rejects.toThrow('无权恢复该学生')
  })
})

describe('考勤/笔记/成绩写路径归属守卫（MEDIUM 1）— attendance / grade actions', () => {
  it('attendance / note / grade upserts refuse another teacher’s lesson', async () => {
    asActor(teacherBCtx)
    await expect(
      upsertAttendance({ lessonId: lessonA1, studentId: stuA, status: 'present' }),
    ).rejects.toThrow('无权记录该课节考勤')
    await expect(upsertSharedNote({ lessonId: lessonA1, body: 'x' })).rejects.toThrow(
      '无权编辑该课节笔记',
    )
    await expect(
      upsertStudentNote({ lessonId: lessonA1, studentId: stuA, body: 'x' }),
    ).rejects.toThrow('无权编辑该课节点评')
    await expect(
      upsertLessonStudentGrade({ lessonId: lessonA1, studentId: stuA, score: 90 }),
    ).rejects.toThrow('无权录入该课节成绩')
  })
})

describe('班级配置写路径归属守卫（MEDIUM 1）— courses/actions', () => {
  it('updateSection refuses another teacher’s section (and never wipes its future lessons)', async () => {
    asActor(teacherBCtx)
    const res = await updateSection(sA1, {
      courseId: 'c_writes',
      name: 'A1-hacked',
      meetings: [],
    } as unknown as Parameters<typeof updateSection>[1])
    expect(res).toEqual({ ok: false, error: '无权修改该班级' })
  })

  it('materializeSectionAction refuses another teacher’s section', async () => {
    asActor(teacherBCtx)
    await expect(materializeSectionAction(sA1)).rejects.toThrow('无权生成该班级课节')
  })
})

describe('报告写路径归属守卫（MEDIUM 1）— report-core', () => {
  it('create / update / approve refuse a report whose student is not in a section the teacher teaches', async () => {
    await expect(
      createReportDraftCore(teacherBCtx, {
        studentId: stuA,
        periodStart: new Date(),
        periodEnd: new Date(),
      }),
    ).rejects.toThrow('无权为该学生创建报告')
    await expect(updateReportNarrativeCore(teacherBCtx, reportA, 'x')).rejects.toThrow(
      '无权修改该报告',
    )
    await expect(approveReportCore(teacherBCtx, reportA)).rejects.toThrow('无权定稿该报告')
  })
})

// ── MEDIUM 2 — reschedule review queue ────────────────────────────────────────────────────────────────
describe('改期审批队列归属守卫（MEDIUM 2）— reschedule-core / data', () => {
  it('approve / reject refuse a request against another teacher’s lesson', async () => {
    await expect(approveRescheduleRequestCore(teacherBCtx, reqA)).rejects.toThrow('无权处理该申请')
    await expect(rejectRescheduleRequestCore(teacherBCtx, reqA)).rejects.toThrow('无权处理该申请')
  })

  it('the pending queue is scoped to the reviewer’s own lessons; owner sees the whole tenant', async () => {
    const aIds = (await listRescheduleRequests(teacherACtx)).map((r) => r.id)
    expect(aIds).toContain(reqA)
    expect(aIds).not.toContain(reqB)

    const bIds = (await listRescheduleRequests(teacherBCtx)).map((r) => r.id)
    expect(bIds).toContain(reqB)
    expect(bIds).not.toContain(reqA)

    const ownerIds = (await listRescheduleRequests(ownerCtx)).map((r) => r.id)
    expect(ownerIds).toEqual(expect.arrayContaining([reqA, reqB]))
  })
})
