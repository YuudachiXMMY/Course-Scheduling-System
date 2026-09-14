import 'server-only'
import { isNull } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { calendarFeed } from '@/db/schema'
import type { AuthContext } from '@/auth/context'

type Feed = typeof calendarFeed.$inferSelect

// Server-only read of the tenant's active (non-revoked) feed row, or null. Mirrors the
// schedule/data.ts forTenant read pattern. First-create races (rare, single-tutor) resolve
// to whichever row sorts first — see Testing Strategy "Concurrent access".
export async function getActiveFeed(ctx: AuthContext): Promise<Feed | null> {
  const rows = (await forTenant(ctx).select(calendarFeed, isNull(calendarFeed.revokedAt))) as Feed[]
  return rows[0] ?? null
}
