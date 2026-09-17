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

export async function createStudent(input: CreateStudentInput) {
  const ctx = await requireAuthContext() // 1) verified principal + tenant (ignore any client orgId)
  requirePermission(ctx, { student: ['create'] }) // 2) RBAC guard at the top
  const data = createStudentSchema.parse(input) // 3) validate + trim before persisting
  const [row] = await forTenant(ctx).insert(student, {
    // 4) tenant-scoped write (tenantId injected from ctx)
    name: data.name,
    parentWechat: data.parentWechat,
    schoolGrade: data.schoolGrade,
  })
  revalidatePath('/dashboard/students')
  return row
}

export async function listStudents(): Promise<Student[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  // 工作流 E: a teacher sees only students actively enrolled in the sections they teach; whole-tenant
  // staff see every student. This centralizes the confinement, so every caller (users tabs, courses
  // page, the section roster picker) inherits it.
  const scope = await studentIdsForActor(ctx)
  if (scope === 'all') return (await forTenant(ctx).select(student)) as Student[] // only THIS tenant's rows
  if (scope.length === 0) return []
  return (await forTenant(ctx).select(student, inArray(student.id, scope))) as Student[]
}

export async function getStudent(id: string): Promise<Student | null> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['read'] })
  return (await forTenant(ctx).findById(student, id)) as Student | null
}

const updateStudentSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(100),
  parentWechat: z.string().trim().max(100).optional(),
  schoolGrade: z.string().trim().max(50).optional(),
})
export type UpdateStudentInput = z.input<typeof updateStudentSchema>

export async function updateStudent(id: string, input: UpdateStudentInput) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['update'] })
  // 工作流 E: a section-scoped teacher may only edit a student they teach.
  if (!(await actorOwnsStudent(ctx, id))) throw new Error('无权修改该学生')
  const data = updateStudentSchema.parse(input)
  const [row] = await forTenant(ctx).update(student, id, {
    name: data.name,
    parentWechat: data.parentWechat,
    schoolGrade: data.schoolGrade,
  })
  revalidatePath('/dashboard/students')
  return row
}

// Soft-delete only: attendance/grade FKs are onDelete('restrict') — a hard delete would throw.
export async function archiveStudent(id: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['update'] })
  if (!(await actorOwnsStudent(ctx, id))) throw new Error('无权归档该学生')
  const [row] = await forTenant(ctx).update(student, id, { status: 'archived' })
  revalidatePath('/dashboard/students')
  return row
}

// Un-archive: mirror of archiveStudent so a soft-deleted student can be brought back to active.
export async function restoreStudent(id: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['update'] })
  if (!(await actorOwnsStudent(ctx, id))) throw new Error('无权恢复该学生')
  const [row] = await forTenant(ctx).update(student, id, { status: 'active' })
  revalidatePath('/dashboard/students')
  return row
}
