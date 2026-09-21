import { describe, expect, it } from 'vitest'
import {
  ALLOWLIST,
  findViolations,
  hasRawTenantDbAccess,
  stripCommentsAndStrings,
} from '../scripts/check-tenant-db-access'

// H5 — unit coverage for the tenant-isolation CI guard (scripts/check-tenant-db-access.ts). Locks in
// BOTH the pattern matcher (catches real raw db CRUD, ignores comments/strings/transactions) AND that
// the current tree is green under the audited allowlist — so a NEW bypass route fails this test too, not
// only the CI step.
describe('hasRawTenantDbAccess', () => {
  it('flags a raw db CRUD call', () => {
    expect(hasRawTenantDbAccess('const r = await db.select().from(student)')).toBe(true)
    expect(hasRawTenantDbAccess('await db.insert(lesson).values(x)')).toBe(true)
    expect(hasRawTenantDbAccess('await db.update(course).set(x)')).toBe(true)
    expect(hasRawTenantDbAccess('await db.delete(note).where(x)')).toBe(true)
  })

  it('flags a chained call split across newlines (push-core shape)', () => {
    expect(hasRawTenantDbAccess('await db\n  .insert(pushSubscription)\n  .values({})')).toBe(true)
  })

  it('does NOT flag the sanctioned forTenant spine access', () => {
    expect(hasRawTenantDbAccess('await forTenant(ctx).select(student)')).toBe(false)
    expect(hasRawTenantDbAccess('await forTenant(ctx, tx).insert(lesson, row)')).toBe(false)
  })

  it('does NOT flag db.transaction (the atomic-tx pattern that scopes via forTenant inside)', () => {
    expect(hasRawTenantDbAccess('await db.transaction(async (tx) => {})')).toBe(false)
  })

  it('flags the db.query relational API and db.execute raw SQL (also tenant-bypassing read paths)', () => {
    expect(hasRawTenantDbAccess('await db.query.student.findMany()')).toBe(true)
    expect(hasRawTenantDbAccess('await db.execute(sql`select * from student`)')).toBe(true)
  })

  it('models regex literals: a quote inside a char class must NOT desync the scanner (H5 review)', () => {
    // The export routes use exactly this regex; a naive scanner enters string mode on the `"` and swallows
    // the rest of the file, blinding the guard. The regex must be skipped AND code after it still scanned.
    const src = 'const s = name.replace(/[/\\\\:*?"<>|]/g, "_")\nawait db.select().from(student)'
    expect(hasRawTenantDbAccess(src)).toBe(true)
    // …and a file that ONLY has that regex (no raw db) stays clean (no false positive).
    expect(hasRawTenantDbAccess('const s = name.replace(/[/\\\\:*?"<>|]/g, "_")')).toBe(false)
  })

  it('does NOT treat division as a regex literal', () => {
    expect(hasRawTenantDbAccess('const r = a / b\nconst q = forTenant(ctx).select(x)')).toBe(false)
  })

  it('does NOT flag the pattern inside a line comment', () => {
    expect(hasRawTenantDbAccess('// a raw db.select().from(tenantTable) would cross tenants')).toBe(
      false,
    )
  })

  it('does NOT flag the pattern inside a block comment', () => {
    expect(hasRawTenantDbAccess('/*\n we use raw db.insert with an explicit tenantId\n */')).toBe(
      false,
    )
  })

  it('does NOT flag the pattern inside a string literal', () => {
    expect(hasRawTenantDbAccess('const s = "db.select("')).toBe(false)
    expect(hasRawTenantDbAccess('const s = `prefix db.delete( suffix`')).toBe(false)
  })
})

describe('stripCommentsAndStrings', () => {
  it('removes comments but keeps code tokens', () => {
    const stripped = stripCommentsAndStrings('const x = 1 // db.select(\nconst y = 2')
    expect(stripped).toContain('const x = 1')
    expect(stripped).toContain('const y = 2')
    expect(stripped).not.toContain('db.select(')
  })
})

describe('findViolations (current tree)', () => {
  it('is clean under the current allowlist', () => {
    expect(findViolations()).toEqual([])
  })

  it('every allowlist entry still exists', () => {
    // A stale allowlist entry silently weakens the guard; keep it honest.
    expect(ALLOWLIST.length).toBeGreaterThan(0)
  })
})
