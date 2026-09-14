import 'server-only'
import { and, eq } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { portalLink } from '@/db/schema'
import type { AuthContext } from '@/auth/context'

// Phase 7a: parent/student are the "portal" roles — they log into /portal, not /dashboard.
export const PORTAL_ROLES = ['parent', 'student'] as const

// member.role may be comma-separated (Better Auth multi-role); match within the parsed list.
export function isPortalRole(role: string): boolean {
  const roles = role.split(',').map((r) => r.trim())
  return roles.some((r) => (PORTAL_ROLES as readonly string[]).includes(r))
}

// The student rows this authenticated user is linked to (P7a-5). Row-level scope is derived ONLY
// from portalLink keyed by the verified ctx.userId — never from a request param. forTenant already
// scopes by tenant, so the extra predicate is userId only.
export async function resolveLinkedStudentIds(ctx: AuthContext): Promise<string[]> {
  const rows = (await forTenant(ctx).select(
    portalLink,
    eq(portalLink.userId, ctx.userId),
  )) as (typeof portalLink.$inferSelect)[]
  return rows.map((r) => r.studentId)
}

// Ownership guard for the reschedule write path: the acting user must be linked to `studentId`.
export async function assertLinkedToStudent(ctx: AuthContext, studentId: string): Promise<void> {
  const rows = (await forTenant(ctx).select(
    portalLink,
    and(eq(portalLink.userId, ctx.userId), eq(portalLink.studentId, studentId)),
  )) as unknown[]
  if (rows.length === 0) throw new Error('无权访问该学生')
}
