import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '@/db'
import { organization, member, user } from '@/db/schema'
import { student } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import type { AuthContext } from '@/auth/context'

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

describe('tenant isolation', () => {
  const orgA = 'org_a',
    orgB = 'org_b',
    userA = 'user_a',
    userB = 'user_b'
  let studentB: string

  // Idempotent teardown: deleting the orgs cascades member + student (onDelete cascade);
  // user has no org FK so is removed explicitly. Runs before AND after so the suite is
  // re-runnable against a persistent DB (local docker volume), not only a fresh CI service.
  const cleanup = async () => {
    await db.delete(organization).where(inArray(organization.id, [orgA, orgB]))
    await db.delete(user).where(inArray(user.id, [userA, userB]))
  }

  beforeAll(async () => {
    await cleanup()
    // NB: Better Auth's generated organization/member tables declare created_at as
    // NOT NULL without a DB default (Better Auth sets it in app code). Direct drizzle
    // fixture inserts must therefore supply created_at.
    const now = new Date()
    await db.insert(organization).values([
      { id: orgA, name: 'A', slug: 'a', createdAt: now },
      { id: orgB, name: 'B', slug: 'b', createdAt: now },
    ])
    await db.insert(user).values([
      { id: userA, name: 'A', email: 'a@a.com', emailVerified: true },
      { id: userB, name: 'B', email: 'b@b.com', emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_a', organizationId: orgA, userId: userA, role: 'owner', createdAt: now },
      { id: 'm_b', organizationId: orgB, userId: userB, role: 'owner', createdAt: now },
    ])
    await forTenant(ctxFor(orgA, userA)).insert(student, { name: 'A-only' })
    const [b] = await forTenant(ctxFor(orgB, userB)).insert(student, { name: 'B-only' })
    studentB = (b as { id: string }).id
  })
  afterAll(cleanup)
  it('A cannot READ B by id (no IDOR)', async () => {
    expect(await forTenant(ctxFor(orgA, userA)).findById(student, studentB)).toBeNull()
  })
  it('A cannot UPDATE B', async () => {
    expect(await forTenant(ctxFor(orgA, userA)).update(student, studentB, { name: 'hacked' })).toHaveLength(0)
  })
  it('insert cannot smuggle a foreign tenantId', async () => {
    const [row] = await forTenant(ctxFor(orgA, userA)).insert(student, { name: 'x', tenantId: orgB })
    expect((row as { tenantId: string }).tenantId).toBe(orgA)
  })
})
