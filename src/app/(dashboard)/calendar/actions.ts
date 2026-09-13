'use server'

import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { isNull } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { calendarFeed } from '@/db/schema'

type Feed = typeof calendarFeed.$inferSelect

// One active (non-revoked) feed per tenant. `calendarFeed` is a NORMAL tenant table here —
// only the PUBLIC route (src/app/api/calendar/[token]/route.ts) bypasses forTenant() (P3-2).
async function findActiveFeed(ctx: Awaited<ReturnType<typeof requireAuthContext>>): Promise<Feed | null> {
  const rows = (await forTenant(ctx).select(calendarFeed, isNull(calendarFeed.revokedAt))) as Feed[]
  return rows[0] ?? null
}

// Idempotent: returns the tenant's active feed, creating one on first view. Read-tier (P3-8):
// viewing the feed URL requires lesson:['read'].
export async function getOrCreateFeed(): Promise<{ token: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })

  const existing = await findActiveFeed(ctx)
  if (existing) return { token: existing.token }

  const [created] = (await forTenant(ctx).insert(calendarFeed, {
    token: nanoid(32),
    label: '我的教学日历',
  })) as Feed[]
  revalidatePath('/dashboard/calendar')
  return { token: created.token }
}

// Rotate = replace the existing row's token (do NOT create a duplicate). The old URL 404s
// immediately because the public route matches on the exact token. Edit-tier (P3-8).
export async function rotateFeed(): Promise<{ token: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })

  const existing = await findActiveFeed(ctx)
  const token = nanoid(32)
  if (!existing) {
    const [created] = (await forTenant(ctx).insert(calendarFeed, {
      token,
      label: '我的教学日历',
    })) as Feed[]
    revalidatePath('/dashboard/calendar')
    return { token: created.token }
  }

  const [updated] = (await forTenant(ctx).update(calendarFeed, existing.id, { token })) as Feed[]
  revalidatePath('/dashboard/calendar')
  return { token: updated.token }
}

// Revoke = tombstone the active feed (set revokedAt). Its URL 404s on the next poll. Edit-tier (P3-8).
export async function revokeFeed(): Promise<{ ok: true }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })

  const existing = await findActiveFeed(ctx)
  if (existing) {
    await forTenant(ctx).update(calendarFeed, existing.id, { revokedAt: new Date() })
    revalidatePath('/dashboard/calendar')
  }
  return { ok: true }
}
