import 'server-only'
import webpush from 'web-push'
import { and, eq } from 'drizzle-orm'
import { env } from '@/env'
import { forTenant } from '@/db/tenant'
import { pushSubscription } from '@/db/schema'
import type { AuthContext } from '@/auth/context'

// P7b: best-effort Web Push adapter. The persisted `notification` row is the source of truth;
// everything here is a fire-and-forget enhancement that must NEVER abort a notification write.
export interface PushPayload {
  title: string
  body?: string
  url?: string
}

export interface SaveSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
}

type PushSubRow = typeof pushSubscription.$inferSelect

// Push runs ONLY when a VAPID keypair is configured. Optional env → the app runs fully without it.
function pushConfigured(): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

// Send `payload` to every browser endpoint registered for `userId` in this tenant. Best-effort:
// per-subscription failures are swallowed; a subscription the push service reports as gone
// (404/410) is pruned. Transient 5xx are left in place for a later retry.
export async function sendPushToUserCore(
  ctx: AuthContext,
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured()) return // best-effort no-op when unconfigured
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
  const subs = (await forTenant(ctx).select(
    pushSubscription,
    eq(pushSubscription.userId, userId),
  )) as PushSubRow[]
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) {
        await forTenant(ctx).delete(pushSubscription, s.id) // prune a subscription that is gone
      }
    }
  }
}

// Register (or refresh) the current user's browser subscription. Deduped by the unique
// (tenant, endpoint) index: an endpoint that already exists is replaced so its keys stay current.
export async function saveSubscriptionCore(
  ctx: AuthContext,
  input: SaveSubscriptionInput,
): Promise<void> {
  const existing = (await forTenant(ctx).select(
    pushSubscription,
    eq(pushSubscription.endpoint, input.endpoint),
  )) as PushSubRow[]
  for (const row of existing) {
    await forTenant(ctx).delete(pushSubscription, row.id)
  }
  await forTenant(ctx).insert(pushSubscription, {
    userId: ctx.userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
  })
}

// Remove the current user's subscription for `endpoint` (called on unsubscribe). Scoped to the
// caller's own userId so a user can only drop their own device.
export async function removeSubscriptionCore(ctx: AuthContext, endpoint: string): Promise<void> {
  const rows = (await forTenant(ctx).select(
    pushSubscription,
    and(eq(pushSubscription.userId, ctx.userId), eq(pushSubscription.endpoint, endpoint)),
  )) as PushSubRow[]
  for (const row of rows) {
    await forTenant(ctx).delete(pushSubscription, row.id)
  }
}
