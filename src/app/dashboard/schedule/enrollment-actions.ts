'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { enrollment, classSection } from '@/db/schema'

// P2-9: roster management maps to `course` permissions.
const enrollSchema = z.object({
  studentId: z.string().trim().min(1),
  sectionId: z.string().trim().min(1),
})

export async function enrollStudent(input: z.input<typeof enrollSchema>) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['update'] })
  const data = enrollSchema.parse(input)

  const section = (await forTenant(ctx).findById(classSection, data.sectionId)) as
    typeof classSection.$inferSelect | null
  if (!section) throw new Error('班级不存在')

  const existing = (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.studentId, data.studentId), eq(enrollment.sectionId, data.sectionId)),
  )) as (typeof enrollment.$inferSelect)[]

  if (existing.some((e) => e.status === 'active')) {
    return existing.find((e) => e.status === 'active')!
  }

  // Capacity check on ACTIVE enrollments (respect the partial-active unique index semantics).
  const activeRows = (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, data.sectionId), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  if (activeRows.length >= section.capacity) {
    throw new Error(`班级已满（容量 ${section.capacity}）`)
  }

  // Reactivate a previously-dropped row instead of inserting a duplicate.
  const reusable = existing.find((e) => e.status !== 'active')
  if (reusable) {
    const [row] = await forTenant(ctx).update(enrollment, reusable.id, {
      status: 'active',
      droppedAt: null,
      enrolledAt: new Date(),
    })
    revalidatePath('/dashboard/schedule')
    return row
  }

  const [row] = await forTenant(ctx).insert(enrollment, {
    studentId: data.studentId,
    sectionId: data.sectionId,
    status: 'active',
  })
  revalidatePath('/dashboard/schedule')
  return row
}

export async function unenrollStudent(input: z.input<typeof enrollSchema>) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['update'] })
  const data = enrollSchema.parse(input)

  const rows = (await forTenant(ctx).select(
    enrollment,
    and(
      eq(enrollment.studentId, data.studentId),
      eq(enrollment.sectionId, data.sectionId),
      eq(enrollment.status, 'active'),
    ),
  )) as (typeof enrollment.$inferSelect)[]
  for (const r of rows) {
    await forTenant(ctx).update(enrollment, r.id, { status: 'dropped', droppedAt: new Date() })
  }
  revalidatePath('/dashboard/schedule')
  return { dropped: rows.length }
}

export async function listSectionEnrollments(sectionId: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['read'] })
  return (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, sectionId), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
}
