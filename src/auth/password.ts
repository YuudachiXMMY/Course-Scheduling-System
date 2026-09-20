import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db'
import { member, account, session } from '@/db/schema'
import { assertCanManageRole } from '@/auth/staff-authz'
import { MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE } from '@/auth/password-policy'
import type { AuthContext } from '@/auth/context'

// Admin "帮忙重置密码" core. Headless like staff.ts (setStaffRoleCore / deactivateStaffCore): the admin
// plugin's auth.api.setUserPassword requires a LIVE super-admin session (headers) and gates on the
// platform 'superadmin' role — neither holds for an org owner/admin acting through a Server Action. So we
// reproduce what that endpoint does internally, headlessly:
//   1) hash the new password with better-auth's own hasher (auth.$context.password.hash) so the stored
//      format matches what login verifies against;
//   2) write it onto the target's credential account row directly;
//   3) delete the target's sessions so the OLD password (and any live login) dies immediately — mirrors
//      deactivateStaffCore, since Better Auth only re-checks credentials at login, not on getSession.
// Tenancy + tiered RBAC guard the target exactly like the staff cores: the target must be a member of the
// acting org, and assertCanManageRole reserves admin/owner targets for a super admin while still requiring
// member:create for everyone else (so a non-manager ctx is refused even for a portal target).
const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE)

export async function resetUserPasswordCore(
  ctx: AuthContext,
  targetUserId: string,
  newPassword: string,
): Promise<void> {
  // safeParse (not .parse) so a too-short password surfaces the clean Chinese message rather than a
  // raw serialized ZodError — staff-actions.ts returns e.message verbatim and the control renders it.
  // Mirrors account-actions.ts / provisionPortalAccount's boundary validation.
  const parsed = newPasswordSchema.safeParse(newPassword)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? PASSWORD_MIN_MESSAGE)
  const password = parsed.data

  // Self-guard (mirrors setStaffRoleCore / deactivateStaffCore): the admin-reset path skips the
  // current-password check by design, so it must NEVER target the actor themselves — otherwise a
  // platform superadmin (whose own org role is admin-tier, so assertCanManageRole would pass) could
  // rotate their OWN password from a hijacked live session with no current-password proof, turning a
  // stolen session into permanent account takeover. Changing your own password goes through
  // changeOwnPassword, which verifies the current password.
  if (targetUserId === ctx.userId) {
    throw new Error('不能通过管理界面重置自己的密码，请使用「修改密码」')
  }

  // Target must be a member of THIS org (cross-tenant guard, same as requireStaffTarget / linkPortalUserCore).
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, targetUserId), eq(member.organizationId, ctx.tenantId)))
    .limit(1)
  if (!m) throw new Error('该用户不属于本机构')

  // Tiered authorization: admin/owner targets are super-admin-only; every other role needs member:create.
  // This is the ONE gate that also covers portal targets (assertCanManageRole → requirePermission).
  assertCanManageRole(ctx, m.role)

  // Locate the credential (email+password) account. A portal login minted via createUser always has one;
  // an OAuth-only / never-provisioned user would not — refuse rather than silently no-op.
  const [acct] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, targetUserId), eq(account.providerId, 'credential')))
    .limit(1)
  if (!acct) throw new Error('该账号无法重置密码，可能尚未设置登录凭据')

  const authCtx = await auth.$context
  const hash = await authCtx.password.hash(password)

  // Write the hash and revoke live sessions in ONE transaction so the reset is atomic: the old password is
  // dead the instant the new one lands (no window where both work, and no orphaned live session).
  await db.transaction(async (tx) => {
    await tx.update(account).set({ password: hash }).where(eq(account.id, acct.id))
    await tx.delete(session).where(eq(session.userId, targetUserId))
  })
}
