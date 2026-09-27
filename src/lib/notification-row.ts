// Pure, client-safe serialization boundary shared by the dashboard and portal notification loaders
// (src/app/{dashboard,portal}/notifications/data.ts). No DB, no 'server-only' — both loaders SELECT
// the same core rows and must hand the identical serializable shape to their NotificationPanel, so
// the map+sort lives here once instead of drifting in two places.

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

// The subset of a notification core row this serializer reads. A full `Notification` row (what
// listNotificationsForUserCore returns) is structurally assignable, so callers pass it as-is.
interface NotificationCoreRow {
  id: string
  type: string
  title: string
  body: string | null
  url: string | null
  readAt: Date | null
  createdAt: Date | null
}

// Map core Date | null timestamps to ISO strings and order newest-first (createdAt desc), matching
// the existing data.ts sort idiom. Nulls sort last via the '' fallback in localeCompare.
export function serializeNotifications(rows: NotificationCoreRow[]): NotificationRow[] {
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
