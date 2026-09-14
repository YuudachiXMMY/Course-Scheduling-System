import 'server-only'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db'
import { user as userTable, member, account, student, portalLink } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { env } from '@/env'
import type { AuthContext } from '@/auth/context'

// Phase 7a — provision a parent/student login (P7a-1). Two trusted server calls under the hood:
//   1) auth.api.createUser — mints a credential (email+password) user. Called WITHOUT headers, which
//      is an allowed trusted server op in Better Auth 1.7.4. The user.create.after hook is branched
//      (P7a-2) to NOT self-tenant the '/admin/create-user' path, so this user gets no junk org.
//   2) auth.api.addMember — adds that user to the tutor's org with role 'parent'/'student'
//      (server-only, no email/invite). Its single membership makes session.create.before resolve
//      the correct activeOrganizationId at login.
//
// M3: server actions are a public boundary — validate/normalize every field before it hits the DB.
export const provisionSchema = z.object({
  studentId: z.string().trim().min(1),
  name: z.string().trim().min(1, '姓名不能为空').max(100),
  kind: z.enum(['parent', 'student']),
  loginId: z.string().trim().max(100).optional(), // optional real email; else a placeholder is synthesized
  password: z.string().min(8, '密码至少 8 位'),
})
export type ProvisionPortalInput = z.input<typeof provisionSchema>

// Full teardown of a freshly-minted portal user (member + credential account + user). Used as the
// compensating action when a later step in a provision fails, so a partial failure never leaves an
// orphaned auth user that could sign in but see nothing. member/account cascade on user delete, but
// we delete explicitly (child → parent) to stay independent of the cascade config. Wrapped in ONE
// transaction so a mid-teardown failure can't leave a half-deleted (sign-in-capable) orphan — the
// exact state the no-orphan guarantee promises to prevent.
//
// CONTRACT: only ever call this with a userId this process just minted (a single-membership user
// reached via the createUser path). It deletes ALL of that user's memberships by bare userId (no
// tenant scope), so passing a pre-existing/reused id would wrongly tear down a real cross-org account.
export async function deprovisionPortalMember(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(member).where(eq(member.userId, userId))
    await tx.delete(account).where(eq(account.userId, userId))
    await tx.delete(userTable).where(eq(userTable.id, userId))
  })
}

// Resolve (or mint) the org member for `email`. `email` is the natural identity of the login:
//   - Already a user AND already a member of THIS org  → reuse it (e.g. a real-email parent being
//     linked to a SECOND child). Idempotent, no new account.
//   - Already a user but NOT in this org               → REFUSE ('该邮箱已被其他账号占用'). Never
//     attach a foreign existing account to this tenant by email — that would be cross-tenant
//     membership injection (an org could pull in any user by guessing their email, no consent).
//   - Not a user yet                                   → createUser + addMember, and if addMember
//     fails, delete the just-created user (compensation → no orphan).
// `created` tells the caller whether IT is responsible for tearing this user down on a later failure.
export async function provisionPortalMember(args: {
  name: string
  email: string
  password: string
  orgId: string
  orgRole: 'parent' | 'student'
}): Promise<{ userId: string; created: boolean }> {
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, args.email))
    .limit(1)

  if (existing) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, existing.id), eq(member.organizationId, args.orgId)))
      .limit(1)
    if (!m) throw new Error('该邮箱已被其他账号占用')
    return { userId: existing.id, created: false } // already in this org → reuse (multi-child parent)
  }

  const createdUser = await auth.api.createUser({
    body: { email: args.email, password: args.password, name: args.name },
  })
  const userId = createdUser.user.id
  try {
    await auth.api.addMember({
      body: { userId, role: args.orgRole, organizationId: args.orgId },
    })
  } catch (e) {
    await deprovisionPortalMember(userId) // roll back the createUser so no orphan user survives
    throw e
  }
  return { userId, created: true }
}

// Headless core (takes a resolved ctx; no requireAuthContext / revalidatePath — those live in the
// thin Server Action, so this stays testable like report-core / reschedule-core). Provisions a
// parent/student login for a student and links it. Returns the login email to hand to the family
// (synthesized for WeChat-only, no-email parents). Idempotent + atomic:
//   - re-provisioning the same (email, student) is a safe no-op (the link already exists);
//   - one real-email parent can be linked to many children (reuses the member, adds a new link);
//   - if the link insert fails after minting a NEW user, that user is torn down (no orphan).
export async function provisionPortalAccountCore(
  ctx: AuthContext,
  input: ProvisionPortalInput,
): Promise<{ userId: string; email: string }> {
  const data = provisionSchema.parse(input)

  const s = (await forTenant(ctx).findById(student, data.studentId)) as
    typeof student.$inferSelect | null
  if (!s) throw new Error('学生不存在')

  const email =
    data.loginId && data.loginId.includes('@')
      ? data.loginId.toLowerCase()
      : `portal_${nanoid()}@${env.PORTAL_EMAIL_DOMAIN}`

  const { userId, created } = await provisionPortalMember({
    name: data.name,
    email,
    password: data.password,
    orgId: ctx.tenantId,
    orgRole: data.kind,
  })

  try {
    // Idempotent link (tenant-scoped write; tenantId injected by forTenant). Skip if the
    // (tenant, student, user) link already exists — a retry or same-child re-provision is a no-op.
    const linked = (await forTenant(ctx).select(
      portalLink,
      and(eq(portalLink.studentId, data.studentId), eq(portalLink.userId, userId)),
    )) as unknown[]
    if (linked.length === 0) {
      await forTenant(ctx).insert(portalLink, {
        studentId: data.studentId,
        userId,
        relationship: data.kind,
      })
    }
  } catch (e) {
    if (created) await deprovisionPortalMember(userId) // compensate only what THIS call minted
    throw e
  }

  return { userId, email }
}
