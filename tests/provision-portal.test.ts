import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, account } from '@/db/schema'
import { provisionPortalMember } from '@/auth/provision'

// Phase 7a — runtime validation of the two riskiest decisions:
//   P7a-1: auth.api.createUser (no headers) + auth.api.addMember provision a login.
//   P7a-2: the branched user.create.after hook does NOT give the provisioned user their own org.
// Proof = the new user ends up with EXACTLY ONE membership, in the tutor's org, role 'parent'.
const org = 'org_provision_7a'
const seedOwnerId = 'u_seed_owner_provision'
const email = `portal_provtest_7a@portal.local`
let createdUserId = ''

const cleanup = async () => {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  if (u) {
    await db.delete(member).where(eq(member.userId, u.id))
    await db.delete(account).where(eq(account.userId, u.id))
    // if the hook regressed and created a junk org owned by this user, this leaves it — the
    // assertion below would already have failed, surfacing the regression.
    await db.delete(user).where(eq(user.id, u.id))
  }
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(organization).where(eq(organization.id, org))
  await db.delete(user).where(eq(user.id, seedOwnerId))
}

describe('portal account provisioning — DB integration (createUser + addMember, hook branch)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([{ id: org, name: 'Provision', slug: 'prov-7a', createdAt: now }])
    // a pre-existing owner so the org isn't empty (not strictly required by addMember)
    await db.insert(user).values([{ id: seedOwnerId, name: 'Owner', email: 'seedowner-prov@t.com', emailVerified: true }])
    await db.insert(member).values([{ id: 'm_seed_owner_prov', organizationId: org, userId: seedOwnerId, role: 'owner', createdAt: now }])
  })
  afterAll(cleanup)

  it('provisions a parent as a member of the tutor org with NO self-owned org', async () => {
    const { userId } = await provisionPortalMember({
      name: '家长',
      email,
      password: 'portal-password-123',
      orgId: org,
      orgRole: 'parent',
    })
    createdUserId = userId
    expect(createdUserId).toBeTruthy()

    // A credential account was linked (so the parent can sign in with email+password).
    const accounts = await db.select().from(account).where(eq(account.userId, createdUserId))
    expect(accounts.length).toBeGreaterThanOrEqual(1)

    // EXACTLY ONE membership — proves the auto-tenant hook was correctly skipped (P7a-2).
    const memberships = await db.select().from(member).where(eq(member.userId, createdUserId))
    expect(memberships).toHaveLength(1)
    expect(memberships[0].organizationId).toBe(org)
    expect(memberships[0].role).toBe('parent')
  })
})
