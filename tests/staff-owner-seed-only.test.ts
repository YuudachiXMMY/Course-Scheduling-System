import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { setStaffRoleCore } from '@/auth/staff'

// AZ4 — owner is a SEED-ONLY role (staff.ts header: "never minted through the UI"). STAFF_ROLES includes
// 'owner', so before the fix even a platform superadmin could POST newRole='owner' and mint a 2nd owner,
// breaking the invariant. The guard blocks promotion TO owner ONLY — owner demotion/deactivation must
// still work (behind the last-owner lock). Proven against a live DB, mirrors staff-admin.test.ts.
const org = 'org_owner_seed_only'
const owner1 = 'u_owner1_seed'
const owner2 = 'u_owner2_seed'
const teacher1 = 'u_teacher1_seed'

const ctxFor = (userId: string, role = 'owner', isPlatformAdmin = false): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin,
})
// owner1 acts as the platform superadmin (the most-privileged actor) — the exact principal the report
// says could otherwise mint a 2nd owner.
const superCtx = () => ctxFor(owner1, 'owner', true)

const cleanup = async () => {
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(user).where(inArray(user.id, [owner1, owner2, teacher1]))
  await db.delete(organization).where(eq(organization.id, org))
}

beforeAll(async () => {
  await cleanup()
  const now = new Date()
  await db
    .insert(organization)
    .values({ id: org, name: 'OwnerSeed', slug: 'owner-seed-only', createdAt: now })
  await db.insert(user).values([
    { id: owner1, name: 'Owner1', email: 'owner1_seed@x.com', emailVerified: true },
    { id: owner2, name: 'Owner2', email: 'owner2_seed@x.com', emailVerified: true },
    { id: teacher1, name: 'Teacher1', email: 'teacher1_seed@x.com', emailVerified: true },
  ])
  await db.insert(member).values([
    { id: 'm_owner1_seed', organizationId: org, userId: owner1, role: 'owner', createdAt: now },
    { id: 'm_owner2_seed', organizationId: org, userId: owner2, role: 'owner', createdAt: now },
    {
      id: 'm_teacher1_seed',
      organizationId: org,
      userId: teacher1,
      role: 'teacher',
      createdAt: now,
    },
  ])
})

afterAll(cleanup)

describe('AZ4 — owner 为初始化专用角色，不能通过管理界面授予', () => {
  it('即便平台超管也不能把成员提升为 owner（角色不变）', async () => {
    await expect(setStaffRoleCore(superCtx(), teacher1, 'owner')).rejects.toThrow(
      '负责人为初始化专用角色',
    )
    const [m] = await db.select().from(member).where(eq(member.userId, teacher1))
    expect(m.role).toBe('teacher') // 拒绝发生在任何 DB 写入之前
  })

  it('提升为 admin 等合法角色仍可用（守卫只拦 owner）', async () => {
    await setStaffRoleCore(superCtx(), teacher1, 'admin')
    const [m] = await db.select().from(member).where(eq(member.userId, teacher1))
    expect(m.role).toBe('admin')
  })

  it('降级现有 owner 仍可用（守卫只拦 TARGET newRole，不拦 oldRole=owner）', async () => {
    // owner1 仍是 owner，故 owner2 不是最后一个 owner → last-owner 锁不触发。
    await setStaffRoleCore(superCtx(), owner2, 'admin')
    const [m] = await db.select().from(member).where(eq(member.userId, owner2))
    expect(m.role).toBe('admin')
  })
})
