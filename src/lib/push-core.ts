import 'server-only'
import webpush from 'web-push'
import { and, eq } from 'drizzle-orm'
import { env } from '@/env'
import { db } from '@/db'
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
  const subs = await forTenant(ctx).select(pushSubscription, eq(pushSubscription.userId, userId))
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

// Register (or refresh) the current user's browser subscription for an endpoint.
//
// SEC2: keyed by (tenant, USER, endpoint) — a caller can ONLY ever create/refresh their OWN row.
// Previously the pre-insert cleanup matched by endpoint alone, so a same-tenant user could delete and
// re-own another user's subscription (silent DoS + hijack). CR8: the write is now a single ATOMIC
// upsert (onConflictDoUpdate) instead of a non-atomic select→delete→insert, so two concurrent
// subscribes of the same (user, endpoint) can no longer race into a unique-constraint throw or a
// duplicate row — the second is folded into an in-place key refresh.
//
// Documented forTenant exception (M1): forTenant has no upsert helper, so we use raw db.insert with an
// EXPLICIT tenantId in the values and the tenant scoped into the conflict target — the write can never
// touch another tenant's (or another user's) row.
export async function saveSubscriptionCore(
  ctx: AuthContext,
  input: SaveSubscriptionInput,
): Promise<void> {
  // B49: validate the attacker-controlled endpoint against the push-service allow-list (+ base64url
  // keys) BEFORE persisting it — the value is later dereferenced by web-push (SSRF sink). Clean message.
  const parsed = saveSubscriptionSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '订阅信息无效')
  const data = parsed.data

  await db
    .insert(pushSubscription)
    .values({
      tenantId: ctx.tenantId, // M1: forced tenant scope on this raw-db exception
      userId: ctx.userId,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
    })
    .onConflictDoUpdate({
      // Arbiter = the (tenant, user, endpoint) unique index → only the caller's OWN row can conflict,
      // so the update can only ever refresh the caller's keys, never another user's row.
      target: [pushSubscription.tenantId, pushSubscription.userId, pushSubscription.endpoint],
      set: { p256dh: data.p256dh, auth: data.auth, updatedAt: new Date() },
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
