import 'server-only'
import webpush from 'web-push'
import { and, eq } from 'drizzle-orm'
import { env } from '@/env'
import { forTenant } from '@/db/tenant'
import { pushSubscription } from '@/db/schema'
import { saveSubscriptionSchema, isAllowedPushEndpoint } from './push-endpoint'
import type { AuthContext } from '@/auth/context'

// B3 (amplification): a hard cap on stored endpoints per user bounds the server-initiated request fan-out.
const MAX_SUBSCRIPTIONS_PER_USER = 20

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
  const subs = await forTenant(ctx).select(
    pushSubscription,
    eq(pushSubscription.userId, userId),
  )
  for (const s of subs) {
    // B3: defence in depth — never dereference an endpoint that isn't a trusted push service, even for a
    // legacy row that predates the subscribe-time allow-list.
    if (!isAllowedPushEndpoint(s.endpoint)) {
      console.error('push: skipping non-allow-listed endpoint', { userId, subId: s.id })
      continue
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) {
        await forTenant(ctx).delete(pushSubscription, s.id) // prune a subscription that is gone
      } else {
        // B48: surface every OTHER failure (401/403 bad-or-rotated VAPID, 400/413/429, network errors
        // with no statusCode). Swallowing them means a misconfigured key drops every push with zero
        // operator signal — discoverable only via user complaints, with no log to diagnose.
        console.error('push: sendNotification failed', {
          userId,
          subId: s.id,
          statusCode: code,
          error: e instanceof Error ? e.message : String(e),
        })
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
  // B49: validate the attacker-controlled endpoint against the push-service allow-list (+ base64url
  // keys) BEFORE persisting it — the value is later dereferenced by web-push (SSRF sink). Clean message.
  const parsed = saveSubscriptionSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '订阅信息无效')
  const data = parsed.data

  const existing = await forTenant(ctx).select(
    pushSubscription,
    eq(pushSubscription.endpoint, data.endpoint),
  )
  for (const row of existing) {
    await forTenant(ctx).delete(pushSubscription, row.id)
  }
  await forTenant(ctx).insert(pushSubscription, {
    userId: ctx.userId,
    endpoint: data.endpoint,
    p256dh: data.p256dh,
    auth: data.auth,
  })

  // B3 (amplification): keep at most MAX per user — prune the oldest overflow so repeated subscribe
  // calls can't grow an unbounded set of server-initiated push targets.
  const mine = await forTenant(ctx).select(
    pushSubscription,
    eq(pushSubscription.userId, ctx.userId),
  )
  if (mine.length > MAX_SUBSCRIPTIONS_PER_USER) {
    const overflow = [...mine]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(MAX_SUBSCRIPTIONS_PER_USER)
    for (const row of overflow) await forTenant(ctx).delete(pushSubscription, row.id)
  }
}

// Remove the current user's subscription for `endpoint` (called on unsubscribe). Scoped to the
// caller's own userId so a user can only drop their own device.
export async function removeSubscriptionCore(ctx: AuthContext, endpoint: string): Promise<void> {
  const rows = await forTenant(ctx).select(
    pushSubscription,
    and(eq(pushSubscription.userId, ctx.userId), eq(pushSubscription.endpoint, endpoint)),
  )
  for (const row of rows) {
    await forTenant(ctx).delete(pushSubscription, row.id)
  }
}
