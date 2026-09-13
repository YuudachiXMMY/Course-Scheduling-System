import 'server-only'
import { and, gte, lt, ne } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { forTenant } from '@/db/tenant'
import { lesson } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import type { CalendarEvent } from './types'

// Server-only read. Defaults to the current month (Asia/Shanghai) if no range is given.
export async function listLessonsInRange(
  ctx: AuthContext,
  range?: { from: Date; to: Date },
): Promise<CalendarEvent[]> {
  const now = DateTime.now().setZone('Asia/Shanghai')
  const from = range?.from ?? now.startOf('month').minus({ weeks: 1 }).toUTC().toJSDate()
  const to = range?.to ?? now.endOf('month').plus({ weeks: 1 }).toUTC().toJSDate()

  const rows = (await forTenant(ctx).select(
    lesson,
    and(gte(lesson.startAt, from), lt(lesson.startAt, to), ne(lesson.status, 'canceled')),
  )) as (typeof lesson.$inferSelect)[]

  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? '课节',
    start: r.startAt.toISOString(),
    end: r.endAt.toISOString(),
    sectionId: r.sectionId,
    status: r.status,
  }))
}
