import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { organization } from '@/db/schema'

// DB1: tenant_id now has a FK to organization(id). Any test that inserts tenant-scoped rows for a
// synthetic org id must first create that organization row, or the insert fails the FK. seedOrg is a
// shared, idempotent helper for exactly that — call it at the TOP of a test's beforeAll/beforeEach
// (before any tenant insert). Cleanup must delete the org LAST (after all tenant rows), since the FK
// is ON DELETE RESTRICT.
//
// Better Auth's generated `organization` declares created_at NOT NULL with no DB default, so we always
// supply it. slug is UNIQUE — default derives one from the id; pass opts.slug to override on collision.
export async function seedOrg(
  id: string,
  opts?: { name?: string; slug?: string; createdAt?: Date },
): Promise<void> {
  await db
    .insert(organization)
    .values({
      id,
      name: opts?.name ?? id,
      slug: opts?.slug ?? id,
      createdAt: opts?.createdAt ?? new Date(),
    })
    .onConflictDoNothing()
}

// Delete an organization row. Call at the END of a test's cleanup — AFTER every tenant-scoped delete —
// because the DB1 tenant_id FK is ON DELETE RESTRICT (deleting an org that still has tenant rows errors).
export async function unseedOrg(id: string): Promise<void> {
  await db.delete(organization).where(eq(organization.id, id))
}
