'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsSection } from '@/auth/scope'
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

  const section = await forTenant(ctx).findById(classSection, data.sectionId)
  if (!section) throw new Error('班级不存在')
  // 工作流 E: a teacher may only manage the roster of sections they teach (defence-in-depth — the UI
  // never offers a foreign section, but a direct action call must not enroll into another teacher's class).
  if (!actorOwnsSection(ctx, section)) throw new Error('无权管理该班级')

  const existing = await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.studentId, data.studentId), eq(enrollment.sectionId, data.sectionId)),
  )

  if (existing.some((e) => e.status === 'active')) {
    return existing.find((e) => e.status === 'active')!
  }

  // Capacity check on ACTIVE enrollments (respect the partial-active unique index semantics).
  const activeRows = await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, data.sectionId), eq(enrollment.status, 'active')),
  )
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

  // 工作流 E: same roster confinement as enrollStudent — a teacher may only drop students from their
  // own sections. A foreign (or cross-tenant) section id resolves to null → 404-equivalent no-op.
  const section = await forTenant(ctx).findById(classSection, data.sectionId)
  if (!section) throw new Error('班级不存在')
  if (!actorOwnsSection(ctx, section)) throw new Error('无权管理该班级')

  const rows = await forTenant(ctx).select(
    enrollment,
    and(
      eq(enrollment.studentId, data.studentId),
      eq(enrollment.sectionId, data.sectionId),
      eq(enrollment.status, 'active'),
    ),
  )
  for (const r of rows) {
    await forTenant(ctx).update(enrollment, r.id, { status: 'dropped', droppedAt: new Date() })
  }
  revalidatePath('/dashboard/schedule')
  return { dropped: rows.length }
}

export async function listSectionEnrollments(sectionId: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['read'] })
  // 工作流 E: a teacher may only read the roster of sections they teach. A foreign/cross-tenant id → [].
  const section = await forTenant(ctx).findById(classSection, sectionId)
  if (!section || !actorOwnsSection(ctx, section)) return []
  return await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, sectionId), eq(enrollment.status, 'active')),
  )
}
