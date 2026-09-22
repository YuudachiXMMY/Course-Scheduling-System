'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsSection, actorOwnsStudent } from '@/auth/scope'
import { db } from '@/db'
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
  // F1: object-level authz on studentId — owning the SECTION is not enough. The only DB constraint is the
  // (tenantId, studentId) composite FK, which guarantees same-tenant but NOT same-roster. Without this a
  // section teacher could enroll ANY same-tenant student (e.g. another teacher's private student), and the
  // enrollment then permanently grants that teacher visibility to the student's parent PII, reports,
  // exports, and the ability to mint a persistent /s/{token} share link. Require the student to already be
  // within the actor's scope (created by them, or actively enrolled in a section they teach). Mirrors the
  // B31 fix on the grade write path, which is exactly the ownership relation this "minting" gate depends on.
  if (!(await actorOwnsStudent(ctx, data.studentId))) throw new Error('无权添加该学生')

  // Cheap fast-return outside the transaction: a re-click on an already-active enrollment does nothing.
  const existing = await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.studentId, data.studentId), eq(enrollment.sectionId, data.sectionId)),
  )
  if (existing.some((e) => e.status === 'active')) {
    return existing.find((e) => e.status === 'active')!
  }

  // CR3: the capacity check-then-act was a race. Two concurrent enrollments of DIFFERENT students into a
  // section with one free seat both read count = capacity-1, both pass, and both write → over-capacity.
  // The partial unique index (uq_enrollment_student_section) only blocks the SAME student twice, and
  // ck_section_capacity only bounds the capacity COLUMN (1..15), not the active-row count. Serialize
  // same-section enrollers with an explicit transaction that first takes a row lock on the classSection
  // row (SELECT ... FOR UPDATE), then RE-COUNTS active enrollments inside the lock before writing.
  //
  // This is the FIRST explicit transaction outside the forTenant spine: forTenant exposes no tx helper,
  // so the queries below run on the raw `tx`. To preserve M1 tenant isolation, EVERY WHERE keeps
  // tenantId AND-ed in exactly as forTenant would. The lock only serializes enrollers of the SAME
  // section, so contention is minimal.
  const row = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ capacity: classSection.capacity })
      .from(classSection)
      .where(and(eq(classSection.tenantId, ctx.tenantId), eq(classSection.id, data.sectionId)))
      .for('update')
    if (!locked) throw new Error('班级不存在')

    // Re-read this (student, section) pair AFTER acquiring the lock so we observe any concurrent commit.
    const pairRows = await tx
      .select()
      .from(enrollment)
      .where(
        and(
          eq(enrollment.tenantId, ctx.tenantId),
          eq(enrollment.studentId, data.studentId),
          eq(enrollment.sectionId, data.sectionId),
        ),
      )
    const alreadyActive = pairRows.find((e) => e.status === 'active')
    if (alreadyActive) return alreadyActive

    // Re-count ACTIVE enrollments inside the lock — this is the check the FOR UPDATE serializes.
    const activeRows = await tx
      .select({ id: enrollment.id })
      .from(enrollment)
      .where(
        and(
          eq(enrollment.tenantId, ctx.tenantId),
          eq(enrollment.sectionId, data.sectionId),
          eq(enrollment.status, 'active'),
        ),
      )
    if (activeRows.length >= locked.capacity) {
      throw new Error(`班级已满（容量 ${locked.capacity}）`)
    }

    // Reactivate a previously-dropped row instead of inserting a duplicate.
    const reusable = pairRows.find((e) => e.status !== 'active')
    if (reusable) {
      const [r] = await tx
        .update(enrollment)
        .set({ status: 'active', droppedAt: null, enrolledAt: new Date() })
        .where(and(eq(enrollment.tenantId, ctx.tenantId), eq(enrollment.id, reusable.id)))
        .returning()
      return r
    }

    const [r] = await tx
      .insert(enrollment)
      .values({
        tenantId: ctx.tenantId,
        studentId: data.studentId,
        sectionId: data.sectionId,
        status: 'active',
      })
      .returning()
    return r
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
  // F1: same object-level authz as enrollStudent — a teacher may only drop a student already within their
  // scope, never a foreign-teacher student they merely guessed the id of.
  if (!(await actorOwnsStudent(ctx, data.studentId))) throw new Error('无权移除该学生')

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
