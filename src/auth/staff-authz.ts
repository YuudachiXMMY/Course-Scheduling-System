import 'server-only'
import { AuthError, type AuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { isAdminRole } from '@/auth/roles'

// Tiered authorization for staff-account management (/dashboard/users teachers/admins tabs). Built on
// the two-universe AC model (see permissions.ts): the ORG role (member.role) governs day-to-day tenant
// business; the PLATFORM role (user.role='superadmin' → ctx.isPlatformAdmin) is the cross-tenant
// operator. "Only a super admin may touch admin/owner accounts" is expressed here, NOT in permissions.ts,
// because it is a rule about the TARGET's role, not the actor's own capability set.

// The self-hosting operator (platform superadmin). requirePermission already bypasses tenant RBAC for
// this flag; here it also gates the admin-tier management surface.
export function isSuperAdmin(ctx: AuthContext): boolean {
  return ctx.isPlatformAdmin
}

// Assert the actor `ctx` may manage an account whose role is `targetRole`:
//   - targetRole touches owner/admin  → SUPER ADMIN ONLY (a regular admin has NO write over admins);
//   - otherwise (teacher/assistant/parent/student) → any org manager (owner/admin, via member:create).
// When changing a role you MUST call this for BOTH the old and the new role, so a regular admin can
// neither touch an existing admin NOR promote a teacher INTO an admin.
export function assertCanManageRole(ctx: AuthContext, targetRole: string): void {
  if (isAdminRole(targetRole)) {
    if (!isSuperAdmin(ctx)) throw new AuthError('FORBIDDEN')
    return
  }
  requirePermission(ctx, { member: ['create'] })
}
