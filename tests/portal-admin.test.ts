import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray, like, or } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, account, student, portalLink } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import type { AuthContext } from '@/auth/context'
import {
  createPortalUserCore,
  linkPortalUserCore,
  unlinkPortalUserCore,
} from '@/auth/provision'

// User-management cores (/dashboard/users): account-mint DECOUPLED from student-link. Proven against a
// live DB, mirroring provision-portal.test.ts:
//   createPortalUserCore: mints a login with EXACTLY ONE membership and ZERO portalLinks.
//   linkPortalUserCore:   idempotent; refuses a foreign-org user (no cross-tenant injection); refuses a
//                         missing student; one account → many students.
//   unlinkPortalUserCore: deletes the (student,user) link; tenant-scoped (a wrong-tenant call is a no-op).
const org = 'org_users_admin'
const orgOther = 'org_users_admin_other'
const seedOwnerId = 'u_seed_owner_users'
const outsiderId = 'u_outsider_users'
const outsiderEmail = 'outsider_users@x.com'
const REAL_EMAILS = ['seedowner_users@x.com', outsiderEmail, 'parent_users@x.com']

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

describe('user-management cores — create / link / unlink (DB integration)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([
      { id: org, name: 'Users', slug: 'users-admin', createdAt: now },
      { id: orgOther, name: 'Other', slug: 'users-admin-other', createdAt: now },
    ])
    await db.insert(user).values([
      { id: seedOwnerId, name: 'Owner', email: 'seedowner_users@x.com', emailVerified: true },
      { id: outsiderId, name: 'Outsider', email: outsiderEmail, emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_seed_owner_users', organizationId: org, userId: seedOwnerId, role: 'owner', createdAt: now },
      // the outsider belongs ONLY to another org — never to `org`
      { id: 'm_outsider_users_other', organizationId: orgOther, userId: outsiderId, role: 'owner', createdAt: now },
    ])
    const [a] = (await forTenant(ownerCtx()).insert(student, { name: '甲' })) as { id: string }[]
    const [b] = (await forTenant(ownerCtx()).insert(student, { name: '乙' })) as { id: string }[]
    sA = a.id
    sB = b.id
  })
  afterAll(cleanup)

  it('createPortalUserCore mints one membership, zero links, synthesized email', async () => {
    const r = await createPortalUserCore(ownerCtx(), {
      name: '家长-无绑定',
      kind: 'parent',
      password: 'portal-password-123',
    })
    tracked.push(r.userId)
    expect(r.email).toMatch(/^portal_.+@portal\.local$/)

    const mems = await db.select().from(member).where(eq(member.userId, r.userId))
    expect(mems).toHaveLength(1)
    expect(mems[0].organizationId).toBe(org)
    expect(mems[0].role).toBe('parent')

    const links = await db.select().from(portalLink).where(eq(portalLink.userId, r.userId))
    expect(links).toHaveLength(0) // decoupled — no student bound yet
  })

  // PR#32 MEDIUM regression: re-creating with an email that is ALREADY a member of this org must be a
  // no-op that reports created=false (NOT a fresh account with the new password). The membership stays
  // a single row and its role is never rewritten — so the UI can honestly say "未新建、密码未修改".
  it('createPortalUserCore reports created=false and does not mint/rewrite on an in-org email reuse', async () => {
    const loginId = 'reuse_users@x.com'
    const first = await createPortalUserCore(ownerCtx(), {
      name: '家长-复用',
      kind: 'parent',
      loginId,
      password: 'portal-password-123',
    })
    tracked.push(first.userId)
    expect(first.created).toBe(true)
    expect(first.email).toBe(loginId)

    // Second call, SAME real email → resolves to the same in-org member: no new user, password ignored.
    const second = await createPortalUserCore(ownerCtx(), {
      name: '家长-复用-改名',
      kind: 'student', // even a different kind must NOT rewrite the existing member's role
      loginId,
      password: 'a-totally-different-password-999',
    })
    expect(second.created).toBe(false)
    expect(second.userId).toBe(first.userId)

    const mems = await db.select().from(member).where(eq(member.userId, first.userId))
    expect(mems).toHaveLength(1) // still exactly one membership
    expect(mems[0].role).toBe('parent') // role from the FIRST create, unchanged by the reuse
  })

  it('linkPortalUserCore is idempotent and links one account to many students', async () => {
    const r = await createPortalUserCore(ownerCtx(), {
      name: '家长-李',
      kind: 'parent',
      loginId: 'parent_users@x.com',
      password: 'portal-password-123',
    })
    tracked.push(r.userId)

    await linkPortalUserCore(ownerCtx(), { userId: r.userId, studentId: sA })
    await linkPortalUserCore(ownerCtx(), { userId: r.userId, studentId: sA }) // repeat → no dup
    let links = await db.select().from(portalLink).where(eq(portalLink.userId, r.userId))
    expect(links).toHaveLength(1)
    expect(links[0].studentId).toBe(sA)
    expect(links[0].relationship).toBe('parent') // inferred from member role

    await linkPortalUserCore(ownerCtx(), { userId: r.userId, studentId: sB })
    links = await db.select().from(portalLink).where(eq(portalLink.userId, r.userId))
    expect(links.map((l) => l.studentId).sort()).toEqual([sA, sB].sort())
  })

  it('linkPortalUserCore refuses a user from ANOTHER org (no cross-tenant injection)', async () => {
    await expect(
      linkPortalUserCore(ownerCtx(), { userId: outsiderId, studentId: sA }),
    ).rejects.toThrow('该用户不属于本机构')
    const links = await db.select().from(portalLink).where(eq(portalLink.userId, outsiderId))
    expect(links).toHaveLength(0)
  })

  it('linkPortalUserCore refuses a non-existent student', async () => {
    const r = await createPortalUserCore(ownerCtx(), {
      name: '家长-临',
      kind: 'parent',
      password: 'portal-password-123',
    })
    tracked.push(r.userId)
    await expect(
      linkPortalUserCore(ownerCtx(), { userId: r.userId, studentId: 'no_such_student' }),
    ).rejects.toThrow('学生不存在')
  })

  it('unlinkPortalUserCore removes the link and is tenant-scoped', async () => {
    const r = await createPortalUserCore(ownerCtx(), {
      name: '家长-解',
      kind: 'parent',
      password: 'portal-password-123',
    })
    tracked.push(r.userId)
    await linkPortalUserCore(ownerCtx(), { userId: r.userId, studentId: sA })

    // A wrong-tenant unlink is a no-op (tenantId predicate protects other tenants' rows).
    await unlinkPortalUserCore(ctxFor(orgOther, seedOwnerId), r.userId, sA)
    let links = await db.select().from(portalLink).where(eq(portalLink.userId, r.userId))
    expect(links).toHaveLength(1) // untouched

    await unlinkPortalUserCore(ownerCtx(), r.userId, sA)
    links = await db.select().from(portalLink).where(eq(portalLink.userId, r.userId))
    expect(links).toHaveLength(0)
  })
})
