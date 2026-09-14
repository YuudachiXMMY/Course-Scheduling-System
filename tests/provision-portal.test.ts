import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq, inArray, like, or } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, account, student, portalLink } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import type { AuthContext } from '@/auth/context'
import { auth } from '@/auth/auth'
import { provisionPortalAccountCore } from '@/auth/provision'

// Phase 7a — provisioning is idempotent + atomic (PR #10 review MEDIUM fix). Proven against a live DB:
//   P7a-1: createUser (no headers) + addMember provision a login.
//   P7a-2: the branched user.create.after hook does NOT give the provisioned user their own org
//          (a provisioned user ends with EXACTLY ONE membership, in the tutor's org).
//   Idempotency: re-provisioning the same (email, student) is a no-op; one real-email parent links
//          to MANY children with ONE membership.
//   Anti-hijack: an existing account from ANOTHER org is refused (no cross-tenant membership injection).
//   Atomicity: if addMember fails, the just-created user is torn down (no orphan).
const org = 'org_provision_7a'
const orgOther = 'org_provision_7a_other'
const seedOwnerId = 'u_seed_owner_provision'
const outsiderId = 'u_outsider_provision'
const outsiderEmail = 'outsider_prov7a@x.com'
const REAL_EMAILS = [
  'parent_prov7a@x.com',
  outsiderEmail,
  'comp_prov7a@x.com',
  'seedowner_prov7a@x.com',
]

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})
const ownerCtx = () => ctxFor(org, seedOwnerId, 'owner')

let sA = ''
let sB = ''
const tracked: string[] = [] // extra user ids minted during tests, cleaned in afterAll

const cleanup = async () => {
  await db.delete(portalLink).where(inArray(portalLink.tenantId, [org, orgOther]))
  await db.delete(student).where(inArray(student.tenantId, [org, orgOther]))
  const junk = await db
    .select({ id: user.id })
    .from(user)
    .where(
      or(
        inArray(user.email, REAL_EMAILS),
        like(user.email, 'portal_%@portal.local'), // synthesized no-email logins
        inArray(user.id, [seedOwnerId, outsiderId, ...tracked]),
      ),
    )
  const ids = [...new Set(junk.map((u) => u.id))]
  if (ids.length) {
    await db.delete(member).where(inArray(member.userId, ids))
    await db.delete(account).where(inArray(account.userId, ids))
    await db.delete(user).where(inArray(user.id, ids))
  }
  await db.delete(member).where(inArray(member.organizationId, [org, orgOther]))
  await db.delete(organization).where(inArray(organization.id, [org, orgOther]))
}

