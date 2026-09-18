import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  course,
  classSection,
  sectionMeeting,
  student,
  enrollment,
  lesson,
  note,
  attendance,
  grade,
} from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'

// 评审 Slice A — 读路径行级归属校验（BOLA/IDOR）。PR#36 收敛了写路径与两条 API 导出，但只读 Server Action
// (getLessonRoster/listAttendance/getLessonNotes/listSectionMeetings/getLessonMeta/getStudent) 仍只有
// requirePermission + forTenant（仅租户级），教师/门户账号可用任意同租户 id 越权读取他人班级数据。createSection
// 还允许 section-scoped 教师植入任意 teacherId；grade 写入不校验 studentId 是否在册。以下锁定新增守卫。

vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  getLessonRoster,
  listAttendance,
  getLessonNotes,
} from '@/app/dashboard/schedule/attendance-actions'
import { getLessonMeta } from '@/app/dashboard/schedule/actions'
import { listSectionMeetings, createSection } from '@/app/dashboard/courses/actions'
import { getStudent } from '@/app/dashboard/students/actions'
import { upsertLessonStudentGrade } from '@/app/dashboard/teach/[sectionId]/grade-actions'

const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)

const org = 'org_scope_reads'
const teacherA = 'u_ta_reads'
const teacherB = 'u_tb_reads'
const ownerId = 'u_owner_reads'

