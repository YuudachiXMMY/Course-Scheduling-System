'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'

export async function createStudent(input: {
  name: string
  parentWechat?: string
  schoolGrade?: string
}) {
  const ctx = await requireAuthContext() // 1) verified principal + tenant (ignore any client orgId)
  requirePermission(ctx, { student: ['create'] }) // 2) RBAC guard at the top
  const [row] = await forTenant(ctx).insert(student, {
    // 3) tenant-scoped write (tenantId injected from ctx)
    name: input.name,
    parentWechat: input.parentWechat,
    schoolGrade: input.schoolGrade,
  })
  revalidatePath('/dashboard/students')
  return row
}

export async function listStudents() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['list'] })
  return forTenant(ctx).select(student) // only THIS tenant's rows
}
