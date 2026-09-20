import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { listPortalUsers } from '@/app/dashboard/users/data'

// Tab split (orch-change-feature): the 家长 tab must show ONLY parent-role portal accounts and the 学生 tab
// ONLY student-role ones — a pure-student login no longer leaks into 家长. listPortalUsers grows an optional
// { kind } filter (comma-multi aware: a 'parent,student' account belongs to BOTH tabs). No-arg call is
// unchanged (the students-tab assign picker still needs every portal login). Proven against a live DB.
const org = 'org_portal_filter'
const ownerId = 'u_owner_portal_filter'
const parentId = 'u_parent_portal_filter'
const studentId = 'u_student_portal_filter'
const bothId = 'u_both_portal_filter'
const ALL_USERS = [ownerId, parentId, studentId, bothId]

const ownerCtx: AuthContext = {
  tenantId: org,
  userId: ownerId,
  role: 'owner',
  isPlatformAdmin: false,
}

const cleanup = async () => {
  await db.delete(member).where(inArray(member.userId, ALL_USERS))
  await db.delete(user).where(inArray(user.id, ALL_USERS))
  await db.delete(member).where(inArray(member.organizationId, [org]))
  await db.delete(organization).where(inArray(organization.id, [org]))
}

describe('listPortalUsers kind filter — parent/student tab split (DB integration)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db
      .insert(organization)
      .values([{ id: org, name: 'Filter', slug: 'portal-filter', createdAt: now }])
    await db.insert(user).values([
      { id: ownerId, name: 'Owner', email: 'owner_pf@x.com', emailVerified: true },
      { id: parentId, name: '家长甲', email: 'parent_pf@x.com', emailVerified: true },
      { id: studentId, name: '学生乙', email: 'student_pf@x.com', emailVerified: true },
      { id: bothId, name: '家长兼学生', email: 'both_pf@x.com', emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_owner_pf', organizationId: org, userId: ownerId, role: 'owner', createdAt: now },
      { id: 'm_parent_pf', organizationId: org, userId: parentId, role: 'parent', createdAt: now },
      {
        id: 'm_student_pf',
        organizationId: org,
        userId: studentId,
        role: 'student',
        createdAt: now,
      },
      {
        id: 'm_both_pf',
        organizationId: org,
        userId: bothId,
        role: 'parent,student',
        createdAt: now,
      },
    ])
  })
  afterAll(cleanup)

  it('no filter returns every portal login (owner excluded — not a portal role)', async () => {
    const rows = await listPortalUsers(ownerCtx)
    const ids = new Set(rows.map((r) => r.userId))
    expect(ids).toEqual(new Set([parentId, studentId, bothId]))
  })

  it("kind:'parent' excludes the pure-student login and keeps the parent + multi-role", async () => {
    const rows = await listPortalUsers(ownerCtx, { kind: 'parent' })
    const ids = new Set(rows.map((r) => r.userId))
    expect(ids).toEqual(new Set([parentId, bothId]))
    expect(ids.has(studentId)).toBe(false)
  })

  it("kind:'student' excludes the pure-parent login and keeps the student + multi-role", async () => {
    const rows = await listPortalUsers(ownerCtx, { kind: 'student' })
    const ids = new Set(rows.map((r) => r.userId))
    expect(ids).toEqual(new Set([studentId, bothId]))
    expect(ids.has(parentId)).toBe(false)
  })
})
