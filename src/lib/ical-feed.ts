import 'server-only'
import ical from 'ical-generator'
import { getVtimezoneComponent } from '@touch4it/ical-timezones'
import { DateTime } from 'luxon'
import { and, eq, gte, lt, ne } from 'drizzle-orm'
import { db } from '@/db'
import { lesson } from '@/db/schema'

const ZONE = 'Asia/Shanghai'

export interface FeedLesson {
  id: string
  title: string | null
  startAt: Date
  endAt: Date
  location: string | null
}

// Rolling window in Asia/Shanghai calendar days: [now-8w, now+26w] (P3-6). Reuse the
// localDayBound idea from materialize.ts — snap to full local days so edge occurrences
// aren't clipped, then convert to UTC instants for the `lesson.start_at` comparison.
export function feedWindow(now = new Date()): { from: Date; to: Date } {
  const n = DateTime.fromJSDate(now).setZone(ZONE)
  return {
    from: n.minus({ weeks: 8 }).startOf('day').toUTC().toJSDate(),
    to: n.plus({ weeks: 26 }).endOf('day').toUTC().toJSDate(),
  }
}

// P3-2 EXCEPTION: NO AuthContext here. The public feed route has already resolved a
// capability `token` to this `tenantId` (a verified capability). Scope STRICTLY by that
// tenantId — never by a request param. Do NOT use forTenant() (it requires a principal).
// This is the ONLY sanctioned public read path; it is confined to this file.
export async function getFeedLessons(tenantId: string): Promise<FeedLesson[]> {
  const { from, to } = feedWindow()
  const rows = await db
    .select({
      id: lesson.id,
      title: lesson.title,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
      location: lesson.location,
    })
    .from(lesson)
    .where(
      and(
        eq(lesson.tenantId, tenantId),
        gte(lesson.startAt, from),
        lt(lesson.startAt, to),
        ne(lesson.status, 'canceled'),
      ),
    )
  return rows
}

// Pure builder (no DB) so it is unit-testable with fabricated lessons — mirrors
// expandRecurrence vs materializeSection. `host` is the NEXT_PUBLIC_APP_URL hostname
// and anchors the stable, PK-derived UID (P3-5) so subscription clients dedup by UID.
export function buildIcs(lessons: FeedLesson[], opts: { host: string; name?: string }): string {
  const cal = ical({
    name: opts.name ?? '课程排课',
    prodId: { company: 'course-scheduler', product: 'schedule' },
  })
  // REQUIRED for a real VTIMEZONE; without the generator, TZID events silently degrade
  // to floating/UTC and clients render the wrong wall-clock time (P3-4).
  cal.timezone({ name: ZONE, generator: getVtimezoneComponent })
  for (const l of lessons) {
    // DEVIATION from the plan snippet: pass Luxon DateTime, not a native Date. ical-generator
    // formats a native Date with the MACHINE-LOCAL getters (getHours…) even when a timezone is
    // set — so `08:00Z` would render as the server's local wall-clock, not 16:00 Asia/Shanghai.
    // A Luxon value triggers `value.setZone(timezone)` internally → correct, machine-TZ-independent.
    const e = cal.createEvent({
      start: DateTime.fromJSDate(l.startAt, { zone: 'utc' }),
      end: DateTime.fromJSDate(l.endAt, { zone: 'utc' }),
      timezone: ZONE, // → DTSTART;TZID=Asia/Shanghai
      summary: l.title ?? '课节',
      location: l.location ?? undefined,
    })
    e.uid(`${l.id}@${opts.host}`) // P3-5: stable, PK-derived UID → no duplicates on refresh
  }
  return cal.toString()
}
