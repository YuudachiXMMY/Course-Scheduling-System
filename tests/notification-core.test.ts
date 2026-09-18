import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import { organization, user, member, notification, pushSubscription } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import {
  createNotificationCore,
  listNotificationsForUserCore,
  unreadCountForUserCore,
  markNotificationReadCore,
  markAllReadCore,
  pruneOldNotificationsCore,
} from '@/lib/notification-core'

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_notify_7b'
const otherOrg = 'org_notify_7b_other'
const ownerUserId = 'u_owner_notify_7b'
const parentUserId = 'u_parent_notify_7b'
const otherUserId = 'u_owner_notify_7b_other'

const ownerCtx = () => ctxFor(org, ownerUserId, 'owner')
const parentCtx = () => ctxFor(org, parentUserId, 'parent')
const otherCtx = () => ctxFor(otherOrg, otherUserId, 'owner')

const cleanup = async () => {
  await db.delete(notification).where(inArray(notification.tenantId, [org, otherOrg]))
  await db.delete(pushSubscription).where(inArray(pushSubscription.tenantId, [org, otherOrg]))
  await db.delete(member).where(inArray(member.organizationId, [org, otherOrg]))
  await db.delete(organization).where(inArray(organization.id, [org, otherOrg]))
  await db.delete(user).where(inArray(user.id, [ownerUserId, parentUserId, otherUserId]))
}

