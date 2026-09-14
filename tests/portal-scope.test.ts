import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import { student, portalLink } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { resolveLinkedStudentIds, assertLinkedToStudent } from '@/auth/portal'

const ctxFor = (tenantId: string, userId: string, role = 'parent'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const orgA = 'org_scope_a'
const orgB = 'org_scope_b'
const parentA1 = 'u_parentA1'
const parentA2 = 'u_parentA2'
const parentB = 'u_parentB'
let s1 = '' // orgA, linked to parentA1
let s2 = '' // orgA, linked to parentA2
let sB = '' // orgB, linked to parentB

const cleanup = async () => {
  for (const t of [orgA, orgB]) {
    await db.delete(portalLink).where(eq(portalLink.tenantId, t))
    await db.delete(student).where(eq(student.tenantId, t))
  }
}

describe('portal row-level scope — a parent sees ONLY their own child', () => {
  beforeAll(async () => {
    await cleanup()
    const ctxA = ctxFor(orgA, parentA1)
    const ctxB = ctxFor(orgB, parentB)
    const [a1] = (await forTenant(ctxA).insert(student, { name: 'S1' })) as { id: string }[]
    const [a2] = (await forTenant(ctxA).insert(student, { name: 'S2' })) as { id: string }[]
    const [b] = (await forTenant(ctxB).insert(student, { name: 'SB' })) as { id: string }[]
    s1 = a1.id
    s2 = a2.id
    sB = b.id
    await forTenant(ctxA).insert(portalLink, {
      studentId: s1,
      userId: parentA1,
      relationship: 'parent',
    })
    await forTenant(ctxA).insert(portalLink, {
      studentId: s2,
      userId: parentA2,
      relationship: 'parent',
    })
    await forTenant(ctxB).insert(portalLink, {
      studentId: sB,
      userId: parentB,
      relationship: 'parent',
    })
  })
  afterAll(cleanup)

  it('resolveLinkedStudentIds returns only the acting parent’s own child', async () => {
    expect(await resolveLinkedStudentIds(ctxFor(orgA, parentA1))).toEqual([s1])
    expect(await resolveLinkedStudentIds(ctxFor(orgA, parentA2))).toEqual([s2])
  })

  it('assertLinkedToStudent allows own child, rejects another parent’s child in the SAME org', async () => {
    await expect(assertLinkedToStudent(ctxFor(orgA, parentA1), s1)).resolves.toBeUndefined()
    await expect(assertLinkedToStudent(ctxFor(orgA, parentA1), s2)).rejects.toThrow(
      '无权访问该学生',
    )
  })

  it('cross-tenant: a parent cannot resolve or reach a child in another org', async () => {
    expect(await resolveLinkedStudentIds(ctxFor(orgB, parentB))).toEqual([sB])
    // parentA1 acting in orgA cannot reach the orgB child (portalLink is tenant-scoped)
    await expect(assertLinkedToStudent(ctxFor(orgA, parentA1), sB)).rejects.toThrow(
      '无权访问该学生',
    )
  })
})
