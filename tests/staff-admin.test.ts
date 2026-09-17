import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray, like, or } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, account, session } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import {
  createStaffUserCore,
  setStaffRoleCore,
  deactivateStaffCore,
  reactivateStaffCore,
} from '@/auth/staff'

// Staff-account cores (/dashboard/users teachers/admins tabs), proven against a live DB — mirrors
// portal-admin.test.ts. Covers: tiered create (admin can mint teacher, NOT admin; super can mint admin),
// email-collision refusal, tiered role change, deactivate (ban + session revocation), the self / last-owner
// guards, and the cross-tenant target guard.
const org = 'org_staff_admin'
const orgOther = 'org_staff_admin_other'
const ownerId = 'u_staff_owner' // sole owner of `org`; doubles as the super-admin actor
const adminId = 'u_staff_admin' // a regular org admin actor (no platform flag)
const outsiderId = 'u_staff_outsider' // member of orgOther ONLY
const STAFF_EMAILS = [
  'staff_owner@x.com',
  'staff_admin@x.com',
  'staff_outsider@x.com',
  'teacher1_staff@x.com',
  'admin_by_super@x.com',
  'dup_staff@x.com',
  'bansess_staff@x.com',
]

const ctxFor = (
  tenantId: string,
  userId: string,
  role = 'owner',
  isPlatformAdmin = false,
): AuthContext => ({ tenantId, userId, role, isPlatformAdmin })
const superCtx = () => ctxFor(org, ownerId, 'owner', true) // owner + platform superadmin
const adminCtx = () => ctxFor(org, adminId, 'admin', false)
// A super admin who is NOT the sole owner — used to probe the last-owner guard on `ownerId`.
const superOther = () => ctxFor(org, adminId, 'admin', true)

const tracked: string[] = []

