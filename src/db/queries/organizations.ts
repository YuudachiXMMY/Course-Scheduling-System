import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { member } from '@/db/schema'

// Returns the first organization a user belongs to (their default tenant).
// The session `create` hook uses an inline query; this is a reusable equivalent.
export async function getDefaultOrganizationId(userId: string): Promise<string | null> {
  const [m] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)
  return m?.organizationId ?? null
}
