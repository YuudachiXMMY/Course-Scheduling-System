import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { classSection, enrollment } from '@/db/schema'
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
