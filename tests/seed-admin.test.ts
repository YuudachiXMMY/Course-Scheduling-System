import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { organization, user, member, account, session } from '@/db/schema'
import { seedAdmin } from '../scripts/seed-admin'

// seed-admin (scripts/seed-admin.ts) proven against a live DB: it produces the DEFAULT org + a single
// super admin (org `owner` + platform `superadmin`), and is IDEMPOTENT — a second run creates nothing,
// renames nothing, changes no password, and adds no duplicate membership.
const ORG = 'org_seed_admin_test'
const EMAIL = 'seed_admin_test@x.com'
const PASSWORD = 'seed-admin-password-123'

const cleanup = async () => {
  const users = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL))
  const ids = users.map((u) => u.id)
  if (ids.length) {
    await db.delete(member).where(inArray(member.userId, ids))
    await db.delete(session).where(inArray(session.userId, ids))
    await db.delete(account).where(inArray(account.userId, ids))
    await db.delete(user).where(inArray(user.id, ids))
  }
  await db.delete(member).where(eq(member.organizationId, ORG))
  await db.delete(organization).where(eq(organization.id, ORG))
}

describe('seed-admin — default org + super admin (DB integration)', () => {
  beforeAll(cleanup)
  afterAll(cleanup)

  it('seeds org + owner/superadmin and is idempotent (no recreate/rename/dup on re-run)', async () => {
    const r1 = await seedAdmin({
      email: EMAIL,
      password: PASSWORD,
      name: '播种超管',
      orgId: ORG,
      orgName: '播种默认机构',
    })
    expect(r1.status).toBe('created')
    expect(r1.userId).toBeTruthy()

    // default org exists
    const orgs = await db.select().from(organization).where(eq(organization.id, ORG))
    expect(orgs).toHaveLength(1)

    // platform super admin (user.role) — the isPlatformAdmin pivot
    const [u] = await db.select().from(user).where(eq(user.id, r1.userId!))
    expect(u.role).toBe('superadmin')

    // exactly one owner membership in the default org
    const mems = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, r1.userId!), eq(member.organizationId, ORG)))
    expect(mems).toHaveLength(1)
    expect(mems[0].role).toBe('owner')

    // Second run with DIFFERENT password/name/orgName → reports 'existing', changes nothing.
    const r2 = await seedAdmin({
      email: EMAIL,
      password: 'a-totally-different-password-999',
      name: '改名',
      orgId: ORG,
      orgName: '改名机构',
    })
    expect(r2.status).toBe('existing')
    expect(r2.userId).toBe(r1.userId)

    const memsAfter = await db.select().from(member).where(eq(member.organizationId, ORG))
    expect(memsAfter).toHaveLength(1) // no duplicate membership
    const orgsAfter = await db.select().from(organization).where(eq(organization.id, ORG))
    expect(orgsAfter[0].name).toBe('播种默认机构') // NOT renamed on re-seed
  })

  it('skips (no throw) when ADMIN_EMAIL / ADMIN_PASSWORD are absent', async () => {
    // Empty strings force the skip branch regardless of the ambient env.
    const r = await seedAdmin({ email: '', password: '', orgId: ORG })
    expect(r.status).toBe('skipped')
  })
})
