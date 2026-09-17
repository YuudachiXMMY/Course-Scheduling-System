'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { requireConsent } from '@/auth/portal'
import { markNotificationReadCore, markAllReadCore } from '@/lib/notification-core'

export type NotificationActionResult = { ok: true } | { ok: false; error: string }

export async function markNotificationRead(id: string): Promise<NotificationActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { notification: ['update'] })
  await requireConsent(ctx) // 服务端同意门复检：标记已读前必须已同意
  try {
    await markNotificationReadCore(ctx, id)
    revalidatePath('/portal/notifications')
    return { ok: true }
  } catch (e) {
    console.error('markNotificationRead failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '操作失败' }
  }
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { notification: ['update'] })
  await requireConsent(ctx) // 服务端同意门复检：全部标记已读前必须已同意
  try {
    await markAllReadCore(ctx)
    revalidatePath('/portal/notifications')
    return { ok: true }
  } catch (e) {
    console.error('markAllNotificationsRead failed', e)
    return { ok: false, error: e instanceof Error ? e.message : '操作失败' }
  }
}
