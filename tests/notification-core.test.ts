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

  it('markAllRead flips every remaining unread of the user', async () => {
    const ctx = ownerCtx()
    const before = await unreadCountForUserCore(ctx)
    expect(before).toBeGreaterThan(0)
    const flipped = await markAllReadCore(ctx)
    expect(flipped).toBe(before)
    expect(await unreadCountForUserCore(ctx)).toBe(0)
  })
})
