'use server'

import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { isWholeTenantActor } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { calendarFeed } from '@/db/schema'

type Feed = typeof calendarFeed.$inferSelect

// 评审 Slice D（B6/B45）：feed 的归属维度。whole-tenant staff（owner/admin/assistant/平台管理员）拥有
// 租户级 feed（teacher_id IS NULL，既有行为）；section-scoped 教师拥有归属自己的 feed（teacher_id=自己）。
// 查找/轮换/吊销都必须按这个维度定位那一行，两位教师各自独立、互不能吊销/轮换对方或全租户链接。
function feedOwnerScope(ctx: AuthContext): SQL {
  return isWholeTenantActor(ctx)
    ? isNull(calendarFeed.teacherId)
    : eq(calendarFeed.teacherId, ctx.userId)
}

// The teacher_id to stamp on a NEW feed row for this actor: null for whole-tenant staff (tenant-level
// feed), the caller's own user id for a section-scoped teacher (owner-scoped feed).
function feedOwnerId(ctx: AuthContext): string | null {
  return isWholeTenantActor(ctx) ? null : ctx.userId
}

// The caller's active (non-revoked) feed, located by their OWNER dimension (tenant + teacher_id).
// `calendarFeed` is a NORMAL tenant table here — only the PUBLIC route
// (src/app/api/calendar/[token]/route.ts) bypasses forTenant() (P3-2).
async function findActiveFeed(ctx: AuthContext): Promise<Feed | null> {
  const rows = await forTenant(ctx).select(
    calendarFeed,
    and(isNull(calendarFeed.revokedAt), feedOwnerScope(ctx)),
  )
  return rows[0] ?? null
}

// Idempotent: returns the caller's active feed (their owner dimension), creating one on first view.
// Read-tier (P3-8): viewing the feed URL requires lesson:['read'].
export async function getOrCreateFeed(): Promise<{ token: string }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })

  const existing = await findActiveFeed(ctx)
  if (existing) return { token: existing.token }

  const [created] = await forTenant(ctx).insert(calendarFeed, {
    token: nanoid(32),
    label: '我的教学日历',
    teacherId: feedOwnerId(ctx), // 按 owner 维度接线：section-scoped 教师→自己，whole-tenant→null
  })
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
    const [created] = await forTenant(ctx).insert(calendarFeed, {
      token,
      label: '我的教学日历',
      teacherId: feedOwnerId(ctx), // 无现存 feed 时新建，仍按 owner 维度接线
    })
    revalidatePath('/dashboard/calendar')
    return { token: created.token }
  }

  const [updated] = await forTenant(ctx).update(calendarFeed, existing.id, { token })
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
