import 'server-only'
import { notFound } from 'next/navigation'
import { orgRoles, type OrgRole, type Statements } from '@/auth/permissions'
import { AuthError, type AuthContext } from '@/auth/context'

export type PermissionRequest = { [R in keyof Statements]?: Statements[R][number][] }

// Mirrors Better Auth's internal hasPermission(): split comma-separated roles, authorize() each, any success grants.
export function can(role: string, permission: PermissionRequest): boolean {
  return role
    .split(',')
    .map((r) => r.trim())
    .some((name) => orgRoles[name as OrgRole]?.authorize(permission).success === true)
}
export function requirePermission(ctx: AuthContext, permission: PermissionRequest): void {
  if (ctx.isPlatformAdmin) return // cross-tenant operator bypasses tenant RBAC
  if (!can(ctx.role, permission)) throw new AuthError('FORBIDDEN')
}

// H9: page-level permission guard for Server Components. requirePermission THROWS AuthError, which in a
// page render lands on the generic dashboard/error.tsx whose "重试" reset() re-renders the same segment
// → re-throws → infinite loop; worse, prod redacts the thrown message so the boundary can't even detect
// it was a FORBIDDEN. notFound() is a framework INTERRUPT (not a thrown Error): identical in dev and
// prod, it lands on the nearest not-found boundary with no reset loop, and a 404 (vs 403) does not
// confirm the page exists to an unauthorized principal. Mirrors the teach/[sectionId] tree, which
// already guards cross-tenant/unauthorized access with notFound(). Use this in PAGES; keep
// requirePermission in Server Actions / data loaders (which catch AuthError and return it as data).
export function requirePagePermission(ctx: AuthContext, permission: PermissionRequest): void {
  if (ctx.isPlatformAdmin) return
  if (!can(ctx.role, permission)) notFound()
}
// For DYNAMIC roles later: await auth.api.hasPermission({ headers: await headers(), body: { permissions } })