describe('notification-core — DB integration', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([
      { id: org, name: 'N7b', slug: 'n-7b-notify', createdAt: now },
      { id: otherOrg, name: 'N7b2', slug: 'n-7b-notify-other', createdAt: now },
    ])
    await db.insert(user).values([
      { id: ownerUserId, name: 'Owner', email: 'owner-notify-7b@t.com', emailVerified: true },
      { id: parentUserId, name: 'Parent', email: 'parent-notify-7b@t.com', emailVerified: true },
      {
        id: otherUserId,
        name: 'Owner2',
        email: 'owner-notify-7b-other@t.com',
        emailVerified: true,
      },
    ])
    await db.insert(member).values([
      {
        id: 'm_owner_notify_7b',
        organizationId: org,
        userId: ownerUserId,
        role: 'owner',
        createdAt: now,
      },
      {
        id: 'm_parent_notify_7b',
        organizationId: org,
        userId: parentUserId,
        role: 'parent',
        createdAt: now,
      },
      {
        id: 'm_owner_notify_7b_o',
        organizationId: otherOrg,
        userId: otherUserId,
        role: 'owner',
        createdAt: now,
      },
    ])
  })
  afterAll(cleanup)

  it('creates + lists notifications for a user, and counts unread', async () => {
    const ctx = ownerCtx()
    const a = await createNotificationCore(ctx, {
      userId: ownerUserId,
      type: 'lesson_reminder',
      title: '课前提醒',
      body: '第一条',
    })
    const b = await createNotificationCore(ctx, {
      userId: ownerUserId,
      type: 'reschedule_approved',
      title: '改期申请已通过',
      body: '第二条',
    })
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()

    const list = await listNotificationsForUserCore(ctx)
    expect(list.length).toBe(2)
    expect(list.map((n) => n.title).sort()).toEqual(['改期申请已通过', '课前提醒'])
    expect(await unreadCountForUserCore(ctx)).toBe(2)
  })

  it('marks a notification read (sets readAt, decrements unread)', async () => {
    const ctx = ownerCtx()
    const list = await listNotificationsForUserCore(ctx)
    const target = list[0]
    expect(target.readAt).toBeNull()
    const updated = await markNotificationReadCore(ctx, target.id)
    expect(updated.readAt).toBeInstanceOf(Date)
    expect(await unreadCountForUserCore(ctx)).toBe(1)
  })

  it('rejects marking another user’s notification read (same tenant)', async () => {
    const list = await listNotificationsForUserCore(ownerCtx())
    await expect(markNotificationReadCore(parentCtx(), list[0].id)).rejects.toThrow('通知不存在')
  })

  it('dedupes by dedupeKey — second create returns null, only one row persists', async () => {
    const ctx = ownerCtx()
    const key = 'reminder:lesson_x:1h:u_owner_notify_7b'
    const first = await createNotificationCore(ctx, {
      userId: ownerUserId,
      type: 'lesson_reminder',
      title: '课前提醒',
      dedupeKey: key,
    })
    const second = await createNotificationCore(ctx, {
      userId: ownerUserId,
      type: 'lesson_reminder',
      title: '课前提醒',
      dedupeKey: key,
    })
    expect(first).not.toBeNull()
    expect(second).toBeNull()
    const rows = (await forTenant(ctx).select(
      notification,
      eq(notification.dedupeKey, key),
    )) as (typeof notification.$inferSelect)[]
    expect(rows.length).toBe(1)
  })

  it('enforces tenant isolation — a foreign tenant sees none and cannot mark-read', async () => {
    const foreign = otherCtx()
    expect(await listNotificationsForUserCore(foreign)).toHaveLength(0)
    const ownerList = await listNotificationsForUserCore(ownerCtx())
    await expect(markNotificationReadCore(foreign, ownerList[0].id)).rejects.toThrow('通知不存在')
  })

  it('markAllRead flips only the caller’s own unread — other user / tenant untouched, count correct', async () => {
    const ctx = ownerCtx()
    // Seed unread for another user in the SAME tenant and for a user in ANOTHER tenant. PERF2's bulk
    // UPDATE must reach NEITHER (predicate is userId===ctx.userId AND unread; scope AND-s tenantId).
    await createNotificationCore(parentCtx(), {
      userId: parentUserId,
      type: 'lesson_reminder',
      title: '家长未读',
    })
    await createNotificationCore(otherCtx(), {
      userId: otherUserId,
      type: 'lesson_reminder',
      title: '他租户未读',
    })
    const parentBefore = await unreadCountForUserCore(parentCtx())
    const otherBefore = await unreadCountForUserCore(otherCtx())
    expect(parentBefore).toBeGreaterThan(0)
    expect(otherBefore).toBeGreaterThan(0)

    const before = await unreadCountForUserCore(ctx)
    expect(before).toBeGreaterThan(0)
    const flipped = await markAllReadCore(ctx)
    expect(flipped).toBe(before)
    expect(await unreadCountForUserCore(ctx)).toBe(0)

    // Same-tenant other user and the foreign tenant keep every unread row.
    expect(await unreadCountForUserCore(parentCtx())).toBe(parentBefore)
    expect(await unreadCountForUserCore(otherCtx())).toBe(otherBefore)
  })

  it('prune removes rows older than the retention window, keeps recent, and is tenant-scoped', async () => {
    const ctx = ownerCtx()
    // Fixed scan instant → deterministic regardless of wall clock. Cutoff = now − 90d.
    const now = new Date(Date.UTC(2026, 6, 20, 12, 0))
    const old = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000) // 100d → pruned (>90d)
    const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) // 1d → kept
    await forTenant(ctx).insert(notification, {
      userId: ownerUserId,
      type: 'lesson_reminder',
      title: '过期提醒',
      createdAt: old,
    })
    await forTenant(ctx).insert(notification, {
      userId: ownerUserId,
      type: 'lesson_reminder',
      title: '近期提醒',
      createdAt: recent,
    })
    // A foreign tenant's equally-old row must survive — prune is tenant-scoped.
    await forTenant(otherCtx()).insert(notification, {
      userId: otherUserId,
      type: 'lesson_reminder',
      title: '他租户过期提醒',
      createdAt: old,
    })

    const removed = await pruneOldNotificationsCore(ctx, now)
    expect(removed).toBe(1) // only THIS tenant's 100d-old row (prior-test rows are recent)

    const titles = (
      (await forTenant(ctx).select(
        notification,
        eq(notification.userId, ownerUserId),
      )) as (typeof notification.$inferSelect)[]
    ).map((r) => r.title)
    expect(titles).toContain('近期提醒')
    expect(titles).not.toContain('过期提醒')

    const foreign = (await forTenant(otherCtx()).select(
      notification,
      eq(notification.userId, otherUserId),
    )) as (typeof notification.$inferSelect)[]
    expect(foreign.some((r) => r.title === '他租户过期提醒')).toBe(true)
  })
})
