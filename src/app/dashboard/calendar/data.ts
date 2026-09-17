import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { calendarFeed } from '@/db/schema'
import { isWholeTenantActor } from '@/auth/scope'
import type { AuthContext } from '@/auth/context'

type Feed = typeof calendarFeed.$inferSelect

// Server-only read of the CALLER'S active (non-revoked) feed row, or null. B6: scoped to the caller's own
// owner dimension (whole-tenant staff → the tenant feed with teacher_id IS NULL; a section-scoped teacher
// → their own teacher_id row). Without this the /dashboard/calendar page would hand a section-scoped
// teacher the whole-tenant token, which the .ics route (teacher_id IS NULL) then expands to every
// teacher's lessons — the very leak Slice D closes. Mirrors findActiveFeed in actions.ts.
export async function getActiveFeed(ctx: AuthContext): Promise<Feed | null> {
  const ownerScope = isWholeTenantActor(ctx)
    ? isNull(calendarFeed.teacherId)
    : eq(calendarFeed.teacherId, ctx.userId)
  const rows = (await forTenant(ctx).select(
    calendarFeed,
    and(isNull(calendarFeed.revokedAt), ownerScope),
  )) as Feed[]
  return rows[0] ?? null
}
