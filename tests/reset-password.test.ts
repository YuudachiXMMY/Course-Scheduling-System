import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray, like, or } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, account, session } from '@/db/schema'
import { auth } from '@/auth/auth'
import type { AuthContext } from '@/auth/context'
import { resetUserPasswordCore } from '@/auth/password'

// Admin "帮忙重置密码" (orch-change-feature). Headless like staff.ts (no live admin session): hash via
// auth.$context.password.hash, write account.password directly, then revoke the target's sessions so the
// old password is dead immediately. Tiered like assertCanManageRole — a regular manager may reset a
// portal/teacher login but NOT an admin/owner (super-admin only). Proven against a live DB.
const org = 'org_reset_pw'
const orgOther = 'org_reset_pw_other'
const seedOwnerId = 'u_seed_owner_reset'
const REAL_EMAILS = [
  'seedowner_reset@x.com',
  'portal_reset_target@x.com',
  'admin_reset_target@x.com',
  'nocred_reset@x.com',
  'other_reset@x.com',
]

const ctxFor = (
  tenantId: string,
  userId: string,
  role = 'owner',
  isPlatformAdmin = false,
): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin,
})
const ownerCtx = () => ctxFor(org, seedOwnerId, 'owner')
const superCtx = () => ctxFor(org, seedOwnerId, 'owner', true)

const tracked: string[] = []

const verifyPassword = async (userId: string, password: string): Promise<boolean> => {
  const [acct] = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1)
  if (!acct?.password) return false
  const c = await auth.$context
  return c.password.verify({ hash: acct.password, password })
}

const cleanup = async () => {
  const junk = await db
    .select({ id: user.id })
    .from(user)
    .where(
      or(
        inArray(user.email, REAL_EMAILS),
        like(user.email, '%_reset@x.com'), // every minted target ends with this suffix
        like(user.email, 'portal_%@portal.local'),
        inArray(user.id, [seedOwnerId, ...tracked]),
      ),
    )
  const ids = [...new Set(junk.map((u) => u.id))]
  if (ids.length) {
    await db.delete(session).where(inArray(session.userId, ids))
    await db.delete(member).where(inArray(member.userId, ids))
    await db.delete(account).where(inArray(account.userId, ids))
    await db.delete(user).where(inArray(user.id, ids))
  }
  await db.delete(member).where(inArray(member.organizationId, [org, orgOther]))
  await db.delete(organization).where(inArray(organization.id, [org, orgOther]))
}

// Mint a credential user (has an account row with a password) and add it to `orgId` with `role`.
const mintMember = async (email: string, role: string, orgId: string): Promise<string> => {
  const created = await auth.api.createUser({
    body: { email, password: 'initial-password-123', name: email },
  })
  const userId = created.user.id
  tracked.push(userId)
  await auth.api.addMember({
    body: {
      userId,
      role: role as 'parent' | 'student' | 'admin' | 'teacher' | 'assistant',
      organizationId: orgId,
    },
  })
  return userId
}

describe('resetUserPasswordCore — admin password reset (DB integration)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([
      { id: org, name: 'Reset', slug: 'reset-pw', createdAt: now },
      { id: orgOther, name: 'Other', slug: 'reset-pw-other', createdAt: now },
    ])
    await db
      .insert(user)
      .values([
        { id: seedOwnerId, name: 'Owner', email: 'seedowner_reset@x.com', emailVerified: true },
      ])
    await db
      .insert(member)
      .values([
        {
          id: 'm_seed_owner_reset',
          organizationId: org,
          userId: seedOwnerId,
          role: 'owner',
          createdAt: now,
        },
      ])
  })
  afterAll(cleanup)

  it('resets a portal login: the new password verifies, the old one no longer does', async () => {
    const target = await mintMember('portal1_reset@x.com', 'parent', org)
    expect(await verifyPassword(target, 'initial-password-123')).toBe(true)

    await resetUserPasswordCore(ownerCtx(), target, 'a-brand-new-password-456')

    expect(await verifyPassword(target, 'a-brand-new-password-456')).toBe(true)
    expect(await verifyPassword(target, 'initial-password-123')).toBe(false)
  })

  it("revokes the target's live sessions so the old login is dead immediately", async () => {
    const target = await mintMember('portal2_reset@x.com', 'parent', org)
    await db.insert(session).values({
      id: 'sess_reset_target',
      userId: target,
      token: 'tok_reset_target',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await resetUserPasswordCore(ownerCtx(), target, 'another-new-password-789')
    const rows = await db.select().from(session).where(eq(session.userId, target))
    expect(rows).toHaveLength(0)
  })

  it('refuses a target from ANOTHER org (no cross-tenant reach)', async () => {
    const outsider = await mintMember('other_reset@x.com', 'parent', orgOther)
    await expect(resetUserPasswordCore(ownerCtx(), outsider, 'x-new-password-000')).rejects.toThrow(
      '该用户不属于本机构',
    )
    // password untouched
    expect(await verifyPassword(outsider, 'initial-password-123')).toBe(true)
  })

  it('a regular manager may NOT reset an admin-tier account; a super admin may', async () => {
    const adminTarget = await mintMember('admin_reset_target@x.com', 'admin', org)
    // regular owner/admin manager (not platform super) → refused
    await expect(
      resetUserPasswordCore(ownerCtx(), adminTarget, 'nope-password-123'),
    ).rejects.toThrow()
    expect(await verifyPassword(adminTarget, 'initial-password-123')).toBe(true)
    // super admin → allowed
    await resetUserPasswordCore(superCtx(), adminTarget, 'super-set-password-123')
    expect(await verifyPassword(adminTarget, 'super-set-password-123')).toBe(true)
  })

  it("refuses to reset the actor's OWN password (self-target bypasses the current-password check)", async () => {
    // superCtx passes assertCanManageRole for an admin-tier self target, so only the explicit self-guard
    // stops a session-hijack → self-reset. It throws before the credential lookup, so seedOwner (no
    // credential row) still surfaces the self message.
    await expect(
      resetUserPasswordCore(superCtx(), seedOwnerId, 'self-reset-attempt-123'),
    ).rejects.toThrow('不能通过管理界面重置自己的密码')
  })

  it('throws when the target has no credential account to reset', async () => {
    const uid = 'u_nocred_reset'
    tracked.push(uid)
    await db
      .insert(user)
      .values({ id: uid, name: 'NoCred', email: 'nocred_reset@x.com', emailVerified: true })
    await db
      .insert(member)
      .values({
        id: 'm_nocred_reset',
        organizationId: org,
        userId: uid,
        role: 'parent',
        createdAt: new Date(),
      })
    await expect(resetUserPasswordCore(ownerCtx(), uid, 'whatever-password-123')).rejects.toThrow(
      '该账号无法重置密码',
    )
  })

  it('rejects a too-short new password before touching the DB', async () => {
    const target = await mintMember('portal3_reset@x.com', 'parent', org)
    await expect(resetUserPasswordCore(ownerCtx(), target, 'short')).rejects.toThrow(
      '密码至少 8 位',
    )
    expect(await verifyPassword(target, 'initial-password-123')).toBe(true)
  })
})
