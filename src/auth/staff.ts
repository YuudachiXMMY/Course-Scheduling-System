import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db'
import { user as userTable, member, session } from '@/db/schema'
import { deprovisionPortalMember } from '@/auth/provision'
import { assertCanManageRole } from '@/auth/staff-authz'
import { STAFF_ROLES } from '@/auth/roles'
import { MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE } from '@/auth/password-policy'
import type { AuthContext } from '@/auth/context'

// Staff-account cores for /dashboard/users (teachers/admins tabs). Headless like provision.ts: each takes
// a resolved ctx and does the tenancy + tiered-RBAC guards + DB writes, but NO requireAuthContext /
// revalidatePath (those live in the thin Server Actions), so they stay unit-testable.
//
// WHY DIRECT DB WRITES for role change / ban (not auth.api.updateMemberRole / banUser): those admin &
// organization endpoints require a LIVE admin session (headers). A core must be callable from tests and
// sessionless contexts — exactly the constraint seed-admin.ts hit when it set user.role by hand. So:
//   - role change → write member.role directly;
//   - deactivate  → write user.banned=true AND delete the target's sessions (see deactivateStaffCore).
// createUser + addMember stay as auth.api.* — they are Better Auth's only headerless-callable trusted ops.

// Staff creation is limited to teacher/assistant/admin (owner is seed-only, never minted through the UI).
const STAFF_CREATE_KINDS = ['teacher', 'assistant', 'admin'] as const
const createStaffSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(100),
  email: z.string().trim().email('请输入有效邮箱').max(100),
  password: z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_MIN_MESSAGE),
  role: z.enum(STAFF_CREATE_KINDS),
})
export type CreateStaffInput = z.input<typeof createStaffSchema>

// Resolve the target's membership in the acting tenant (cross-tenant guard) and return its role. A
// targetUserId that is not a member of THIS org is refused — the same "no cross-tenant reach" rule as
// linkPortalUserCore.
async function requireStaffTarget(ctx: AuthContext, targetUserId: string): Promise<string> {
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, targetUserId), eq(member.organizationId, ctx.tenantId)))
    .limit(1)
  if (!m) throw new Error('该用户不属于本机构')
  return m.role
}

// B39: count the org's USABLE owners (comma-multi aware; a banned owner cannot sign in, so it does not
// count) WHILE holding a row lock, INSIDE the caller's transaction. `SELECT ... FOR UPDATE` on the org's
// member rows serialises concurrent demote/deactivate calls: without it two requests each read ">1",
// both pass the guard, and both commit — leaving the tenant with zero usable owners (recoverable only
// via the seed). Joining user lets deactivate (which flips user.banned, NOT member.role) also converge:
// the second txn, unblocked after the first commits, sees the freshly-banned owner and refuses.
async function lockUsableOwnerCount(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
): Promise<number> {
  const rows = await tx
    .select({ role: member.role, banned: userTable.banned })
    .from(member)
    .innerJoin(userTable, eq(member.userId, userTable.id))
    .where(eq(member.organizationId, tenantId))
    .for('update')
  return rows.filter(
    (r) =>
      !r.banned &&
      r.role
        .split(',')
        .map((x) => x.trim())
        .includes('owner'),
  ).length
}

const roleList = (role: string) => role.split(',').map((r) => r.trim())

// Create a staff login (teacher/assistant/admin) as a member of the acting org. Tiered RBAC: minting an
// `admin` requires a super admin (assertCanManageRole). Unlike portal provisioning, a colliding email is
// REFUSED loudly (never silently reused) — a staff login must be a fresh account so the operator is never
// told a password was set on an account they didn't touch (the PR#32/A MEDIUM lesson).
export async function createStaffUserCore(
  ctx: AuthContext,
  input: CreateStaffInput,
): Promise<{ userId: string }> {
  const data = createStaffSchema.parse(input)
  assertCanManageRole(ctx, data.role)
  const email = data.email.toLowerCase()

  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1)
  if (existing) throw new Error('该邮箱已被占用')

  const createdUser = await auth.api.createUser({
    body: { email, password: data.password, name: data.name },
  })
  const userId = createdUser.user.id
  try {
    await auth.api.addMember({ body: { userId, role: data.role, organizationId: ctx.tenantId } })
  } catch (e) {
    await deprovisionPortalMember(userId) // roll back the just-minted user → no orphan (same teardown as portal)
    throw e
  }
  return { userId }
}

