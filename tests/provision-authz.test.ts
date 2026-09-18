import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, account } from '@/db/schema'
import { provisionPortalMember, deprovisionPortalMember } from '@/auth/provision'

// AZ6 + AZ7 — provisioning authorization hardening, proven against a live DB (mirrors provision-portal.test.ts).
//   AZ6: provisionPortalMember reused an existing in-org member WITHOUT checking its role — an email
//        already belonging to a STAFF account (owner/admin/teacher/assistant) would get a portalLink
//        stapled onto a staff login (role confusion). The fix only reuses a PORTAL member; a genuine
//        multi-child parent (role 'parent') must still reuse (created:false).
//   AZ7: deprovisionPortalMember hard-deleted the user by BARE userId — a caller passing a reused/
//        pre-existing id would wipe a real cross-org account. The fix refuses a target with >1
//        membership (a freshly-minted provision artifact always has ≤1), while still tearing down the
//        legitimate single-membership case.
const org = 'org_provision_authz'
const orgOther = 'org_provision_authz_other'

// AZ6 fixtures
const staffUserId = 'u_staff_provauthz'
const staffEmail = 'staff_provauthz@x.com'
const portalParentId = 'u_parent_provauthz'
const portalParentEmail = 'parent_provauthz@x.com'
const foreignUserId = 'u_foreign_provauthz' // exists but is a member of orgOther ONLY
const foreignEmail = 'foreign_provauthz@x.com'

// AZ7 fixtures
const multiUserId = 'u_multi_provauthz' // member of BOTH org and orgOther → must NOT be torn down
const soloUserId = 'u_solo_provauthz' // single membership → the legit teardown path

const ALL_IDS = [staffUserId, portalParentId, foreignUserId, multiUserId, soloUserId]

const cleanup = async () => {
  await db.delete(member).where(inArray(member.userId, ALL_IDS))
  await db.delete(account).where(inArray(account.userId, ALL_IDS))
  await db.delete(user).where(inArray(user.id, ALL_IDS))
  await db.delete(member).where(inArray(member.organizationId, [org, orgOther]))
  await db.delete(organization).where(inArray(organization.id, [org, orgOther]))
}

beforeAll(async () => {
  await cleanup()
  const now = new Date()
  await db.insert(organization).values([
    { id: org, name: 'ProvAuthz', slug: 'prov-authz', createdAt: now },
    { id: orgOther, name: 'Other', slug: 'prov-authz-other', createdAt: now },
  ])
  await db.insert(user).values([
    { id: staffUserId, name: 'Staff', email: staffEmail, emailVerified: true },
    { id: portalParentId, name: 'Parent', email: portalParentEmail, emailVerified: true },
    { id: foreignUserId, name: 'Foreign', email: foreignEmail, emailVerified: true },
    { id: multiUserId, name: 'Multi', email: 'multi_provauthz@x.com', emailVerified: true },
    { id: soloUserId, name: 'Solo', email: 'solo_provauthz@x.com', emailVerified: true },
  ])
  await db.insert(member).values([
    {
      id: 'm_staff_provauthz',
      organizationId: org,
      userId: staffUserId,
      role: 'teacher',
      createdAt: now,
    },
    {
      id: 'm_parent_provauthz',
      organizationId: org,
      userId: portalParentId,
      role: 'parent',
      createdAt: now,
    },
    // foreign account belongs ONLY to another org
    {
      id: 'm_foreign_provauthz',
      organizationId: orgOther,
      userId: foreignUserId,
      role: 'owner',
      createdAt: now,
    },
    // multi-membership user: same id in TWO orgs
    {
      id: 'm_multi_a_provauthz',
      organizationId: org,
      userId: multiUserId,
      role: 'parent',
      createdAt: now,
    },
    {
      id: 'm_multi_b_provauthz',
      organizationId: orgOther,
      userId: multiUserId,
      role: 'parent',
      createdAt: now,
    },
    {
      id: 'm_solo_provauthz',
      organizationId: org,
      userId: soloUserId,
      role: 'parent',
      createdAt: now,
    },
  ])
})

afterAll(cleanup)

describe('AZ6 — provisionPortalMember 复用前校验成员角色', () => {
  const base = {
    name: '复用',
    password: 'portal-password-123',
    orgId: org,
    orgRole: 'parent' as const,
  }

  it('复用真正的门户成员（parent）→ created:false，不新建账号（多孩家长场景）', async () => {
    const r = await provisionPortalMember({ ...base, email: portalParentEmail })
    expect(r).toEqual({ userId: portalParentId, created: false })
  })

  it('邮箱已是员工账号（teacher）→ 拒绝，不把 portalLink 挂到员工登录', async () => {
    await expect(provisionPortalMember({ ...base, email: staffEmail })).rejects.toThrow(
      '该邮箱已被员工账号占用',
    )
  })

  it('邮箱属于其他机构的账号 → 仍拒绝（跨租户注入防线不回归）', async () => {
    await expect(provisionPortalMember({ ...base, email: foreignEmail })).rejects.toThrow(
      '该邮箱已被其他账号占用',
    )
  })
})

describe('AZ7 — deprovisionPortalMember 拒绝删除多机构用户', () => {
  it('目标有 >1 个成员归属 → 拒绝，用户与两处成员行均保留', async () => {
    await expect(deprovisionPortalMember(multiUserId)).rejects.toThrow('拒绝删除多机构用户')
    const u = await db.select().from(user).where(eq(user.id, multiUserId))
    expect(u).toHaveLength(1) // 未被删除
    const mems = await db.select().from(member).where(eq(member.userId, multiUserId))
    expect(mems).toHaveLength(2) // 两个机构归属都还在
  })

  it('单一成员归属（刚铸造的 provision 产物）→ 正常拆除', async () => {
    await deprovisionPortalMember(soloUserId)
    const u = await db.select().from(user).where(eq(user.id, soloUserId))
    expect(u).toHaveLength(0)
    const mems = await db.select().from(member).where(eq(member.userId, soloUserId))
    expect(mems).toHaveLength(0)
  })
})
