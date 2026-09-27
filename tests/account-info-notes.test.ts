import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray, like, or } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, account, session } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { updateUserInfoCore, setUserNoteCore } from '@/auth/staff'
import { accountNoteSchema, ACCOUNT_NOTE_MAX } from '@/lib/note-schema'

// New /dashboard/users behaviors, proven against a live DB — mirrors staff-admin.test.ts:
//   - updateUserInfoCore: edit display name + login email, lower-cased; refuses self, cross-tenant, a
//     colliding email, and (tiered) a regular admin touching an admin target.
//   - setUserNoteCore: set/clear the admin-internal note; blank → NULL; tiered gate on admin targets.
const org = 'org_acct_info'
const orgOther = 'org_acct_info_other'
const ownerId = 'u_acct_owner' // sole owner of `org`; doubles as the super-admin actor
const adminId = 'u_acct_admin' // a regular org admin actor (no platform flag)
const teacherId = 'u_acct_teacher' // a teacher target (non-admin → any manager may edit)
const admin2Id = 'u_acct_admin2' // an admin target (admin-tier → super admin only)
const outsiderId = 'u_acct_outsider' // member of orgOther ONLY (cross-tenant target)
const ACCT_EMAILS = [
  'acct_owner@x.com',
  'acct_admin@x.com',
  'acct_teacher@x.com',
  'acct_admin2@x.com',
  'acct_outsider@x.com',
  'acct_teacher_new@x.com',
]

const ctxFor = (
  tenantId: string,
  userId: string,
  role = 'owner',
  isPlatformAdmin = false,
): AuthContext => ({ tenantId, userId, role, isPlatformAdmin })
const superCtx = () => ctxFor(org, ownerId, 'owner', true) // owner + platform superadmin
const adminCtx = () => ctxFor(org, adminId, 'admin', false)

const cleanup = async () => {
  const junk = await db
    .select({ id: user.id })
    .from(user)
    .where(
      or(
        inArray(user.email, ACCT_EMAILS),
        like(user.email, '%_acct@x.com'),
        inArray(user.id, [ownerId, adminId, teacherId, admin2Id, outsiderId]),
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

describe('accountNoteSchema — blank/whitespace normalization (pure)', () => {
  it('trims and rejects an over-long note', () => {
    expect(accountNoteSchema.parse('  hello  ')).toBe('hello')
    expect(accountNoteSchema.safeParse('x'.repeat(ACCOUNT_NOTE_MAX + 1)).success).toBe(false)
  })
  it('a whitespace-only note trims to empty (callers map "" → NULL)', () => {
    expect(accountNoteSchema.parse('   ')).toBe('')
  })
})

describe('updateUserInfoCore / setUserNoteCore (DB integration)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([
      { id: org, name: 'Acct', slug: 'acct-info', createdAt: now },
      { id: orgOther, name: 'Other', slug: 'acct-info-other', createdAt: now },
    ])
    await db.insert(user).values([
      { id: ownerId, name: 'Owner', email: 'acct_owner@x.com', emailVerified: true },
      { id: adminId, name: 'Admin', email: 'acct_admin@x.com', emailVerified: true },
      { id: teacherId, name: '教师甲', email: 'acct_teacher@x.com', emailVerified: true },
      { id: admin2Id, name: '管理员乙', email: 'acct_admin2@x.com', emailVerified: true },
      { id: outsiderId, name: 'Outsider', email: 'acct_outsider@x.com', emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_acct_owner', organizationId: org, userId: ownerId, role: 'owner', createdAt: now },
      { id: 'm_acct_admin', organizationId: org, userId: adminId, role: 'admin', createdAt: now },
      {
        id: 'm_acct_teacher',
        organizationId: org,
        userId: teacherId,
        role: 'teacher',
        createdAt: now,
      },
      { id: 'm_acct_admin2', organizationId: org, userId: admin2Id, role: 'admin', createdAt: now },
      {
        id: 'm_acct_outsider',
        organizationId: orgOther,
        userId: outsiderId,
        role: 'owner',
        createdAt: now,
      },
    ])
  })
  afterAll(cleanup)

  it('a manager edits a teacher name + email (email lower-cased)', async () => {
    await updateUserInfoCore(adminCtx(), teacherId, {
      name: '教师改名',
      email: 'Acct_Teacher_New@x.com',
    })
    const [row] = await db.select().from(user).where(eq(user.id, teacherId))
    expect(row.name).toBe('教师改名')
    expect(row.email).toBe('acct_teacher_new@x.com')
  })

  it('refuses editing your OWN info', async () => {
    await expect(
      updateUserInfoCore(adminCtx(), adminId, { name: 'x', email: 'acct_admin@x.com' }),
    ).rejects.toThrow('不能在此编辑自己的信息')
  })

  it('refuses a colliding email (another user already owns it)', async () => {
    await expect(
      updateUserInfoCore(adminCtx(), teacherId, { name: '教师改名', email: 'acct_owner@x.com' }),
    ).rejects.toThrow('该邮箱已被占用')
  })

  it('refuses a cross-tenant target', async () => {
    await expect(
      updateUserInfoCore(adminCtx(), outsiderId, { name: 'x', email: 'new_acct@x.com' }),
    ).rejects.toThrow('该用户不属于本机构')
  })

  it('tiered: a regular admin CANNOT edit an admin target; a super admin CAN', async () => {
    await expect(
      updateUserInfoCore(adminCtx(), admin2Id, { name: 'x', email: 'new_acct@x.com' }),
    ).rejects.toThrow()
    let [row] = await db.select().from(user).where(eq(user.id, admin2Id))
    expect(row.name).toBe('管理员乙') // unchanged

    await updateUserInfoCore(superCtx(), admin2Id, {
      name: '管理员乙改',
      email: 'acct_admin2@x.com',
    })
    ;[row] = await db.select().from(user).where(eq(user.id, admin2Id))
    expect(row.name).toBe('管理员乙改')
  })

  it('setUserNoteCore sets then clears a note (blank → NULL)', async () => {
    await setUserNoteCore(adminCtx(), teacherId, '  这是备注  ')
    let [row] = await db.select().from(user).where(eq(user.id, teacherId))
    expect(row.notes).toBe('这是备注') // trimmed

    await setUserNoteCore(adminCtx(), teacherId, '   ')
    ;[row] = await db.select().from(user).where(eq(user.id, teacherId))
    expect(row.notes).toBeNull() // blank normalized to NULL
  })

  it('tiered: a regular admin CANNOT note an admin target; a super admin CAN', async () => {
    await expect(setUserNoteCore(adminCtx(), admin2Id, '越权备注')).rejects.toThrow()
    let [row] = await db.select().from(user).where(eq(user.id, admin2Id))
    expect(row.notes).toBeNull()

    await setUserNoteCore(superCtx(), admin2Id, '超管备注')
    ;[row] = await db.select().from(user).where(eq(user.id, admin2Id))
    expect(row.notes).toBe('超管备注')
  })

  it('refuses a note on a cross-tenant target', async () => {
    await expect(setUserNoteCore(adminCtx(), outsiderId, 'x')).rejects.toThrow('该用户不属于本机构')
  })
})
