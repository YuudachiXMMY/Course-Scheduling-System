import 'server-only'
import type { AuthContext } from '@/auth/context'
import { listNotificationsForUserCore } from '@/lib/notification-core'

// Serializable notification row for the client boundary — every Date is an ISO string | null.
export interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  url: string | null
  readAt: string | null
  createdAt: string | null
}

// Row scope is userId-based: the core filters on ctx.userId, so a parent/student sees ONLY their own
// notifications (created for their portalLink.userId at dispatch time). Newest-first.
export async function listNotifications(ctx: AuthContext): Promise<NotificationRow[]> {
  const rows = await listNotificationsForUserCore(ctx)
  return rows
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      url: r.url,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}
