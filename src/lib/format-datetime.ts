import { DateTime } from 'luxon'
import { APP_TIME_ZONE } from './timezone'

// Format a stored instant as an APP_TIME_ZONE wall-clock 'yyyy-MM-dd HH:mm' string.
//
// Every instant is stored in UTC. Business tables (mode:'date') hand back a JS Date; the auth tables
// (user.createdAt/updatedAt — no drizzle mode) hand back an ISO string. Accept both (plus null/undefined
// for "not set") so a single helper covers every row shape. NOT 'server-only': Client Components import
// it too. See src/app/dashboard/notifications/notification-panel.tsx (fromISO) and
// src/lib/schedule-card.tsx (fromJSDate) for the two existing luxon idioms this unifies.
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const dt =
    typeof value === 'string'
      ? DateTime.fromISO(value, { zone: 'utc' })
      : DateTime.fromJSDate(value, { zone: 'utc' })
  return dt.setZone(APP_TIME_ZONE).toFormat('yyyy-MM-dd HH:mm')
}
