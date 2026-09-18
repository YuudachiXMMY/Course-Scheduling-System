'use server'

import { z } from 'zod'
import { inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsStudent, studentIdsForActor } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'

export type Student = typeof student.$inferSelect

// M3: server actions are a public boundary — validate/normalize every field before it hits the DB.
const createStudentSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(100),
  parentWechat: z.string().trim().max(100).optional(),
  schoolGrade: z.string().trim().max(50).optional(),
})
export type CreateStudentInput = z.input<typeof createStudentSchema>

// P7b-review B29: Server Actions 是公共边界。Next.js 生产会脱敏「抛出」的 Server Action 错误消息
// （React #441），中文业务错误（'无权修改该学生' 等）与 zod 校验错误会退化成通用文案，前端拿不到
// 可读原因。改为把成功/失败都作为 DATA 返回（判别式联合），镜像同目录 portal-actions.ts 的
// ProvisionResult —— 授权/校验语义不变，只把「抛」改成「返回 {ok:false,error}」，让错误文案原样抵达表单。
export type StudentResult = { ok: true; row: Student } | { ok: false; error: string }

export async function createStudent(input: CreateStudentInput): Promise<StudentResult> {
  const ctx = await requireAuthContext() // 1) verified principal + tenant (ignore any client orgId)
  requirePermission(ctx, { student: ['create'] }) // 2) RBAC guard at the top
  const parsed = createStudentSchema.safeParse(input) // 3) validate + trim before persisting
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  const [row] = await forTenant(ctx).insert(student, {
    // 4) tenant-scoped write (tenantId injected from ctx)
    name: parsed.data.name,
    parentWechat: parsed.data.parentWechat,
    schoolGrade: parsed.data.schoolGrade,
    // AZ3: stamp the creator so a section-scoped teacher can still see/edit/enroll a student they
    // create (their new student has no enrollment yet; scope.ts unions createdBy === ctx.userId).
    createdBy: ctx.userId,
  })
  revalidatePath('/dashboard/users')
  return { ok: true, row }
}

export async function listStudents(): Promise<Student[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  // 工作流 E: a teacher sees only students actively enrolled in the sections they teach; whole-tenant
  // staff see every student. This centralizes the confinement, so every caller (users tabs, courses
  // page, the section roster picker) inherits it.
  const scope = await studentIdsForActor(ctx)
  if (scope === 'all') return await forTenant(ctx).select(student) // only THIS tenant's rows
  if (scope.length === 0) return []
  return await forTenant(ctx).select(student, inArray(student.id, scope))
}

export async function getStudent(id: string): Promise<Student | null> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['read'] })
  // 工作流 E: mirror updateStudent/archiveStudent — a section-scoped teacher may only read a student
  // enrolled in a section they teach, never any same-tenant student's name/parentWechat/schoolGrade.
  if (!(await actorOwnsStudent(ctx, id))) return null
  return await forTenant(ctx).findById(student, id)
}

const updateStudentSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(100),
  parentWechat: z.string().trim().max(100).optional(),
  schoolGrade: z.string().trim().max(50).optional(),
})
export type UpdateStudentInput = z.input<typeof updateStudentSchema>

export async function updateStudent(id: string, input: UpdateStudentInput): Promise<StudentResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['update'] })
  // 工作流 E: a section-scoped teacher may only edit a student they teach.
  if (!(await actorOwnsStudent(ctx, id))) return { ok: false, error: '无权修改该学生' }
  const parsed = updateStudentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  const [row] = await forTenant(ctx).update(student, id, {
    name: parsed.data.name,
    parentWechat: parsed.data.parentWechat,
    schoolGrade: parsed.data.schoolGrade,
  })
  revalidatePath('/dashboard/users')
  return { ok: true, row }
}

// Soft-delete only: attendance/grade FKs are onDelete('restrict') — a hard delete would throw.
export async function archiveStudent(id: string): Promise<StudentResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['update'] })
  if (!(await actorOwnsStudent(ctx, id))) return { ok: false, error: '无权归档该学生' }
  const [row] = await forTenant(ctx).update(student, id, { status: 'archived' })
  revalidatePath('/dashboard/users')
  return { ok: true, row }
}

// Un-archive: mirror of archiveStudent so a soft-deleted student can be brought back to active.
export async function restoreStudent(id: string): Promise<StudentResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['update'] })
  if (!(await actorOwnsStudent(ctx, id))) return { ok: false, error: '无权恢复该学生' }
  const [row] = await forTenant(ctx).update(student, id, { status: 'active' })
  revalidatePath('/dashboard/users')
  return { ok: true, row }
}
