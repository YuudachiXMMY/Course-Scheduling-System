'use server'

import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { saveSubscriptionCore, removeSubscriptionCore } from '@/lib/push-core'

// P7b: Web Push subscription actions, shared by the dashboard + portal notification centers. Gated
// with notification:['read'] — any recipient may register their OWN device. Errors returned as data.
export type PushActionResult = { ok: true } | { ok: false; error: string }

export async function subscribeToPushAction(sub: PushSubscriptionJSON): Promise<PushActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { notification: ['read'] })
  try {
    const endpoint = sub.endpoint
    const p256dh = sub.keys?.p256dh
    const auth = sub.keys?.auth
    if (!endpoint || !p256dh || !auth) return { ok: false, error: '订阅信息不完整' }
    await saveSubscriptionCore(ctx, { endpoint, p256dh, auth })
    return { ok: true }
  } catch (e) {
    console.error('subscribeToPushAction failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '订阅失败' }
  }
}

export async function unsubscribeFromPushAction(endpoint: string): Promise<PushActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { notification: ['read'] })
  try {
    await removeSubscriptionCore(ctx, endpoint)
    return { ok: true }
  } catch (e) {
    console.error('unsubscribeFromPushAction failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '取消订阅失败' }
  }
}
