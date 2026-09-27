import 'server-only'
import type { AuthContext } from '@/auth/context'
import { listNotificationsForUserCore } from '@/lib/notification-core'
import { serializeNotifications, type NotificationRow } from '@/lib/notification-row'

// Re-exported so the client NotificationPanel keeps importing the type from './data'.
export type { NotificationRow }

// Loader takes ctx and does NOT self-gate (the page owns requireAuthContext + requirePermission).
// Newest-first, matching the existing data.ts sort idiom.
export async function listNotifications(ctx: AuthContext): Promise<NotificationRow[]> {
  const rows = await listNotificationsForUserCore(ctx)
  return serializeNotifications(rows)
}
