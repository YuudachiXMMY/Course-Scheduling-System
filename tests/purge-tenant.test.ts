import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import {
  PURGE_LOCK_KEY,
  PURGE_TABLES,
  countTenantRowsInTable,
  deleteTenantRowsFromTable,
  purgeTenant,
  purgeTenantWithin,
} from '../scripts/purge-tenant'
import { CLEANUP_LOCK_KEY, CLEANUP_TABLES } from '../scripts/cleanup-orphan-tenants'

// H8: an explicit tenant purge routine (the counterpart the 0016/0019 migration headers reference —
// "a tenant's data is removed by an explicit purge routine"). The 18 tenant_id -> organization FKs are
// ON DELETE RESTRICT, so an organization holding data cannot be deleted until its rows are removed in
// child->parent order first. These tests pin the properties that make the routine safe:
//   1. the per-tenant delete/count predicates hit ONLY the target tenant (temp fixtures — the real
//      tables' FKs make cross-tenant seeding awkward, and we must never mutate other tenants);
//   2. PURGE_TABLES stays EXACTLY the set of tenant-scoped tables the DB actually has (a future new
//      tenant table that isn't added here would leak on offboard OR block the org delete);
//   3. end to end on a seeded throwaway tenant: app rows purged, org row deleted (cascading its
//      member/invitation rows), sessions' active org cleared — all inside a rolled-back transaction.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (tests load it via dotenv/config)')

let sql: ReturnType<typeof postgres>
beforeAll(() => {
  sql = postgres(url, { max: 1, onnotice: () => {} })
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})

describe('deleteTenantRowsFromTable (the core per-tenant delete predicate)', () => {
  it('deletes only rows matching the tenant_id and spares every other tenant', async () => {
    await sql.begin(async (tx) => {
      await tx`CREATE TEMP TABLE _probe_rows (tenant_id text, note text) ON COMMIT DROP`
      await tx`INSERT INTO _probe_rows (tenant_id, note) VALUES ('org_del','a'), ('org_del','b'), ('org_keep','c')`

      const removed = await deleteTenantRowsFromTable(
        tx as unknown as typeof sql,
        '_probe_rows',
        'org_del',
      )
      expect(removed).toBe(2)

      const survivors = await tx<{ tenant_id: string }[]>`SELECT tenant_id FROM _probe_rows`
      expect(survivors).toHaveLength(1)
      expect(survivors[0].tenant_id).toBe('org_keep')
    })
  })

  it('removes 0 when no row matches the tenant (idempotent shape)', async () => {
    await sql.begin(async (tx) => {
      await tx`CREATE TEMP TABLE _probe_rows (tenant_id text) ON COMMIT DROP`
      await tx`INSERT INTO _probe_rows (tenant_id) VALUES ('org_keep')`
      expect(
        await deleteTenantRowsFromTable(tx as unknown as typeof sql, '_probe_rows', 'org_absent'),
      ).toBe(0)
      expect(await tx`SELECT 1 FROM _probe_rows`).toHaveLength(1)
    })
  })
})

describe('countTenantRowsInTable (dry-run counter — never mutates)', () => {
  it('counts matching rows without deleting them', async () => {
    await sql.begin(async (tx) => {
      await tx`CREATE TEMP TABLE _probe_rows (tenant_id text) ON COMMIT DROP`
      await tx`INSERT INTO _probe_rows (tenant_id) VALUES ('org_x'), ('org_x'), ('org_y')`
      expect(
        await countTenantRowsInTable(tx as unknown as typeof sql, '_probe_rows', 'org_x'),
      ).toBe(2)
      expect(await tx`SELECT 1 FROM _probe_rows`).toHaveLength(3) // nothing was deleted
    })
  })
})

describe('PURGE_TABLES completeness, ordering & lock', () => {
  it('covers section_share_link plus every table in CLEANUP_TABLES, with no duplicates', () => {
    expect(PURGE_TABLES).toContain('section_share_link')
    for (const t of CLEANUP_TABLES) expect(PURGE_TABLES).toContain(t)
    expect(new Set(PURGE_TABLES).size).toBe(PURGE_TABLES.length)
  })

  it('lists section_share_link before class_section (child before parent for the RESTRICT FK chain)', () => {
    expect(PURGE_TABLES.indexOf('section_share_link')).toBeLessThan(
      PURGE_TABLES.indexOf('class_section'),
    )
  })

  it('matches EXACTLY the live DB set of tenant_id-bearing tables (a new tenant table must be added here)', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'`
    const dbSet = new Set(rows.map((r) => r.table_name))
    expect(new Set(PURGE_TABLES)).toEqual(dbSet)
  })

  it('shares the migrator advisory lock so a purge can never race a migration/cleanup', () => {
    expect(PURGE_LOCK_KEY).toBe(CLEANUP_LOCK_KEY)
  })
})