// Change a staff member's org role. Guards, in order: cannot change your OWN role; target must be in-org;
// the actor must be able to manage BOTH the old and the new role (so a regular admin can neither touch an
// existing admin nor promote a teacher into one); and the org's last owner may not be demoted.
export async function setStaffRoleCore(
  ctx: AuthContext,
  targetUserId: string,
  newRole: string,
): Promise<void> {
  if (targetUserId === ctx.userId) throw new Error('不能修改自己的角色')
  if (!(STAFF_ROLES as readonly string[]).includes(newRole)) throw new Error('无效的角色')
  // AZ4: owner is seed-only (staff.ts header). STAFF_ROLES includes 'owner', so even a platform
  // superadmin could otherwise promote a member to owner and mint a 2nd owner via the API. Gate the
  // TARGET role only — demoting an existing owner (oldRole=owner → admin) must still work, so this
  // guards promotion TO owner, never owner demotion/deactivation (still behind the last-owner lock).
  if (newRole === 'owner') throw new Error('负责人为初始化专用角色，不能通过管理界面授予')
  const oldRole = await requireStaffTarget(ctx, targetUserId)
  assertCanManageRole(ctx, oldRole)
  assertCanManageRole(ctx, newRole)

  const wasOwner = roleList(oldRole).includes('owner')
  const staysOwner = roleList(newRole).includes('owner')
  // B39: count-then-write is one transaction with a row lock so a concurrent demote/deactivate can't
  // also read ">1" and strand the tenant at zero usable owners.
  await db.transaction(async (tx) => {
    if (wasOwner && !staysOwner && (await lockUsableOwnerCount(tx, ctx.tenantId)) <= 1) {
      throw new Error('不能降级唯一的负责人')
    }
    await tx
      .update(member)
      .set({ role: newRole })
      .where(and(eq(member.userId, targetUserId), eq(member.organizationId, ctx.tenantId)))
  })
}

// Deactivate (ban, reversible) a staff account. Guards: not self, in-org, manageable role, not the last
// owner. Ban + revoke live sessions in ONE transaction so the lock-out is IMMEDIATE: Better Auth checks
// `banned` only in the session.create.before hook (login), NOT on getSession, so setting banned alone
// would let an already-signed-in user coast until their session expired. Deleting the session rows is
// exactly what auth.api.banUser does under the hood (deleteUserSessions) — this replicates it headlessly.
export async function deactivateStaffCore(ctx: AuthContext, targetUserId: string): Promise<void> {
  if (targetUserId === ctx.userId) throw new Error('不能停用自己')
  const role = await requireStaffTarget(ctx, targetUserId)
  assertCanManageRole(ctx, role)
  // B39: the last-usable-owner check, the ban, and the session revocation are ONE transaction with a
  // row lock (lockUsableOwnerCount). Deactivate flips user.banned rather than member.role, so the lock +
  // the banned-aware count are what make two concurrent deactivations converge instead of both banning.
  await db.transaction(async (tx) => {
    if (roleList(role).includes('owner') && (await lockUsableOwnerCount(tx, ctx.tenantId)) <= 1) {
      throw new Error('不能停用唯一的负责人')
    }
    // L-auth: deactivate flips the GLOBAL user.banned flag and deletes ALL of the user's sessions, so a
    // user who is staff in more than one org would be locked out of the OTHER orgs too (cross-org
    // overreach). Refuse for multi-org users — mirrors deprovisionPortalMember's memberships>1 guard.
    // A per-org membership removal is the fuller fix (deferred); refusing is the safe minimal one.
    const memberships = await tx
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, targetUserId))
    if (memberships.length > 1) {
      throw new Error('该用户属于多个机构，不能通过停用（全局封禁）操作；请改用移除成员')
    }
    await tx
      .update(userTable)
      .set({ banned: true, banReason: '管理员停用', banExpires: null })
      .where(eq(userTable.id, targetUserId))
    await tx.delete(session).where(eq(session.userId, targetUserId))
  })
}

// Re-enable a previously deactivated staff account. Same in-org + manageable-role guards; clears the ban
// columns. The user must sign in again (their sessions were deleted on deactivate).
export async function reactivateStaffCore(ctx: AuthContext, targetUserId: string): Promise<void> {
  const role = await requireStaffTarget(ctx, targetUserId)
  assertCanManageRole(ctx, role)
  await db
    .update(userTable)
    .set({ banned: false, banReason: null, banExpires: null })
    .where(eq(userTable.id, targetUserId))
}
