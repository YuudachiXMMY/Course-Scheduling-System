import 'server-only'
import { DateTime } from 'luxon'
import { db } from '@/db'
import { lesson, classSection } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { expandRecurrence } from './recurrence'
import { isExclusionViolation } from './errors'
import type { AuthContext } from '@/auth/context'

export interface MaterializeResult {
  inserted: number
  conflicts: number // occurrences skipped because they collide with an existing teacher lesson (GiST 23P01)
}

// Expand section.rrule across the term window and INSERT missing lesson rows only.
// ON CONFLICT (uq_lesson_section_slot) DO NOTHING → never touches manually-edited / canceled rows.
export async function materializeSection(
  ctx: AuthContext,
  sectionId: string,
): Promise<MaterializeResult> {
  const section = (await forTenant(ctx).findById(classSection, sectionId)) as
    typeof classSection.$inferSelect | null
  if (!section || !section.rrule || !section.recurrenceDtstart) return { inserted: 0, conflicts: 0 }
  const zone = section.recurrenceTimezone ?? 'Asia/Shanghai'
  const duration = section.defaultDurationMinutes ?? 60
  const windowStart = section.termStartDate ?? section.recurrenceDtstart
  const windowEnd = section.termEndDate ?? new Date(windowStart.getTime() + 16 * 7 * 864e5) // +16 weeks fallback

  // Derive wall-clock parts of recurrenceDtstart in the section's zone (Luxon), then expand.
  const dt = DateTime.fromJSDate(section.recurrenceDtstart).setZone(zone)
  const occurrences = expandRecurrence({
    rruleText: section.rrule,
    wallStart: { year: dt.year, month: dt.month, day: dt.day, hour: dt.hour, minute: dt.minute },
    zone,
    durationMinutes: duration,
    windowStart,
    windowEnd,
  })
  if (!occurrences.length) return { inserted: 0, conflicts: 0 }

  // Denormalize section.teacherId → lesson.teacherId (else GiST/conflict silently exempts the row).
  const rows = occurrences.map((o) => ({
    tenantId: ctx.tenantId, // assert every row carries the verified tenant (bulk-insert exemption)
    sectionId: section.id,
    teacherId: section.teacherId,
    startAt: o.startAt,
    endAt: o.endAt,
    originalStartAt: o.originalStartAt,
    status: 'scheduled' as const,
    location: section.defaultLocation,
  }))

  const target = [lesson.tenantId, lesson.sectionId, lesson.originalStartAt]

  // Fast path: one bulk insert. A batch that overlaps EXISTING lessons can itself trip the GiST
  // constraint (23P01) — fall back to per-occurrence inserts so good slots still land and conflicting
  // ones are reported, instead of aborting the whole batch (P2-7 GOTCHA).
  try {
    const res = await db
      .insert(lesson)
      .values(rows)
      .onConflictDoNothing({ target })
      .returning({ id: lesson.id })
    return { inserted: res.length, conflicts: 0 }
  } catch (e) {
    if (!isExclusionViolation(e)) throw e
    let inserted = 0
    let conflicts = 0
    for (const row of rows) {
      try {
        const res = await db
          .insert(lesson)
          .values(row)
          .onConflictDoNothing({ target })
          .returning({ id: lesson.id })
        inserted += res.length
      } catch (inner) {
        if (isExclusionViolation(inner)) conflicts += 1
        else throw inner
      }
    }
    return { inserted, conflicts }
  }
}