describe('purgeTenant on the healthy migrated DB (non-existent tenant is a safe no-op)', () => {
  it('commit mode: 0 rows, org not present, org not deleted, does not throw', async () => {
    const summary = await purgeTenant(sql, 'org_does_not_exist_9f3a', { dryRun: false })
    expect(summary.organizationExists).toBe(false)
    expect(summary.organizationDeleted).toBe(false)
    expect(summary.totalRows).toBe(0)
    expect(summary.dryRun).toBe(false)
  })

  it('dry-run mode: reports a per-table breakdown for every tenant table and deletes nothing', async () => {
    const summary = await purgeTenant(sql, 'org_does_not_exist_9f3a', { dryRun: true })
    expect(summary.dryRun).toBe(true)
    expect(summary.organizationDeleted).toBe(false)
    expect(Object.keys(summary.perTable).length).toBe(PURGE_TABLES.length)
  })
})

describe('purgeTenantWithin end-to-end on a seeded throwaway tenant (rolled back)', () => {
  it('deletes the org (cascading member+invitation) and clears sessions active-org', async () => {
    const ROLLBACK = Symbol('rollback')
    const orgId = 'org_purge_test_e2e'
    const userId = 'user_purge_test_e2e'
    let captured: Awaited<ReturnType<typeof purgeTenantWithin>> | undefined
    try {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'Purge Test', 'purge-e2e@example.test')`
        await tx`INSERT INTO organization (id, name, slug, created_at) VALUES (${orgId}, 'Purge Test Org', ${'slug-' + orgId}, now())`
        await tx`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('mem_purge_e2e', ${orgId}, ${userId}, 'owner', now())`
        await tx`INSERT INTO invitation (id, organization_id, email, role, status, expires_at, inviter_id) VALUES ('inv_purge_e2e', ${orgId}, 'invitee@example.test', 'member', 'pending', now() + interval '1 day', ${userId})`
        await tx`INSERT INTO session (id, expires_at, token, updated_at, user_id, active_organization_id) VALUES ('sess_purge_e2e', now() + interval '1 day', 'tok_purge_e2e', now(), ${userId}, ${orgId})`

        const summary = await purgeTenantWithin(tx as unknown as typeof sql, orgId, {
          dryRun: false,
        })
        captured = summary

        expect(summary.organizationExists).toBe(true)
        expect(summary.organizationDeleted).toBe(true)
        expect(summary.sessionsCleared).toBe(1)

        expect(await tx`SELECT 1 FROM organization WHERE id = ${orgId}`).toHaveLength(0)
        expect(await tx`SELECT 1 FROM member WHERE organization_id = ${orgId}`).toHaveLength(0)
        expect(await tx`SELECT 1 FROM invitation WHERE organization_id = ${orgId}`).toHaveLength(0)
        const s = await tx<
          { active_organization_id: string | null }[]
        >`SELECT active_organization_id FROM session WHERE id = 'sess_purge_e2e'`
        expect(s[0]?.active_organization_id).toBeNull()

        throw ROLLBACK // never commit test fixtures
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
    expect(captured?.organizationDeleted).toBe(true)
  })

  it('dry-run on the seeded tenant reports it exists but deletes NOTHING', async () => {
    const ROLLBACK = Symbol('rollback')
    const orgId = 'org_purge_test_dry'
    const userId = 'user_purge_test_dry'
    try {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'Purge Dry', 'purge-dry@example.test')`
        await tx`INSERT INTO organization (id, name, slug, created_at) VALUES (${orgId}, 'Purge Dry Org', ${'slug-' + orgId}, now())`
        await tx`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('mem_purge_dry', ${orgId}, ${userId}, 'owner', now())`

        const summary = await purgeTenantWithin(tx as unknown as typeof sql, orgId, {
          dryRun: true,
        })
        expect(summary.organizationExists).toBe(true)
        expect(summary.organizationDeleted).toBe(false)
        expect(summary.sessionsCleared).toBe(0)

        // still there — dry-run mutated nothing
        expect(await tx`SELECT 1 FROM organization WHERE id = ${orgId}`).toHaveLength(1)
        expect(await tx`SELECT 1 FROM member WHERE organization_id = ${orgId}`).toHaveLength(1)

        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
  })
})
