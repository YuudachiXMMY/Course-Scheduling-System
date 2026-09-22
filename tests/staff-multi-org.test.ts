import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, session } from '@/db/schema'
import { deactivateStaffCore, reactivateStaffCore } from '@/auth/staff'
import type { AuthContext } from '@/auth/context'

// A1 (orch-review MEDIUM — test gap): deactivateStaffCore/reactivateStaffCore flip the GLOBAL user.banned,
// so for a user who is staff in MORE THAN ONE org they REFUSE (a global ban/unban here would over-reach
// into the other org). Mirrors provision-authz.test.ts's AZ7. Pins: (1) the multi-org refuse leaves
// user.banned AND the sessions untouched; (2) the single-membership path still deactivates (ban + revoke
// sessions) and reactivates.
const ctxOwner = (tenantId: string, userId: string): AuthContext => ({
  tenantId,
  userId,
  role: 'owner',
  isPlatformAdmin: false,
})

const org = 'org_staff_multiorg'
const orgOther = 'org_staff_multiorg_other'
const actingOwnerId = 'u_acting_smo'
const multiUserId = 'u_multi_smo' // member of BOTH org and orgOther → deactivate/reactivate must refuse
const soloUserId = 'u_solo_smo' // single membership in org → the legit deactivate/reactivate path
const ALL_IDS = [actingOwnerId, multiUserId, soloUserId]

const cleanup = async () => {
  await db.delete(session).where(inArray(session.userId, ALL_IDS))
  await db.delete(member).where(inArray(member.userId, ALL_IDS))
  await db.delete(user).where(inArray(user.id, ALL_IDS))
  await db.delete(member).where(inArray(member.organizationId, [org, orgOther]))
  await db.delete(organization).where(inArray(organization.id, [org, orgOther]))
}

beforeAll(async () => {
  await cleanup()
  const now = new Date()
  const later = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await db.insert(organization).values([
    { id: org, name: 'SMO', slug: 'smo', createdAt: now },
    { id: orgOther, name: 'SMO2', slug: 'smo-other', createdAt: now },
  ])
  await db.insert(user).values([
    { id: actingOwnerId, name: 'Owner', email: 'owner_smo@x.com', emailVerified: true },
    { id: multiUserId, name: 'Multi', email: 'multi_smo@x.com', emailVerified: true },
    { id: soloUserId, name: 'Solo', email: 'solo_smo@x.com', emailVerified: true },
  ])
  await db.insert(member).values([
    { id: 'm_owner_smo', organizationId: org, userId: actingOwnerId, role: 'owner', createdAt: now },
    // multi-org staff: teacher in BOTH orgs
    { id: 'm_multi_a_smo', organizationId: org, userId: multiUserId, role: 'teacher', createdAt: now },
    { id: 'm_multi_b_smo', organizationId: orgOther, userId: multiUserId, role: 'teacher', createdAt: now },
    // solo: teacher in org only
    { id: 'm_solo_smo', organizationId: org, userId: soloUserId, role: 'teacher', createdAt: now },
  ])
  // A live session per target so we can prove deactivate revokes sessions (solo) and the refuse path
  // leaves them untouched (multi).
  await db.insert(session).values([
    { id: 's_multi_smo', token: 'tok_multi_smo', userId: multiUserId, expiresAt: later, createdAt: now, updatedAt: now },
    { id: 's_solo_smo', token: 'tok_solo_smo', userId: soloUserId, expiresAt: later, createdAt: now, updatedAt: now },
  ])
})

afterAll(cleanup)

describe('deactivateStaffCore — multi-org refuse (A1)', () => {
  it('目标属于 >1 机构 → 拒绝全局停用；user.banned 与其会话均保持不变', async () => {
    await expect(deactivateStaffCore(ctxOwner(org, actingOwnerId), multiUserId)).rejects.toThrow(
      '属于多个机构',
    )
    const [u] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, multiUserId))
    expect(u?.banned ?? false).toBe(false) // 未被封禁
    const sessions = await db.select().from(session).where(eq(session.userId, multiUserId))
    expect(sessions).toHaveLength(1) // 会话未被撤销
  })
})

describe('reactivateStaffCore — multi-org refuse (A1)', () => {
  it('目标属于 >1 机构 → 拒绝清除全局封禁', async () => {
    await expect(reactivateStaffCore(ctxOwner(org, actingOwnerId), multiUserId)).rejects.toThrow(
      '属于多个机构',
    )
  })
})

describe('deactivate/reactivate — single-membership path still works (A1)', () => {
  it('单一机构成员 → 正常停用：user.banned=true 且会话被撤销', async () => {
    await deactivateStaffCore(ctxOwner(org, actingOwnerId), soloUserId)
    const [u] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, soloUserId))
    expect(u?.banned).toBe(true)
    const sessions = await db.select().from(session).where(eq(session.userId, soloUserId))
    expect(sessions).toHaveLength(0) // 会话被撤销（立即锁死）
  })

  it('随后可正常复用：user.banned 清回 false', async () => {
    await reactivateStaffCore(ctxOwner(org, actingOwnerId), soloUserId)
    const [u] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, soloUserId))
    expect(u?.banned).toBe(false)
  })
})
