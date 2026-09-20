import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { shareLink, student } from '@/db/schema'
import { getShareByToken } from '@/lib/share'
import { SHARE_TOKEN_TTL_DAYS, defaultShareExpiry, isTokenTimeActive } from '@/lib/share-ttl'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// H6: capability tokens must expire. Pure-logic tests pin the TTL decision (incl. the NULL =
// never-expires backward-compat rule); the DB tests prove getShareByToken actually filters expired rows.

describe('share-ttl (pure)', () => {
  const now = new Date('2026-09-20T12:00:00Z')

  it('treats NULL expiry as never-expires (grandfathered existing tokens)', () => {
    expect(isTokenTimeActive(null, now)).toBe(true)
  })

  it('is active strictly before expiry, expired at/after it', () => {
    expect(isTokenTimeActive(new Date(now.getTime() + 1000), now)).toBe(true)
    expect(isTokenTimeActive(new Date(now.getTime() - 1000), now)).toBe(false)
    expect(isTokenTimeActive(now, now)).toBe(false) // exactly now = expired
  })

  it('defaultShareExpiry is now + TTL days', () => {
    const exp = defaultShareExpiry(now)
    expect(exp.getTime()).toBe(now.getTime() + SHARE_TOKEN_TTL_DAYS * 86_400_000)
    expect(isTokenTimeActive(exp, now)).toBe(true)
  })
})

const ORG = 'org_share_ttl'
const SREF = { nullExp: 'stu_ttl_null', future: 'stu_ttl_future', past: 'stu_ttl_past' }

async function mkStudent(id: string): Promise<void> {
  await db.insert(student).values({ id, tenantId: ORG, name: id }).onConflictDoNothing()
}

describe('getShareByToken — expiry filtering (DB)', () => {
  beforeAll(async () => {
    await seedOrg(ORG)
    await Promise.all(Object.values(SREF).map(mkStudent))
    // one ACTIVE (non-revoked) share per student to satisfy the partial-unique index; distinct expiry.
    await db.insert(shareLink).values([
      { tenantId: ORG, studentId: SREF.nullExp, token: 'tok_null_exp', expiresAt: null },
      {
        tenantId: ORG,
        studentId: SREF.future,
        token: 'tok_future',
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        tenantId: ORG,
        studentId: SREF.past,
        token: 'tok_past',
        expiresAt: new Date(Date.now() - 60_000),
      },
    ])
  })

  afterAll(async () => {
    // shareLink FK is ON DELETE cascade from student → deleting students clears their shares.
    await db.delete(student).where(eq(student.tenantId, ORG))
    await unseedOrg(ORG)
  })

  it('resolves a token with NULL expiry (backward-compatible: never expires)', async () => {
    const row = await getShareByToken('tok_null_exp')
    expect(row?.token).toBe('tok_null_exp')
  })

  it('resolves a token whose expiry is in the future', async () => {
    const row = await getShareByToken('tok_future')
    expect(row?.token).toBe('tok_future')
  })

  it('returns null for a token whose expiry has passed', async () => {
    expect(await getShareByToken('tok_past')).toBeNull()
  })

  it('still returns null for a revoked token (existing behavior unchanged)', async () => {
    await db
      .update(shareLink)
      .set({ revokedAt: new Date() })
      .where(and(eq(shareLink.tenantId, ORG), eq(shareLink.token, 'tok_null_exp')))
    expect(await getShareByToken('tok_null_exp')).toBeNull()
  })
})
