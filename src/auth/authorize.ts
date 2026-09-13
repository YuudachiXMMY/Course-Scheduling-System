import 'server-only'
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
// For DYNAMIC roles later: await auth.api.hasPermission({ headers: await headers(), body: { permissions } })