const sA1 = 's_a1_reads' // teacherA
const sB1 = 's_b1_reads' // teacherB
const stuA = 'stu_a_reads' // active in sA1
const stuB = 'stu_b_reads' // active in sB1
const lessonA1 = 'l_a1_reads' // in sA1 (teacherA)

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
  await db.delete(grade).where(eq(grade.tenantId, org))
  await db.delete(note).where(eq(note.tenantId, org))
  await db.delete(attendance).where(eq(attendance.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(sectionMeeting).where(eq(sectionMeeting.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
}

beforeAll(async () => {
  await cleanup()
  await db.insert(course).values({ id: 'c_reads', tenantId: org, title: '读路径课程' })
  await db.insert(classSection).values([
    { id: sA1, tenantId: org, courseId: 'c_reads', name: 'A1', teacherId: teacherA, capacity: 5 },
    { id: sB1, tenantId: org, courseId: 'c_reads', name: 'B1', teacherId: teacherB, capacity: 5 },
  ])
  await db.insert(sectionMeeting).values({
    tenantId: org,
    sectionId: sA1,
    byDay: 'MO',
    startTime: '09:00',
    durationMinutes: 60,
  })
  await db.insert(student).values([
    { id: stuA, tenantId: org, name: '学生A' },
    { id: stuB, tenantId: org, name: '学生B' },
  ])
  await db.insert(enrollment).values([
    { tenantId: org, studentId: stuA, sectionId: sA1, status: 'active' },
    { tenantId: org, studentId: stuB, sectionId: sB1, status: 'active' },
  ])
  await db.insert(lesson).values({
    id: lessonA1,
    tenantId: org,
    sectionId: sA1,
    teacherId: teacherA,
    startAt: new Date(),
    endAt: new Date(Date.now() + 3_600_000),
    status: 'scheduled',
    location: '教室 A',
    meetingUrl: 'https://meet.example.com/a',
    title: 'A 班第一课',
  })
  await db.insert(attendance).values({
    tenantId: org,
    lessonId: lessonA1,
    studentId: stuA,
    status: 'present',
    recordedBy: teacherA,
  })
  await db.insert(note).values({
    tenantId: org,
    lessonId: lessonA1,
    authorId: teacherA,
    body: '本课共享笔记',
    visibility: 'internal',
  })
})

afterAll(cleanup)

// ── B1/B2/B23 — 课节只读动作缺归属校验 ────────────────────────────────────────────────────────────────
describe('课节只读动作归属守卫 — attendance-actions', () => {
  it('getLessonRoster: 另一教师得到空名单；本班教师与 owner 拿到名单', async () => {
    asActor(teacherBCtx)
    expect(await getLessonRoster(lessonA1)).toEqual([])
    asActor(teacherACtx)
    expect((await getLessonRoster(lessonA1)).map((r) => r.studentId)).toEqual([stuA])
    asActor(ownerCtx)
    expect((await getLessonRoster(lessonA1)).length).toBe(1)
  })

  it('listAttendance: 另一教师得到空；本班教师拿到记录', async () => {
    asActor(teacherBCtx)
    expect(await listAttendance(lessonA1)).toEqual([])
    asActor(teacherACtx)
    expect((await listAttendance(lessonA1)).length).toBeGreaterThan(0)
  })

  it('getLessonNotes: 另一教师得到空笔记；本班教师拿到共享笔记', async () => {
    asActor(teacherBCtx)
    expect(await getLessonNotes(lessonA1)).toEqual({ shared: '', perStudent: {} })
    asActor(teacherACtx)
    expect((await getLessonNotes(lessonA1)).shared).toBe('本课共享笔记')
  })
})

// ── B21 — getLessonMeta 泄露地点/会议链接/标题 ────────────────────────────────────────────────────────
describe('课节元数据归属守卫 — schedule/actions getLessonMeta', () => {
  it('另一教师得到 null；本班教师拿到元数据', async () => {
    asActor(teacherBCtx)
    expect(await getLessonMeta(lessonA1)).toBeNull()
    asActor(teacherACtx)
    expect(await getLessonMeta(lessonA1)).not.toBeNull()
  })
})

// ── B9 — listSectionMeetings 泄露任意班级排课 ─────────────────────────────────────────────────────────
describe('班级排课归属守卫 — courses/actions listSectionMeetings', () => {
  it('另一教师得到空；本班教师与 owner 拿到时段', async () => {
    asActor(teacherBCtx)
    expect(await listSectionMeetings(sA1)).toEqual([])
    asActor(teacherACtx)
    expect((await listSectionMeetings(sA1)).length).toBeGreaterThan(0)
    asActor(ownerCtx)
    expect((await listSectionMeetings(sA1)).length).toBeGreaterThan(0)
  })
})

// ── B26 — getStudent 缺逐教师归属校验 ─────────────────────────────────────────────────────────────────
describe('学生读取归属守卫 — students/actions getStudent', () => {
  it('另一教师得到 null；本班教师拿到学生', async () => {
    asActor(teacherBCtx)
    expect(await getStudent(stuA)).toBeNull()
    asActor(teacherACtx)
    expect((await getStudent(stuA))?.id).toBe(stuA)
  })
})

// ── B8/B15 — createSection 允许植入任意 teacherId ─────────────────────────────────────────────────────
describe('班级创建归属守卫 — courses/actions createSection', () => {
  it('section-scoped 教师植入他人 teacherId 时被强制归属自己', async () => {
    asActor(teacherBCtx)
    const res = await createSection({
      courseId: 'c_reads',
      teacherId: teacherA, // 试图挂到 teacherA 名下
      capacity: 5,
      meetings: [{ byDay: 'TU', startTime: '10:00', durationMinutes: 60 }],
      termStartDate: '2026-03-01',
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.section.teacherId).toBe(teacherB)
  })
})

// ── B31 — 成绩写入缺 studentId 对象级授权 ─────────────────────────────────────────────────────────────
describe('成绩写入对象级授权 — grade-actions upsertLessonStudentGrade', () => {
  it('本班教师给不在该课节班级在册的学生录成绩被拒', async () => {
    asActor(teacherACtx)
    await expect(
      upsertLessonStudentGrade({ lessonId: lessonA1, studentId: stuB, score: 90 }),
    ).rejects.toThrow('该学生不在该课节班级')
  })

  it('本班教师给在册学生录成绩成功', async () => {
    asActor(teacherACtx)
    const row = await upsertLessonStudentGrade({ lessonId: lessonA1, studentId: stuA, score: 88 })
    expect(row).toBeTruthy()
  })
})
