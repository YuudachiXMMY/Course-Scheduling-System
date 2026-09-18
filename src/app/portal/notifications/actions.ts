'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { requireConsent } from '@/auth/portal'
import { markNotificationReadCore, markAllReadCore } from '@/lib/notification-core'
import { toPortalActionError } from '@/lib/errors'

export type NotificationActionResult = { ok: true } | { ok: false; error: string }

export async function markNotificationRead(id: string): Promise<NotificationActionResult> {
  const ctx = await requireAuthContext()
  try {
    // EH9: permission + consent inside the try so AuthError/BusinessError is translated, not leaked.
    requirePermission(ctx, { notification: ['update'] })
    await requireConsent(ctx) // 服务端同意门复检：标记已读前必须已同意
    await markNotificationReadCore(ctx, id)
    revalidatePath('/portal/notifications')
    return { ok: true }
  } catch (e) {
    // EH9 (CWE-209): '通知不存在' is a plain Error (not a BusinessError) so it collapses to the generic
    // '操作失败'; only typed user-safe errors (consent BusinessError, AuthError) surface their message.
    return toPortalActionError(e, '操作失败')
  }
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { notification: ['update'] })
    await requireConsent(ctx) // 服务端同意门复检：全部标记已读前必须已同意
    await markAllReadCore(ctx)
    revalidatePath('/portal/notifications')
    return { ok: true }
  } catch (e) {
    return toPortalActionError(e, '操作失败')
  }
}
