import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, student, enrollment, lesson, attendance } from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// 功能1 —— 教务工作台内联出勤提交。验证 upsertTeachAttendance（薄 wrapper，复用 schedule 的
// upsertAttendance）写库后，getSectionLessonNotes 批量加载器把 attendance 并入 LessonNoteRow，
// 且再次标注同一 (lesson, student) 走 upsert 更新（uq_attendance_lesson_student）。
//
// upsertTeachAttendance → upsertAttendance 调用 requireAuthContext()（session cookies）——只 mock 该
// 导出（importActual 保留 AuthError 供 requirePermission 使用）以指定发起主体；库读取层
// getSectionLessonNotes 直接吃 ctx。next/cache 的 revalidatePath 在请求上下文外会抛错，stub 掉。
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { upsertTeachAttendance } from '@/app/dashboard/teach/[sectionId]/attendance-actions'
import { upsertAttendance } from '@/app/dashboard/schedule/attendance-actions'
import { getSectionLessonNotes } from '@/app/dashboard/teach/[sectionId]/data'

const org = 'org_teach_att'
const teacher = 'u_teacher_ta'
const stu = 'stu_ta'
const sec = 's_ta'
const les = 'l_ta'

const ctx: AuthContext = { tenantId: org, userId: teacher, role: 'owner', isPlatformAdmin: false }

const cleanup = async () => {
  await db.delete(attendance).where(eq(attendance.tenantId, org))
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
  vi.mocked(requireAuthContext).mockResolvedValue(ctx)
  await db.insert(course).values({ id: 'c_ta', tenantId: org, title: '出勤课程' })
  await db
    .insert(classSection)
    .values({ id: sec, tenantId: org, courseId: 'c_ta', name: 'A', teacherId: teacher, capacity: 5 })
  await db.insert(student).values({ id: stu, tenantId: org, name: '学生TA' })
  await db.insert(enrollment).values({
    tenantId: org,
    studentId: stu,
    sectionId: sec,
    status: 'active',
    enrolledAt: new Date('2026-01-01T00:00:00Z'),
  })
  await db.insert(lesson).values({
    id: les,
    tenantId: org,
    sectionId: sec,
    teacherId: teacher,
    startAt: new Date('2026-01-15T09:00:00Z'),
    endAt: new Date('2026-01-15T10:00:00Z'),
    status: 'scheduled',
  })
})

afterAll(cleanup)

describe('教务工作台内联出勤 —— upsertTeachAttendance + getSectionLessonNotes', () => {
  it('标 present 后 LessonNoteRow.attendance 含 {studentId: present}', async () => {
    await upsertTeachAttendance({ lessonId: les, studentId: stu, status: 'present' })
    const notes = await getSectionLessonNotes(ctx, [les])
    expect(notes[les]?.attendance).toEqual({ [stu]: 'present' })
  })

  it('再标 absent → upsert 更新为 absent（每 (lesson, student) 仅一行）', async () => {
    await upsertTeachAttendance({ lessonId: les, studentId: stu, status: 'absent' })
    const notes = await getSectionLessonNotes(ctx, [les])
    expect(notes[les]?.attendance).toEqual({ [stu]: 'absent' })
    const rows = await db.select().from(attendance).where(eq(attendance.lessonId, les))
    expect(rows).toHaveLength(1)
  })

  // 回归：teach wrapper 不传 note，更新只写 status。锁定"改状态不清空排课抽屉已录备注"——该属性
  // 完全依赖 forTenant.update → drizzle .set() 跳过 undefined 字段。若底层某天改成显式写 null 就会
  // 静默丢备注，这条测试会红。先经 schedule upsertAttendance 写入带 note 的行，再经 teach 改 status。
  it('teach 改状态不清空 schedule 已录的出勤备注', async () => {
    await upsertAttendance({ lessonId: les, studentId: stu, status: 'present', note: '家长已知会请假' })
    await upsertTeachAttendance({ lessonId: les, studentId: stu, status: 'late' })
    const rows = await db.select().from(attendance).where(eq(attendance.lessonId, les))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('late')
    expect(rows[0]?.note).toBe('家长已知会请假')
  })
})
