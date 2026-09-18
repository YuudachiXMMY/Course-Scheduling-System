import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import { pushSubscription } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { saveSubscriptionCore } from '@/lib/push-core'

// SEC2 + CR8: saveSubscriptionCore must be an ownership-scoped, ATOMIC upsert keyed by
// (tenant, USER, endpoint). push_subscription has NO foreign keys, so this suite only needs the
// domain table itself — a unique tenantId keeps its rows isolated from other suites.
const ctxFor = (tenantId: string, userId: string): AuthContext => ({
  tenantId,
  userId,
  role: 'parent',
  isPlatformAdmin: false,
})

const org = 'org_push_sec2'
const userA = 'u_push_A'
const userB = 'u_push_B'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/sec2_shared_endpoint'

// valid base64url keys (p256dh ≥20, auth ≥16, alphabet [A-Za-z0-9_-])
const KEYS_A = {
  p256dh: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds',
  auth: 'tBHItJI5svbpez7KI4CCXg',
}
const KEYS_A2 = {
  p256dh: 'BKz9zRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475ZZZ',
  auth: 'zZHItJI5svbpez7KI4CCZZ',
}
const KEYS_B = {
  p256dh: 'BAbXyRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475bbb',
  auth: 'cXWItJI5svbpez7KI4CCYg',
}

const rowsForEndpoint = () =>
  forTenant(ctxFor(org, userA)).select(pushSubscription, eq(pushSubscription.endpoint, ENDPOINT))

const cleanup = async () => {
  await db.delete(pushSubscription).where(eq(pushSubscription.tenantId, org))
}

describe('saveSubscriptionCore — 订阅归属与原子 upsert (SEC2/CR8)', () => {
  beforeAll(cleanup)
  afterAll(cleanup)

  it('SEC2：同租户另一用户提交相同 endpoint 不能接管/删除他人的订阅行', async () => {
    await saveSubscriptionCore(ctxFor(org, userA), { endpoint: ENDPOINT, ...KEYS_A })
    let rows = await rowsForEndpoint()
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(userA)
    expect(rows[0].p256dh).toBe(KEYS_A.p256dh)

    // userB subscribes the SAME endpoint — must get their OWN row, never mutate/steal userA's.
    await saveSubscriptionCore(ctxFor(org, userB), { endpoint: ENDPOINT, ...KEYS_B })
    rows = await rowsForEndpoint()
    expect(rows).toHaveLength(2) // one per user
    const a = rows.find((r) => r.userId === userA)!
    const b = rows.find((r) => r.userId === userB)!
    expect(a).toBeTruthy()
    expect(a.p256dh).toBe(KEYS_A.p256dh) // userA's keys UNCHANGED (not hijacked)
    expect(b.p256dh).toBe(KEYS_B.p256dh)
  })

  it('CR8：同一用户重复订阅同一 endpoint 原地更新，不产生重复行、不抛错', async () => {
    // userA re-subscribes with rotated keys — idempotent upsert on (tenant, user, endpoint).
    await expect(
      saveSubscriptionCore(ctxFor(org, userA), { endpoint: ENDPOINT, ...KEYS_A2 }),
    ).resolves.toBeUndefined()

    const rows = await rowsForEndpoint()
    const a = rows.filter((r) => r.userId === userA)
    expect(a).toHaveLength(1) // no duplicate row for userA
    expect(a[0].p256dh).toBe(KEYS_A2.p256dh) // keys refreshed in place
    // userB's row is still intact and independent
    expect(rows.filter((r) => r.userId === userB)).toHaveLength(1)
  })
})