describe('portal account provisioning — idempotent + atomic (DB integration)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([
      { id: org, name: 'Prov', slug: 'prov-7a', createdAt: now },
      { id: orgOther, name: 'Other', slug: 'prov-7a-other', createdAt: now },
    ])
    await db.insert(user).values([
      { id: seedOwnerId, name: 'Owner', email: 'seedowner_prov7a@x.com', emailVerified: true },
      { id: outsiderId, name: 'Outsider', email: outsiderEmail, emailVerified: true },
    ])
    await db.insert(member).values([
      {
        id: 'm_seed_owner_prov',
        organizationId: org,
        userId: seedOwnerId,
        role: 'owner',
        createdAt: now,
      },
      // the outsider belongs ONLY to another org — never to `org`
      {
        id: 'm_outsider_other',
        organizationId: orgOther,
        userId: outsiderId,
        role: 'owner',
        createdAt: now,
      },
    ])
    const [a] = (await forTenant(ownerCtx()).insert(student, { name: '甲' })) as { id: string }[]
    const [b] = (await forTenant(ownerCtx()).insert(student, { name: '乙' })) as { id: string }[]
    sA = a.id
    sB = b.id
  })
  afterAll(cleanup)

  it('real-email parent: one org membership (no junk org), idempotent, one parent → many children', async () => {
    const email = 'parent_prov7a@x.com'
    const r1 = await provisionPortalAccountCore(ownerCtx(), {
      studentId: sA,
      name: '家长',
      kind: 'parent',
      loginId: email,
      password: 'portal-password-123',
    })
    tracked.push(r1.userId)
    expect(r1.email).toBe(email)

    // exactly one credential user + linked account
    const users = await db.select().from(user).where(eq(user.email, email))
    expect(users).toHaveLength(1)
    const accts = await db.select().from(account).where(eq(account.userId, r1.userId))
    expect(accts.length).toBeGreaterThanOrEqual(1)

    // EXACTLY ONE membership, in the tutor org, role 'parent' → hook branch worked (no self-org)
    let mems = await db.select().from(member).where(eq(member.userId, r1.userId))
    expect(mems).toHaveLength(1)
    expect(mems[0].organizationId).toBe(org)
    expect(mems[0].role).toBe('parent')

    let links = await db.select().from(portalLink).where(eq(portalLink.userId, r1.userId))
    expect(links).toHaveLength(1)
    expect(links[0].studentId).toBe(sA)

    // idempotent: same (email, child) → same user, no duplicate membership/link
    const r2 = await provisionPortalAccountCore(ownerCtx(), {
      studentId: sA,
      name: '家长',
      kind: 'parent',
      loginId: email,
      password: 'portal-password-123',
    })
    expect(r2.userId).toBe(r1.userId)
    mems = await db.select().from(member).where(eq(member.userId, r1.userId))
    expect(mems).toHaveLength(1)
    links = await db.select().from(portalLink).where(eq(portalLink.userId, r1.userId))
    expect(links).toHaveLength(1)

    // multi-child: same email, SECOND child → reuse user + membership, add a second link
    const r3 = await provisionPortalAccountCore(ownerCtx(), {
      studentId: sB,
      name: '家长',
      kind: 'parent',
      loginId: email,
      password: 'portal-password-123',
    })
    expect(r3.userId).toBe(r1.userId)
    mems = await db.select().from(member).where(eq(member.userId, r1.userId))
    expect(mems).toHaveLength(1) // STILL one membership
    links = await db.select().from(portalLink).where(eq(portalLink.userId, r1.userId))
    expect(links.map((l) => l.studentId).sort()).toEqual([sA, sB].sort())
  })

  it('refuses an existing account from ANOTHER org (no cross-tenant membership injection)', async () => {
    await expect(
      provisionPortalAccountCore(ownerCtx(), {
        studentId: sA,
        name: '冒名',
        kind: 'parent',
        loginId: outsiderEmail, // belongs to orgOther only
        password: 'portal-password-123',
      }),
    ).rejects.toThrow('该邮箱已被其他账号占用')

    // the outsider gained NO membership in our org and NO link to our student
    const mems = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, outsiderId), eq(member.organizationId, org)))
    expect(mems).toHaveLength(0)
    const links = await db.select().from(portalLink).where(eq(portalLink.userId, outsiderId))
    expect(links).toHaveLength(0)
  })

  it('rolls back the just-created user if addMember fails (no orphan auth user)', async () => {
    const email = 'comp_prov7a@x.com'
    const spy = vi.spyOn(auth.api, 'addMember').mockRejectedValueOnce(new Error('boom'))
    try {
      await expect(
        provisionPortalAccountCore(ownerCtx(), {
          studentId: sA,
          name: '补偿',
          kind: 'parent',
          loginId: email,
          password: 'portal-password-123',
        }),
      ).rejects.toThrow('boom')
    } finally {
      spy.mockRestore()
    }
    const users = await db.select().from(user).where(eq(user.email, email))
    expect(users).toHaveLength(0) // compensated → no orphan
  })

  it('synthesizes a placeholder email for no-email (WeChat) accounts', async () => {
    const r = await provisionPortalAccountCore(ownerCtx(), {
      studentId: sA,
      name: '学生本人',
      kind: 'student',
      password: 'portal-password-123',
    })
    tracked.push(r.userId)
    expect(r.email).toMatch(/^portal_.+@portal\.local$/)
    const mems = await db.select().from(member).where(eq(member.userId, r.userId))
    expect(mems).toHaveLength(1)
    expect(mems[0].role).toBe('student')
    const links = await db.select().from(portalLink).where(eq(portalLink.userId, r.userId))
    expect(links).toHaveLength(1)
    expect(links[0].studentId).toBe(sA)
  })
})
