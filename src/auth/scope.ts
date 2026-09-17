import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { classSection, enrollment, lesson } from '@/db/schema'
import { hasWholeTenantRole, isSectionScopedRole } from '@/auth/roles'
import type { AuthContext } from '@/auth/context'

// 工作流 E — 教师本班收敛. Two-universe recap (permissions.ts): org roles run tenant business and the
// platform superadmin bypasses tenant RBAC. On TOP of tenant isolation (forTenant is the only sanctioned
// tenant-scoped path), a plain teacher is further confined to the sections they teach
// (classSection.teacherId === their user id) and, by extension, the students actively enrolled in those
// sections. owner/admin/assistant and the platform superadmin still manage the whole tenant.
//
// The scope helpers return 'all' (no section/student restriction) OR the explicit id list. An EMPTY list
// means "this actor sees nothing" — callers MUST short-circuit before inArray([]) (invalid SQL; the
// existing code already guards this, see schedule/data.ts and teach/[sectionId]/data.ts).

// Whole-tenant actor: the cross-tenant operator, or any member holding owner/admin/assistant.
export function isWholeTenantActor(ctx: AuthContext): boolean {
  return ctx.isPlatformAdmin || hasWholeTenantRole(ctx.role)
}

// Whether the actor may open a specific section's workspace. Whole-tenant staff → always; a teacher →
// only sections they teach. Takes an already-loaded section row so the per-section guard adds no query —
// getSectionHeader() calls it, gating the whole /dashboard/teach/[sectionId] route via its layout so a
// teacher who guesses a foreign (same-tenant) section id gets notFound(), not another teacher's class.
export function actorOwnsSection(ctx: AuthContext, section: { teacherId: string | null }): boolean {
  return isWholeTenantActor(ctx) || section.teacherId === ctx.userId
}

// The section ids this actor may see: 'all' for whole-tenant staff, else exactly the teacher's own
// sections. A section-scoped actor with no sections (or a portal/unknown role reaching here) → [].
export async function sectionIdsForActor(ctx: AuthContext): Promise<'all' | string[]> {
  if (isWholeTenantActor(ctx)) return 'all'
  if (!isSectionScopedRole(ctx.role)) return [] // defensive: portal/unknown role → see nothing
  const rows = (await forTenant(ctx).select(
    classSection,
    eq(classSection.teacherId, ctx.userId),
  )) as (typeof classSection.$inferSelect)[]
  return rows.map((r) => r.id)
}

// The student ids this actor may see: 'all', else the students ACTIVELY enrolled in the actor's sections.
// Derived from sectionIdsForActor so section- and student-scope share one source of truth.
export async function studentIdsForActor(ctx: AuthContext): Promise<'all' | string[]> {
  const sections = await sectionIdsForActor(ctx)
  if (sections === 'all') return 'all'
  if (sections.length === 0) return []
  const enrolls = (await forTenant(ctx).select(
    enrollment,
    and(inArray(enrollment.sectionId, sections), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  return [...new Set(enrolls.map((e) => e.studentId))]
}

// Whether the actor may act on ONE specific student: whole-tenant staff → always; a teacher → only a
// student ACTIVELY enrolled in a section they teach. Derived from studentIdsForActor so it shares the
// same source of truth as the collection scope. Used by the per-student API export routes and the
// per-student write paths (share token minting, student edits) that bypass the RSC layout guard and so
// must enforce ownership themselves — mirrors actorOwnsSection for the single-section case.
export async function actorOwnsStudent(ctx: AuthContext, studentId: string): Promise<boolean> {
  const students = await studentIdsForActor(ctx)
  return students === 'all' || students.includes(studentId)
}

// id-keyed ownership for the WRITE paths that only receive a sectionId (cancelSeriesAction,
// updateSection, materializeSectionAction). Whole-tenant staff bypass without a query; a section-scoped
// teacher loads the section and checks teacherId. A missing/foreign section → false (caller throws or
// 404s), so a guessed same-tenant sectionId can never mutate another teacher's class.
export async function actorOwnsSectionById(ctx: AuthContext, sectionId: string): Promise<boolean> {
  if (isWholeTenantActor(ctx)) return true
  const section = (await forTenant(ctx).findById(classSection, sectionId)) as
    | typeof classSection.$inferSelect
    | null
  return !!section && actorOwnsSection(ctx, section)
}

// id-keyed ownership for the WRITE paths that only receive a lessonId (cancelLessonAction,
// updateLessonAction, attendance/note/grade upserts). lesson.teacherId is denormalized from the
// section, so ownership is the same teacherId === ctx.userId test. A missing/foreign lesson → false.
export async function actorOwnsLesson(ctx: AuthContext, lessonId: string): Promise<boolean> {
  if (isWholeTenantActor(ctx)) return true
  const row = (await forTenant(ctx).findById(lesson, lessonId)) as
    | typeof lesson.$inferSelect
    | null
  return !!row && actorOwnsSection(ctx, { teacherId: row.teacherId })
}
