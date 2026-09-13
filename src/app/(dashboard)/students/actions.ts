'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'

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

export async function listStudents() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  return forTenant(ctx).select(student) // only THIS tenant's rows
}
