import 'server-only'
import type { AuthContext } from '@/auth/context'
import { requireConsent } from '@/auth/portal'
import { listNotificationsForUserCore } from '@/lib/notification-core'
import { serializeNotifications, type NotificationRow } from '@/lib/notification-row'

// Re-exported so the client NotificationPanel keeps importing the type from './data'.
export type { NotificationRow }

// Row scope is userId-based: the core filters on ctx.userId, so a parent/student sees ONLY their own
// notifications (created for their portalLink.userId at dispatch time). Newest-first.
export async function listNotifications(ctx: AuthContext): Promise<NotificationRow[]> {
  await requireConsent(ctx) // 服务端同意门复检：读个人通知前必须已同意
  const rows = await listNotificationsForUserCore(ctx)
  return serializeNotifications(rows)
}