const cleanup = async () => {
  const junk = await db
    .select({ id: user.id })
    .from(user)
    .where(
      or(
        inArray(user.email, STAFF_EMAILS),
        like(user.email, '%_staff@x.com'),
        inArray(user.id, [ownerId, adminId, outsiderId, ...tracked]),
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

describe('staff-management cores — create / role / deactivate (DB integration)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([
      { id: org, name: 'Staff', slug: 'staff-admin', createdAt: now },
      { id: orgOther, name: 'Other', slug: 'staff-admin-other', createdAt: now },
    ])
    await db.insert(user).values([
      { id: ownerId, name: 'Owner', email: 'staff_owner@x.com', emailVerified: true },
      { id: adminId, name: 'Admin', email: 'staff_admin@x.com', emailVerified: true },
      { id: outsiderId, name: 'Outsider', email: 'staff_outsider@x.com', emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_staff_owner', organizationId: org, userId: ownerId, role: 'owner', createdAt: now },
      { id: 'm_staff_admin', organizationId: org, userId: adminId, role: 'admin', createdAt: now },
      {
        id: 'm_staff_outsider',
        organizationId: orgOther,
        userId: outsiderId,
        role: 'owner',
        createdAt: now,
      },
    ])
  })
  afterAll(cleanup)

  it('a regular admin can mint a teacher (one membership, role=teacher)', async () => {
    const r = await createStaffUserCore(adminCtx(), {
      name: '教师甲',
      email: 'teacher1_staff@x.com',
      password: 'staff-password-123',
      role: 'teacher',
    })
    tracked.push(r.userId)
    const mems = await db.select().from(member).where(eq(member.userId, r.userId))
    expect(mems).toHaveLength(1)
    expect(mems[0].organizationId).toBe(org)
    expect(mems[0].role).toBe('teacher')
  })

  it('a regular admin CANNOT mint an admin (tiered gate)', async () => {
    await expect(
      createStaffUserCore(adminCtx(), {
        name: '越权管理员',
        email: 'should_not_exist_staff@x.com',
        password: 'staff-password-123',
        role: 'admin',
      }),
    ).rejects.toThrow()
    const rows = await db.select().from(user).where(eq(user.email, 'should_not_exist_staff@x.com'))
    expect(rows).toHaveLength(0) // refused BEFORE createUser → no orphan
  })

  it('a super admin CAN mint an admin', async () => {
    const r = await createStaffUserCore(superCtx(), {
      name: '管理员乙',
      email: 'admin_by_super@x.com',
      password: 'staff-password-123',
      role: 'admin',
    })
    tracked.push(r.userId)
    const mems = await db.select().from(member).where(eq(member.userId, r.userId))
    expect(mems[0].role).toBe('admin')
  })

  it('refuses a colliding email (never silently reuses a staff login)', async () => {
    const first = await createStaffUserCore(adminCtx(), {
      name: '重复甲',
      email: 'dup_staff@x.com',
      password: 'staff-password-123',
      role: 'teacher',
    })
    tracked.push(first.userId)
    await expect(
      createStaffUserCore(adminCtx(), {
        name: '重复乙',
        email: 'dup_staff@x.com',
        password: 'another-password-999',
        role: 'teacher',
      }),
    ).rejects.toThrow('该邮箱已被占用')
  })

  it('setStaffRoleCore: admin cannot promote a teacher to admin; super can', async () => {
    const t = await createStaffUserCore(adminCtx(), {
      name: '待提升教师',
      email: 'promote_staff@x.com',
      password: 'staff-password-123',
      role: 'teacher',
    })
    tracked.push(t.userId)

    await expect(setStaffRoleCore(adminCtx(), t.userId, 'admin')).rejects.toThrow() // new role admin → super only
    let mems = await db.select().from(member).where(eq(member.userId, t.userId))
    expect(mems[0].role).toBe('teacher') // unchanged

    await setStaffRoleCore(superCtx(), t.userId, 'admin')
    mems = await db.select().from(member).where(eq(member.userId, t.userId))
    expect(mems[0].role).toBe('admin')
  })

  it('deactivateStaffCore bans the user AND revokes their live sessions', async () => {
    const t = await createStaffUserCore(adminCtx(), {
      name: '待停用教师',
      email: 'bansess_staff@x.com',
      password: 'staff-password-123',
      role: 'teacher',
    })
    tracked.push(t.userId)
    // Simulate a live session, then deactivate → banned=true and the session row is deleted (immediate lock-out).
    await db.insert(session).values({
      id: 'sess_ban_staff',
      token: 'tok_ban_staff',
      userId: t.userId,
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await deactivateStaffCore(adminCtx(), t.userId)
    const [u] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, t.userId))
    expect(u.banned).toBe(true)
    const sess = await db.select().from(session).where(eq(session.userId, t.userId))
    expect(sess).toHaveLength(0)

    // Reactivate clears the ban.
    await reactivateStaffCore(adminCtx(), t.userId)
    const [u2] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, t.userId))
    expect(u2.banned).toBe(false)
  })

  it('cannot deactivate yourself', async () => {
    await expect(deactivateStaffCore(superCtx(), ownerId)).rejects.toThrow('不能停用自己')
  })

  it('cannot demote or deactivate the last owner', async () => {
    // A DIFFERENT super admin acts on the sole owner (so the self-guard is not what trips).
    await expect(setStaffRoleCore(superOther(), ownerId, 'admin')).rejects.toThrow(
      '不能降级唯一的负责人',
    )
    await expect(deactivateStaffCore(superOther(), ownerId)).rejects.toThrow('不能停用唯一的负责人')
  })

  it('refuses a target from another org (no cross-tenant reach)', async () => {
    await expect(deactivateStaffCore(superCtx(), outsiderId)).rejects.toThrow('不属于本机构')
    await expect(setStaffRoleCore(superCtx(), outsiderId, 'teacher')).rejects.toThrow(
      '不属于本机构',
    )
  })
})
