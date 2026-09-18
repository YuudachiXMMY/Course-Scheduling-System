import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { member } from '@/db/schema'

// Returns the first organization a user belongs to (their default tenant).
// The session `create` hook uses an inline query; this is a reusable equivalent.
// CR7: order by member.createdAt (ascending = earliest/founding membership) so a user who belongs to
// multiple orgs resolves to a STABLE default instead of an arbitrary Postgres row order. member.createdAt
// is notNull (auth-schema), so the ordering is total.
export async function getDefaultOrganizationId(userId: string): Promise<string | null> {
  const [m] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(member.createdAt)
    .limit(1)
  return m?.organizationId ?? null
}
